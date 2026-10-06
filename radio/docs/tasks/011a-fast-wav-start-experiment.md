# Task 011A — WAV 单连接起播实验

## 目标

当前功能链路已经完整，但实体调台的主要体验问题仍然是：

```text
停转 / 锁台
→ 等约 3.7–3.9 秒
→ 新节目首声
```

009B 的真机测量已经确认，即使 manifest prefetch 命中，主要等待仍来自音频链路：

```text
connecttohost
→ 第一次 HTTPS/TLS + Range: bytes=0-
→ 解析 WAV 头
→ setAudioPlayTime
→ 关闭第一次连接
→ 第二次 HTTPS/TLS + 目标 Range
→ 8 KiB prefill
→ seek applied
→ 首声
```

本任务只验证一个假设：

> 对 PCM WAV，先用同一个 TLS 连接读取一个**有界的文件头 Range**，完整消费该响应后，再在同一 keep-alive 连接上发送目标 Range，能否避免第二次 TLS 握手并明显降低首声延迟。

这是实验任务。成功后再决定是否正式收口；失败则保留现有稳定路径。

当前基线：

```text
c1e196039de603ffb7fb02b86448c6928c814a1c
feat: add ST7735 captions and alien translations
```

---

## 一、不要改产品语义

必须保持：

- manifest prefetch；
- EC11 / tuning static；
- 单一 Audio / I2S owner；
- startOffsetMs；
- subtitles / alien translation；
- completed / retire / replenish；
- 最近节目排除；
- 当前 HTTP seek、decode mutex、caption clock 补丁的正确性。

不要通过以下方式“优化”：

- 去掉 startOffsetMs；
- 从 0 秒播放；
- 提前把节目音频下载到 ESP32；
- 增加第二个 Audio；
- 增加第二个 I2S owner；
- 服务端代理整条音频；
- 改成自动下一台；
- 缩短 timeout 来制造更快失败。

---

## 二、先增加真实首声测量

现有日志中的 `seek applied` 不等于扬声器首声。

增加一次性、低频的时间点记录：

```text
dial locked / network connect begin
audio TCP/TLS connected
WAV header ready
target Range sent
target Range ready
first network PCM
```

至少输出相对毫秒数，不输出 URL/query/token。

`first network PCM` 必须来自 NETWORK owner 的真实 raw-sample callback，且不包含 tuning feedback/static。

每条节目只记录一次。

先用当前稳定路径采 3–5 次 prefetch hit 作为本次真实 baseline。

---

## 三、实验必须有开关

不要直接替换稳定路径。

在本地 ESP32-audioI2S 补丁中增加一个清晰、可撤销的实验入口，例如：

```cpp
connecttohostAtTime(url, startSeconds)
```

或等价的显式 API。

不要偷偷改变所有 `connecttohost()` 行为。

当前普通 `connecttohost()` 必须继续可用，便于 A/B 和回退。

仓库保存 patch、hash、README 应用/移除方式，沿用现有 patches 管理方式。

---

## 四、单连接实验流程

仅针对当前项目实际使用的 **PCM WAV web file**。

建议流程：

```text
connect TLS once
→ GET finite initial Range，例如 bytes=0-8191
→ 验证 206 / Content-Range / Content-Length
→ 解析 WAV header 和 PCM 参数
→ 完整消费 initial finite response 到边界
→ 确认 socket 仍 connected
→ 不 stop / 不 reconnect
→ 在同一 TLS socket 写第二个 GET
→ Range: bytes=<target>-
→ 验证第二个 206 / Content-Range
→ prefill / WAV frame alignment
→ 播放
```

关键点：

1. 第二个请求前必须确认第一个 HTTP response body 已经完整消费，不能把旧 PCM 当新 response header。
2. 服务器若关闭 keep-alive，明确记录：
   ```text
   fast wav start: connection not reusable
   ```
   不要伪装成实验成功。
3. 第二个 Range 的完整校验继续沿用现有 HTTP seek patch 的严格规则。
4. 目标位置必须按 blockAlign 对齐。
5. seek 后 caption clock 仍必须返回节目内绝对时间。
6. 不允许播放 initial Range 中 0 秒附近的 PCM。

