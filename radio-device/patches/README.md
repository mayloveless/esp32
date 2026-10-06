# ESP32-audioI2S 4.0.0 设备补丁

针对诊断确认的失败：首次 `Range: bytes=0-` 返回有效 206 / Content-Range，却没有 Accept-Ranges，库未设置支持标志；后续 seek 返回 -1 后仍读取旧连接。

本补丁在已有诊断补丁上修复库本身，继续使用原生 HTTP Range、WAV 解码和单个 I2S owner，没有代理、整文件下载或 sketch 自行构造的 Range。

- 首次 206 必须有合法的完整字节范围、从 0 开始，且响应体长度一致，才建立 Range 支持标志。
- 后续 seek 必须返回 206，范围起点、终点、文件总长及已提供的 Content-Length 必须匹配原生请求；拒绝 200、缺失或错误范围、错误状态及不支持的 chunked 片段，避免从错误位置继续。
- 解析 Range 响应后恢复完整文件长度，Content-Length 不再将其改成剩余片段长度。
- audioFileSeek 的失败统一返回 -1；newInBuffStart 在返回位置不匹配时立即停止，不清空缓冲后继续读取旧连接。位置 0 仍是合法的成功值。
- HTTP WAV seek 只预填两个解码块（8 KiB），保留原生 3 秒超时与后续流式读取；其他格式的原生预填量不变。
- `audio seek queued` 表示 API 接受请求；只有原生重填和对齐成功才打印 `audio seek applied: position=N`。

## 安装与回退

`library-hashes.json` 记录诊断版和修复版源文件的 SHA-256。只对匹配指纹的已安装 4.0.0 应用。补丁依赖 `diagnostics/esp32-audioI2S-4.0.0-seek.patch`；若库仍为原版，先按 diagnostics/README.md 应用诊断补丁。已修复的库不要重复应用。

在仓库根目录，对诊断版先检查再应用：

```bash
RADIO_AUDIO_LIBRARY_DIR='/Users/liuxiaoyu/Documents/Arduino/libraries/ESP32-audioI2S-master'
patch --dry-run -p1 -d "$RADIO_AUDIO_LIBRARY_DIR" < radio-device/patches/esp32-audioI2S-4.0.0-http-seek.patch
patch -p1 -d "$RADIO_AUDIO_LIBRARY_DIR" < radio-device/patches/esp32-audioI2S-4.0.0-http-seek.patch
```

回退至诊断版：

```bash
patch --dry-run -R -p1 -d "$RADIO_AUDIO_LIBRARY_DIR" < radio-device/patches/esp32-audioI2S-4.0.0-http-seek.patch
patch -R -p1 -d "$RADIO_AUDIO_LIBRARY_DIR" < radio-device/patches/esp32-audioI2S-4.0.0-http-seek.patch
```

每次修改库后重新编译并烧录。诊断版另备份于本机 `/tmp/radio-seek-library-diagnostic`，原版于 `/tmp/radio-seek-library-original`；Git 中的补丁及指纹不依赖临时备份。

## 验证

```bash
python3 radio-device/tests/playback_test.py
python3 radio-device/tests/library_seek_test.py
```

后者直接提取指纹匹配的已修复库函数，用主机 I/O 替身验证 Range 响应、错误拒绝、文件总长与失败后不读旧流；不替代 Arduino 编译或真机验收。自定义库路径可设置 `RADIO_AUDIO_LIBRARY_DIR`。

首轮修复已确认 Range 请求发出、返回 206、目标字节范围验证通过；随后旧预填量 65,535 字节在 3 秒内只收到 54,168 字节，仍停止。证据见 [seek-trace-before-prefill.txt](seek-trace-before-prefill.txt)，因此随后将 HTTP WAV 预填量限制为两个解码块。

最终修复版已编译与烧录，2026-10-05 真机日志 [seek-trace-fixed.txt](seek-trace-fixed.txt) 确认：

```text
startOffsetMs: 8073
[seek] initial.range-supported: supported=1 fileSize=2688044
[seek] range.status: HTTP=206
[seek] range.validated: position=512044 fileSize=2688044
[seek] new-buffer.read: read=8192 expected=8192
[seek] new-buffer.align: offset=0 codec=1
[seek] new-buffer.result: position=512044 ok=1
audio seek applied: position=512044
```

