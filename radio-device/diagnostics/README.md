# HTTP WAV seek 诊断

本页保留诊断阶段的代码行为与失败证据。后续授权的修复见 [../patches/README.md](../patches/README.md)，当前本机库已是修复版；应用或移除补丁时按该页顺序操作。

基线为 `b89897c`，只增加诊断。产品仍使用库原生 seek、单个 I2S owner；不改 Range 请求、解析规则、超时、播放器状态或失败后的处理。

已核对安装的 `ESP32-audioI2S-master` 4.0.0 中 `setAudioPlayTime`、`newInBuffStart`、`audioFileSeek`、`httpRange`、`parseHttpRangeHeader`。其中原生 seek 先排队；`newInBuffStart` 忽略 `audioFileSeek` 的返回值，然后等待填入最多 65,535 字节。因此 Range 阶段的错误可能最终表现为重填超时。

## 日志

库仅向现有事件队列发送固定事件 ID 和两个整数。固件在主循环中按精确白名单输出固定标签和数字，未知库消息、URL query、请求/响应原文均不输出。解码任务的 `LOGE` 回调仍只设置错误标志。

原生调用在本轮库循环中失败时，新的诊断事件可能尚未派发；失败停止后仅额外排空一次消息队列，避免进入 idle 后漏掉最后的失败阶段，不继续网络播放或调用 completed。

| 阶段 | 字段与含义 |
| --- | --- |
| `initial.status` | 首次连接的 HTTP 状态；connecttohost 原生请求包含 Range: bytes=0- |
| `initial.content-range` | present=1：首次响应包含 Content-Range，不输出原值 |
| `queued` | seconds、position：已排队的秒数与库计算的字节位置 |
| `accept-ranges` | headerBytes：响应头值是否为 bytes；supported：库的支持标志 |
| `file-seek.begin` | acceptRanges：调用时支持标志；dataMode：库当前模式 |
| `file-seek.no-ranges` | 无支持标志时不会调用 httpRange |
| `range.request` | position、length：进入请求阶段，length=-1 表示开放末尾 |
| `range.sent` | written、expected：请求写入连接的实际与预期字节数 |
| `range.status` | HTTP：从状态行提取的整数；不打印原始状态行 |
| `range.header-result` | ok；reason=1 模式不符，2 未读到完整响应头，3 头解析返回错误，0 成功 |
| `file-seek.request-result` / `file-seek.header-result` | 分别为请求与解析函数返回值 |
| `new-buffer.seek-result` | result：audioFileSeek 返回值；requested：目标位置 |
| `read.timeout` | read、expected：超时时累计收到的字节数和目标字节数 |
| `new-buffer.read` | read：重填返回值（超时为 -1）；expected：目标字节数 |
| `new-buffer.align` | offset：原生格式对齐结果；codec：库格式编号 |
| `new-buffer.result` | position：返回位置（失败为 -1）；ok：是否完成重填 |

`new-buffer.guard` 的 reason=1 表示音频头未完成，2 表示偏移超出数据区，3 表示 M4A 缺少定位信息，4 表示剩余数据少于库所需块大小。连接失败会输出 `range.connect-failed`。最后的 `audio failure flags` 记录触发停止前的库错误、网络、就绪、seek 等待、样本和运行标志。

## 本机库补丁

补丁仅增加日志，保留原有所有判断和返回值；即使 audioFileSeek 失败，也不在本任务中更改库继续尝试重填的行为。`library-hashes.json` 保存原文件与诊断版 SHA-256。原文件另备份于 `/tmp/radio-seek-library-original`。

在仓库根目录，对匹配本次原文件指纹的库应用或移除补丁：

```bash
RADIO_AUDIO_LIBRARY_DIR='/Users/liuxiaoyu/Documents/Arduino/libraries/ESP32-audioI2S-master'
patch --dry-run -p1 -d "$RADIO_AUDIO_LIBRARY_DIR" < radio-device/diagnostics/esp32-audioI2S-4.0.0-seek.patch
patch -p1 -d "$RADIO_AUDIO_LIBRARY_DIR" < radio-device/diagnostics/esp32-audioI2S-4.0.0-seek.patch
```

移除时先检查，再反向应用：

```bash
patch --dry-run -R -p1 -d "$RADIO_AUDIO_LIBRARY_DIR" < radio-device/diagnostics/esp32-audioI2S-4.0.0-seek.patch
patch -R -p1 -d "$RADIO_AUDIO_LIBRARY_DIR" < radio-device/diagnostics/esp32-audioI2S-4.0.0-seek.patch
```

修改库后需重新编译再烧录。只改 sketch 无法观察库内部阶段。

## 真机结果

2026-10-05 已烧录并复现，首次完整记录保存在 [seek-trace.txt](seek-trace.txt)。本次 `startOffsetMs=10613`，库排队到 10 秒、字节位置 640044：

```text
[seek] file-seek.begin: acceptRanges=0 dataMode=3
[seek] file-seek.no-ranges: result=-1
[seek] new-buffer.seek-result: result=-1 requested=640044
[seek] read.timeout: read=31029 expected=65535
[seek] new-buffer.read: read=-1 expected=65535
[seek] new-buffer.result: position=-1 ok=0
```

最早失败在 `audioFileSeek` 的支持标志检查：`m_f_acceptRanges=false`，原生 `httpRange` 和 `parseHttpRangeHeader` 都未执行，所以没有 seek Range 请求、seek 响应状态或 Range header 解析失败。库继续读取原连接，并在 3 秒重填窗口内只收到 31,029 字节，达不到 65,535 字节，最终 `newInBuffStart` 返回 -1 并停止。Wi-Fi 状态为 3，失败前库错误标志为 1。

支持标志在 `setDefaults` 清为 false，只有解析 `Accept-Ranges` 值为 bytes 时才置 true；`Content-Range` 只记录信息，不会建立支持标志。与此同时，原生 `connecttohost` 首次请求已经带有 `Range: bytes=0-`。只读 HTTP 探测显示同一对象普通 GET 返回 200 并含 `Accept-Ranges: bytes`，Range GET 返回 206 和有效 `Content-Range`，却不含 `Accept-Ranges`。服务端能够返回分段数据，与库依赖该响应头的判断不匹配。

补充真机记录 [seek-trace-initial.txt](seek-trace-initial.txt) 已确认首次响应为 206、存在 Content-Range，随后 `acceptRanges=0`；未出现 Accept-Ranges 检测事件。本轮 `startOffsetMs=7995`、seek=7 秒，重填收到 65,229 / 65,535 字节后超时，失败链一致。注意这里的 206 属于首次连接，后续 seek 的 Range 请求仍没有发出。

[http-probe.json](http-probe.json) 与 [http-probe-initial.json](http-probe-initial.json) 分别记录两轮所选对象的节目状态和白名单 HTTP 字段。探测通过现有本地只读 API 获得同一对象的临时签名 URL，在内存中请求响应头及最多 16 字节，不输出 URL 或保存音频，也未改设备请求。三种探测分别为普通 GET、与首次连接一致的 Range: bytes=0-、目标位置的 16 字节 Range；它们是电脑端只读验证，不是替换固件请求。

失败后未出现 completed，选中的节目仍为 `status=ready`、`retired_at=null`。本任务不修复支持判定或被忽略的返回值，也不修改请求、超时、音频数据或架构。

主机回归已确认固定 ID 和整数能输出，含签名参数的未知消息不会被转发；失败进入 idle 前会派发末尾诊断，仍不会 completed。诊断固件编译与烧录通过。
