# Task 009A — EC11 旋钮控制调台

## 目标

在当前真机已经能够：

- 连接 Wi-Fi；
- 调用 Device tune API；
- 播放 signed audio URL；
- 应用 startOffsetMs；
- 自然 EOF 后 completed；

的基础上，让 **EC11 旋钮真正控制换台**。

本任务只打通物理旋钮 → 停止当前节目 → 请求新 signal → 播放新节目。

暂时不要做 TFT，也不要做本地 tuning/static。static 留到 009B 单独处理，避免现在同时引入第二个 I2S owner。

当前基线：

```text
cf23a8a866fa6b3e6a689f88182a881cfec18e55
fix: repair native HTTP WAV seek on radio device
```

---

## 硬件

EC11：

```text
VCC → 3.3V
GND → GND
S1 / CLK → GPIO7
S2 / DT  → GPIO15
KEY / SW → GPIO16
```

本任务只需要旋转；按键 GPIO16 暂不实现功能，但可以保留定义。

---

## 交互

目标体验：

```text
正在播放
→ 用户开始转旋钮
→ 立刻停止当前网络节目
→ 进入 tuning 状态
→ 用户继续转时只更新“正在调台”，不要每个 detent 都请求 API
→ 停止转动约 300ms
→ 调用一次 Device tune
→ signal → 按 manifest 播放
→ no_signal → idle
```

重点：

- 每次物理旋转都应该立刻响应；
- API 请求发生在“停止旋转”之后；
- 一次连续旋转只触发一次 tune；
- 不要因为快速转动连续消费多个节目。

---

## 当前节目处理

用户手动转旋钮换台属于“中途离开节目”。

因此：

- 立即停止 `networkAudio`；
- **不要调用 completed**；
- 不 retire 当前节目；
- 清理当前播放状态，确保旧 EOF / callback 不会误 completed。

不要改服务端 lifecycle 规则。

---

## 最近节目排除

设备侧维护一个很小的最近节目历史，例如最近 2 个 `programId`。

请求：

```json
{
  "excludeProgramIds": ["...", "..."]
}
```

要求：

- 新 signal 成功后加入历史；
- 最多保留 2 个；
- 避免连续调台又马上回到同一个节目；
- 不需要持久化，重启后丢失没关系。

如果库存不足导致 no_signal，保持 no_signal，不要偷偷忽略 exclude 再重试。

---

## EC11 实现要求

使用简单可靠的轮询/状态机即可，不需要第三方 encoder 框架，除非当前环境已有明确依赖。

要求：

- 做基本去抖；
- 顺时针和逆时针目前都视为“发生调台动作”，不需要映射频率；
- 不要求累计刻度；
- 不要求高速精确计步；
- 不在 ISR 中做 HTTP、Serial 大量输出或音频操作；
- 如使用中断，中断只记录最小状态，实际处理放 loop；
- 优先保持当前 audio loop 高频运行，不能因为 encoder debounce 长时间 delay。

---

## 状态

可以在现有 ReceiverState 基础上增加必要状态，例如：

```text
kIdle
kTuning
kPlaying
```

其中：

- 第一次检测到旋转 → kTuning；
- tuning 期间继续旋转只刷新最后活动时间；
- 距离最后一次旋转 >= 300ms → 发起一次 tune；
- tune 成功后进入 playing；
- no_signal / tune 失败回 idle。

不要为了本任务引入复杂通用状态机框架。

---

## 启动行为

保留当前设备开机自动 tune 一次的行为即可。

之后用户转动旋钮进行换台。

---

## 安全边界

必须继续保留：

- Device Bearer token；
- signed URL query 不输出；
- 当前 Wi-Fi/gateway 逻辑；
- startOffsetMs seek；
- seek 失败不 completed；
- 网络/decoder/stall 失败不 completed；
- 自然 EOF 才 completed。

当前 ESP32-audioI2S seek 依赖仓库中记录的本机库补丁；不要在本任务重做或移除该补丁。

---

## 日志

只增加必要日志，例如：

```text
encoder activity
manual retune: stop current program
tuning settled
tune request
signal
```

不要每个 loop 打印。

---

## 测试

补最小 host regression：

1. playing 时发生旋转：
   - 当前音频停止；
   - 不 completed。

2. 连续多个旋转事件：
   - 不立即多次 tune；
   - 只刷新最后活动时间。

3. 停止旋转 300ms 后：
   - 只触发一次 tune。

4. 新 signal：
   - 正常进入现有播放流程；
   - startOffsetMs 仍生效。

5. 最近节目历史：
   - 最多 2 个；
   - tune body 正确发送 excludeProgramIds。

不要过度抽象测试架构。

---

## 真机验收

至少验证：

1. 节目播放中转旋钮，声音立即停止；
2. 连续转动时不会不断请求 tune；
3. 停止约 300ms 后只请求一次；
4. 新节目可以正常播放；
5. 当前节目中途被换走时服务端没有 completed / retire；
6. 连续换台不会马上重复最近节目；
7. startOffsetMs 仍然正常；
8. 自然播完仍然正常 completed。

---

## 本任务明确不做

- tuning/static 噪声；
- TFT；
- 旋钮按键；
- 音量控制；
- 真实频率刻度；
- station slot；
- 自动下一台；
- 本地缓存音频；
- 修改节目生成逻辑；
- 音频断续问题优化。

完成后暂停，不开始 009B。