原生 seek 实际跳转至 8 秒，后续 Range / 重填 / WAV 对齐全部通过。随后观察到自然 EOF、`audio playback completed` 和 `completed request succeeded`；用户听感确认已出声，但仍断断续续；seek 已通过，连续播放流畅度尚未通过。只读节目接口核对自然完成后 `retired_at` 已设置，见 [seek-program-after-completed.json](seek-program-after-completed.json)。

编译占用 2,083,967 字节（66% flash）、全局变量 60,260 字节（18% RAM）。主机两组回归、实际 ESP32-S3 编译、烧录校验与补丁正反向应用均通过。

用户随后再次确认 5 秒 seek（位置 320044）时 Range 206、8 KiB 重填及 WAV 对齐成功；声音断续仍存在，按用户要求暂缓排查，可继续后续开发。

## 009B 解码互斥锁修复（2026-10-06）

009B 的 FFat static → NETWORK 切换后，原生 seek 中真机出现 `xTaskPriorityDisinherit` 断言。ELF 回溯定位到 Audio::playAudioData() 的 xSemaphoreGive（原文件第 5259 行）：xSemaphoreTake 的 1 秒超时返回值被忽略，线程在未获得锁时继续解码并释放其他线程持有的 mutex。newInBuffStart 在 Range HTTP I/O 期间持有此锁，可能超过 1 秒；即使 m_f_lockInBuffer 已设，已经越过前置检查的解码线程仍可能正在等锁。

最小补丁只让 playAudioData 在 xSemaphoreTake != pdTRUE 时返回本轮，不解码、不释放未获得的锁；成功获得锁后保持原有解码与释放逻辑。没有增加 delay、扩大超时、第二个 Audio 或修改 Range 行为，原 seek 修复仍保留。新增指纹为 library-hashes.json 中 Audio.cpp 的 mutexGuard，fixed 指纹仍表示之前的 HTTP seek 基线。

先按上节应用 HTTP seek 修复，再应用：

```bash
patch --dry-run -p1 -d "$RADIO_AUDIO_LIBRARY_DIR" < radio-device/patches/esp32-audioI2S-4.0.0-decode-mutex.patch
patch -p1 -d "$RADIO_AUDIO_LIBRARY_DIR" < radio-device/patches/esp32-audioI2S-4.0.0-decode-mutex.patch
python3 radio-device/tests/library_mutex_test.py
python3 radio-device/tests/library_seek_test.py
```

回退本次 guard 使用同一补丁的 `patch -R`，会回到有该断言风险的 HTTP seek 基线。修改后必须重新编译并烧录；只有拉取 sketch 不会更新本机 Arduino 库。主机回归直接提取库的 playAudioData，验证失败获取锁不解码/不 give、之后成功迭代恢复、EOF 分支仅释放已获得锁，及原有前置 guard；原生 HTTP seek 回归同时通过。


## 010B 字幕播放时钟修复（2026-10-06）

`getAudioCurrentTime()` 在首次解码前 seek 的路径并非持续绝对时间。`setAudioPlayTime()` 使用尚未初始化的 `m_cat.tota_samples` 设置 `sum_samples`，随后 `calculateAudioTime()` 的 firstCall 又清零该计数；`m_haveNewFilePos` 只把当前返回值设为 seek 秒数，没有同步 nominal 样本计数，下一块因此退回 0 秒。即使先解码再 seek，duration 取整也可能让计数短暂退回一秒。

新增 [caption-clock.patch](esp32-audioI2S-4.0.0-caption-clock.patch) 在实际 seek 应用的 `m_haveNewFilePos` 分支，按应用后的字节位置、nominal bitrate 和 sample rate 重设 `sum_samples`，计入当前已解码块。只有 nominal 时钟路径受此修正；字幕继续直接使用库的绝对整秒时钟，无墙钟补间，也不二次叠加 startOffsetMs。补丁不修改 HTTP Range、预填、decoder/I2S 数据、mutex 或 completed 流程。