初始 Range 长度可以根据实际库需要调整，但必须有界，不能再次用 `bytes=0-`。

---

## 五、格式边界

不要硬编码“所有 WAV 永远 44-byte header”作为未经验证的前提。

当前项目确实由 `buildPcmWav()` 产出标准 WAV，但实验仍应：

- 通过实际 WAV header 得到 data start；
- 使用实际 byteRate / blockAlign；
- 继续拒绝未知/异常格式。

只对当前支持的 PCM WAV 启用 fast path。

其他格式继续走原路径。

---

## 六、失败与回退

实验 fast path 任一阶段失败：

- 不 completed；
- 不 retire；
- 不错误显示字幕；
- 不把旧 response 数据送进 decoder。

为了设备仍可使用，可以明确 fallback 到当前稳定的“两次连接”路径，但日志必须写：

```text
fast wav start failed: <stage>
fallback to legacy seek
```

A/B 统计时 fallback 样本不能算 fast-path 成功样本。

如果 fallback 本身也失败，保持当前 failPlayback 语义。

---

## 七、不要改服务端

本任务优先只验证 ESP32 / ESP32-audioI2S 同连接复用。

不要先加：

- Next.js 音频代理；
- 新 Storage object；
- cropped WAV；
- 音频 body prefetch；
- 数据库字段。

如果实测证明 Supabase/Storage 的该 TLS 连接无法复用，再把证据记录下来，停止本任务；后续再讨论服务端方案。

---

## 八、Host tests

至少覆盖：

1. finite initial Range 是有界请求，不是 `0-`；
2. initial 206 / Content-Range 正确；
3. 第一个 body 未消费完时绝不能发送第二个请求；
4. body 完整消费后，同连接发送目标 Range；
5. 第二个 206 必须严格匹配目标位置和总文件长度；
6. socket 已关闭 → fast path 明确失败/回退；
7. malformed / 200 / 302 / 403 / 416 不进入 fast playback；
8. target blockAlign 对齐；
9. fast path 首帧 playback clock 保持 startOffset 的绝对时间；
10. legacy connect + seek 路径仍通过原回归。

不要删除已有 library seek / mutex / caption clock tests。

---

## 九、真机 A/B

同一 Wi-Fi、尽量连续时间，分别测：

### Legacy
至少 3 次 prefetch-hit 真正换台。

### Fast path
至少 5 次 prefetch-hit 真正换台。

每次记录：

```text
dial locked → first network PCM
TLS connect count
initial header ms
target Range ms
总首声 ms
是否 fallback
```

重点不是 `seek applied`，而是 **first network PCM**。

---

## 十、成功标准

只有同时满足才算值得保留：

1. fast path 至少连续成功 5 次；
2. 没有 crash / mutex assert / RingBuffer 错误；
3. startOffsetMs 实际正确；
4. 字幕位置仍正确；
5. completed 生命周期正确；
6. 音频没有新增明显爆音/错帧；
7. median `dial locked → first network PCM` 相比 legacy 至少降低约 25%。

当前 legacy 约 3.8 秒，因此：

```text
<= 2.8–2.9 s
```

才算有明确价值；若能接近 2 秒更好。

如果只快 200–300ms，不值得继续维护额外 library patch，应回退实验。

---

## 十一、失败时的结论

如果同 TLS keep-alive 无法可靠完成第二个 Range，或收益不足：

- 保留主分支当前稳定播放行为；
- 提交诊断/实验结果即可；
- 明确说明瓶颈；
- 不继续扩大 patch。

届时下一步再评估：

```text
A. 服务端裁剪/代理 WAV
B. audio body / connection prewarm
C. 接受当前等待并用 UX 掩盖
```

不要在本任务自动实施 A/B/C。

---

## 十二、本任务明确不做

- 新 UI；
- 新字幕功能；
- 音量功能；
- EC11 按键；
- 自动下一台；
- 服务端音频代理；
- 音频缓存系统；
- 更换音频格式；
- 网络节目“断断续续”的专项修复。

完成后暂停并报告 A/B 数据和结论。
