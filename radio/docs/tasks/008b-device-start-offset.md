# Task 008B — ESP32 startOffsetMs 中途接入

## 目标

Task 008 已经在真机上完成最小链路：

```text
ESP32-S3
→ Wi-Fi
→ Device Receiver API
→ signed audio URL
→ ESP32-audioI2S
→ I2S
→ MAX98357A
→ 扬声器
```

当前最新已知基线：

```text
313bc55e53d05415d6c320b8adf5f1c963843ba2
fix: radio ino
```

真机已经能够播放节目。

现在补上之前明确延期的 Receiver 语义：**Device manifest 中的 `startOffsetMs` 必须真正生效，让实体电台接入一条“已经正在广播”的节目，而不是永远从 0 秒开始。**

本任务只实现这个 seek。不要开始 EC11、TFT、tuning/static 或完整调台状态机。

---

## 一、必须保留的现状

不要破坏 Task 008 已经验证/加入的能力：

- Device tune API 与 Bearer token；
- signed audio URL 不打印 query string；
- Wi-Fi gateway/BSSID 诊断逻辑；
- HTTP/1.0 Device tune JSON 处理；
- ESP32-audioI2S 网络流式播放；
- MAX98357A GPIO：
  - BCLK GPIO4
  - LRC GPIO5
  - DIN GPIO6
- 只有 NETWORK_AUDIO 一个 I2S owner；
- 音频真实 EOF 才发送 completed；
- 播放失败、断网、stall 不得发送 completed；
- 当前播放健康判断、错误标志和 host regression tests。

不要为了 seek 重写播放器。

---

## 二、使用库原生 seek 能力

当前使用的 ESP32-audioI2S 4.0.0 系列公开 API 已提供：

```cpp
bool setAudioPlayTime(uint16_t sec);
```

优先使用这个接口。

不要自行：

- 下载完整 WAV；
- 手算 PCM/WAV byte offset；
- 自己拼 HTTP Range；
- 改 Supabase Storage API；
- 新建服务端音频切片接口。

Device manifest 已经提供：

```json
{
  "startOffsetMs": 8000
}
```

ESP32 将它转换成秒即可。当前服务端 offset 大约在 4–15 秒，1 秒精度对 MVP 足够。

建议：

```text
seekSeconds = startOffsetMs / 1000
```

不要因为毫秒不能完全表达就增加复杂插值或重新编码。

---

## 三、seek 时机

不能在 `connecttohost()` 前调用 seek。

期望流程：

```text
收到 manifest
→ 保存 pending startOffset
→ connecttohost(audioUrl)
→ 等网络音频 stream ready
→ 如果 offset > 0，调用一次 setAudioPlayTime(seekSeconds)
→ seek 成功
→ 真正产生音频样本
→ 正常 playing
```

结合当前已有 `audioStreamReady` / callback / playback state 实现即可。

要求：

- seek 每条节目只执行一次；
- 不要在每次 loop 重复调用；
- callback 尽量只设置标志，在主 loop 中执行 seek；
- 不要在音频 callback 中增加阻塞网络操作；
- `startOffsetMs === 0` 时保持正常从头播放。

---

## 四、seek 失败语义

如果 manifest 要求 `startOffsetMs > 0`，但：

```cpp
setAudioPlayTime(...)
```

返回失败，则：

- 输出明确日志：`audio seek failed`；
- 停止当前播放；
- 不发送 completed；
- 回到 idle；
- 不偷偷从 0 秒继续播放；
- 不触发 AI / replenish；
- 不自动请求下一台。

这样真机问题可以明确暴露，而不是破坏“接入正在广播的节目”语义。

---

## 五、播放完成语义保持不变

seek 成功以后，节目自然播放到末尾：

```text
真实 EOF
→ completed
→ retire
→ 服务端 best-effort replenish 1 条
```

仍然使用现有 completed API。

注意：即使从中途开始播放，**自然到达文件 EOF 仍然算节目完成**，可以 completed。

以下情况仍然不能 completed：

- seek 失败；
- Wi-Fi 断开；
- HTTP 音频异常；
- decoder error；
- stall；
- 用户未来手动换台。

---

## 六、日志

为真机调试增加最少必要日志，例如：

```text
startOffsetMs: 8300
seeking to: 8 s
audio seek succeeded
```

失败：

```text
audio seek failed: 8 s
```

不要输出 signed URL query、Device token、Wi-Fi 密码。

不要增加高频 loop 日志。

---

## 七、测试

在现有 `radio-device/tests/playback_test.py` 上补最小回归测试。

至少覆盖：

1. offset = 0：
   - 不调用 seek；
   - 正常播放。

2. offset > 0：
   - stream ready 后只调用一次 seek；
   - seek 参数正确换算成秒。

3. seek 成功：
   - 继续播放；
   - EOF 后正常 completed。

4. seek 失败：
   - 进入 idle；
   - 不 completed。

5. seek 等待阶段：
   - 不重复 seek；
   - 不误判 EOF 为 completed；
   - 原有 stall/error/Wi-Fi 失败保护仍有效。

不要为了 host test 建一个复杂抽象层。

---

## 八、真机验收

烧录后至少验证：

1. 串口能看到服务端返回的 `startOffsetMs`；
2. offset > 0 时日志显示实际 seek 秒数；
3. 扬声器明显不是每次都从节目开头播放；
4. seek 后音频可以持续正常播放；
5. 自然播完仍只发送一次 completed；
6. seek 失败时不会 retire 节目。

如果真机发现库对 HTTP WAV 的 `setAudioPlayTime()` 不可靠，先记录现象并停止，不要擅自改成整文件下载或自建音频代理。

---

## 九、本任务明确不做

- EC11 旋钮；
- TFT；
- tuning/static；
- 多 I2S owner；
- 自动下一台；
- 最近节目历史；
- 频率刻度/电台槽位；
- HTTP Range 自实现；
- WAV 手工 seek；
- 服务端音频代理；
- Redis / queue / scheduler；
- 音频质量或 TTS 调优。

---

## 验收标准

1. Device manifest 的 `startOffsetMs` 在 ESP32 真正生效；
2. 使用 ESP32-audioI2S 原生 seek 能力，不整条下载；
3. 每条节目最多 seek 一次；
4. seek 失败不回退到 0 秒，不 completed；
5. seek 成功后自然 EOF 仍正常 completed；
6. Task 008 原有网络/播放失败保护不退化；
7. host regression tests 通过；
8. 真机验证至少一条 offset > 0 的节目确实从中途接入。

完成后暂停，不开始 Task 009。