依赖前述 HTTP seek 和 decode-mutex 两个补丁，应用前的 Audio.cpp 应匹配 `mutexGuard` 指纹，应用后匹配 `captionClock` 指纹。已经应用时不要重复安装：

```bash
patch --dry-run -p1 -d "$RADIO_AUDIO_LIBRARY_DIR" < radio-device/patches/esp32-audioI2S-4.0.0-caption-clock.patch
patch -p1 -d "$RADIO_AUDIO_LIBRARY_DIR" < radio-device/patches/esp32-audioI2S-4.0.0-caption-clock.patch
python3 radio-device/tests/library_caption_clock_test.py
python3 radio-device/tests/library_seek_test.py
python3 radio-device/tests/library_mutex_test.py
```

回退该时钟修正使用此补丁的 `patch -R`，保留 HTTP seek 与 mutex 补丁，恢复旧时钟回零问题。必须重新编译和烧录。主机回归正反向验证指纹，并分别编译真实基线和当前库的时钟/seek 函数：复现早期 seek 的 8 → 0 → 1 秒，验证修复后 8 → 8 → 9 秒；同时覆盖已开始解码后 seek、duration 取整、seek 到零及音频停滞时墙钟不推进。原 seek 和 mutex 回归保持通过。

## 011A 单连接 PCM WAV 实验与 A/B 结果

基线为 `c1e1960`，任务文档来自 `0f472e5`。当前默认 `RADIO_FAST_WAV_START=0`，普通 `connecttohost()` / queued seek 继续使用原先的两次连接路径。没有服务端、manifest prefetch、EC11、字幕、completed 或 I2S owner 的架构变更。

新增两个独立补丁，必须按顺序应用在 `captionClock` 指纹之后：

```bash
patch --dry-run -p1 -d "$RADIO_AUDIO_LIBRARY_DIR" < radio-device/patches/esp32-audioI2S-4.0.0-start-timing.patch
patch -p1 -d "$RADIO_AUDIO_LIBRARY_DIR" < radio-device/patches/esp32-audioI2S-4.0.0-start-timing.patch
patch --dry-run -p1 -d "$RADIO_AUDIO_LIBRARY_DIR" < radio-device/patches/esp32-audioI2S-4.0.0-fast-wav-start.patch
patch -p1 -d "$RADIO_AUDIO_LIBRARY_DIR" < radio-device/patches/esp32-audioI2S-4.0.0-fast-wav-start.patch
```

`startTiming` 只增加实际 TLS connect 返回、WAV header ready、目标 GET 写出和严格 Range 校验完成时的整数 `millis()` 事件。sketch 在主任务打印相对锁台时间；raw-sample callback 只原子保存一次时间戳，不打印、不分配、不调用 Audio。只接受 NETWORK owner、stream-ready、非 pending seek、已应用 seek、无 tuning feedback 且有真实样本缓冲的回调。它表示首个允许输出的网络 PCM，不是麦克风测得的扬声器声波，也不是 `seek applied`。

每条节目一次 `[start] summary`：

- `prefetch=1` 才是 A/B 候选；启动请求和前台 tune 排除。
- `tls` 是实际成功的 TCP/TLS connect 次数；TLS 时间点打印第一次，各次连接均计数。
- `headerMs` 是锁台到 WAV 头解析完成；`rangeMs` 是目标 GET 写出到 Range header 验证通过，不包含 seek 的第二次 TLS。
- `totalMs` 是锁台到真实网络 PCM；各时间点使用事件携带的发生时间，不使用延迟派发/Serial 到达时间。
- `fallback=1` 必须排除 fast 成功统计。

实验入口 `connecttohostAtTime(url, uint16_t seconds)` 只在开关开启且 URL path 为 `.wav`、offset 可表达时调用。服务返回的 WAV 还须通过真实 RIFF chunk、PCM format、channels/bits、byteRate、blockAlign 和文件边界校验；不会假定 44-byte header。首个响应必须是有限 `bytes=0-8191`、206、匹配的 Content-Range 和明确正确的 Content-Length，拒绝重定向、错误状态、重复 framing 字段、Transfer-Encoding 和非 identity Content-Encoding。

完整读完 8192 字节后销毁初始缓冲；它从不进入 decoder/InBuff。只有此时 socket 仍 connected 且服务器未声明 close，才以显式 `httpRange(..., reuseConnected=true)` 在同一 client 上发送目标 GET，分支中无 stop/connect。第二个 206 沿用已有 strict range validator，额外要求明确正确的 Content-Length。目标按实际 PCM blockAlign 对齐，用同一个 decoder mutex 保护状态和两个解码块预填，保留原生 3 秒 prefill timeout。首次实际解码通过原 caption-clock 补丁按目标字节位置重设绝对样本计数。显式入口在同一 mutex 内完成原先 first-play 字段初始化，避免首个 decode 将 seek 后的读指针清零而导致尾部 stall。

失败输出常量阶段名 `fast wav start failed: <stage>`；关闭连接另有 `fast wav start: connection not reusable`。sketch 清掉失败尝试的事件/状态后明确 `fallback to legacy seek`，不 completed、不显示旧字幕、不送入初始 PCM。fallback 再失败走现有 failPlayback。其他 URL 格式直接使用稳定入口。

临时启用实验：把 [RadioStartTiming.h](../RadioStartTiming.h) 中默认宏设为 `1`，重新编译并烧录；测试完成恢复 `0` 并重新烧录。或者由本地编译参数显式定义该宏。不要仅修改库后沿用旧 binary。正式采用之前保持默认 `0`。

撤销实验，保留计时与之前三个修复：

```bash
# 先恢复 RADIO_FAST_WAV_START=0
patch --dry-run -R -p1 -d "$RADIO_AUDIO_LIBRARY_DIR" < radio-device/patches/esp32-audioI2S-4.0.0-fast-wav-start.patch
patch -R -p1 -d "$RADIO_AUDIO_LIBRARY_DIR" < radio-device/patches/esp32-audioI2S-4.0.0-fast-wav-start.patch
```

再移除计时补丁则使用 `start-timing.patch` 的 `patch -R`，回到 `captionClock` 指纹。各层新增 SHA-256 都在 library-hashes.json；补丁正向应用和主机测试中的逐层反向恢复已验证。

主机测试（实验补丁安装后）：

```bash
python3 radio-device/tests/library_fast_wav_test.py
python3 radio-device/tests/library_seek_test.py
python3 radio-device/tests/library_mutex_test.py
python3 radio-device/tests/library_caption_clock_test.py
python3 radio-device/tests/playback_test.py
python3 radio-device/tests/controls_test.py
python3 radio-device/tests/captions_test.py
python3 radio-device/tests/display_model_test.py
python3 radio-device/tests/tuning_wav_test.py
```

fast test 直接提取已校验指纹的原生初始请求构造、实验 API、httpRange、Range parser 和 playAudioData，通过可控 client/body/header 替身验证有限 GET、完整 body 边界、同 client 无 stop/reconnect、关闭/错误/malformed 拒绝、非标准 header、blockAlign、首帧 seek-relative 读指针与目标 Range 剩余字节的真实 EOF。seek/mutex/clock 原回归保留；时钟测试从补丁逐层恢复真实旧版本，另验证 fast API 提交的 `dataStart=54`、目标 `448054` 首帧为 7 秒、之后为 8 秒。controls 同时编译开关 0/1，验证成功不二次 seek、字幕绝对位置、natural EOF 只 completed 一次、失败事件不污染 fallback、双失败保留 idle/failure 语义、非 WAV 仍 legacy。playback 验证 raw callback 首次计时排除 static、feedback、seek 前样本、空缓冲并覆盖毫秒溢出。

本次 A/B 成功样本中位数从 5675.5 ms 降至 3282 ms（42.2%），一次 initial-body 超时回退单列。自然结束暴露的首帧读指针重置已修复，并追加真机 completed 成功验证；正式采用前保持默认关闭。完整真机数据、修复及验收边界见 [011a-fast-wav-start.md](../diagnostics/011a-fast-wav-start.md)。HTTP response body 读到 framing 边界后才能复用连接的协议依据：[RFC 9112 §9.3](https://www.rfc-editor.org/rfc/rfc9112.html#section-9.3)。Storage 文档支持 signed URL 下载，并不承诺本设备 TLS keep-alive 的可复用性；必须实测。
