# Cosmic Radio Device — Task 008 / 008B / 009A

这是 ESP32-S3 到 MAX98357A 的最小单节目播放固件。启动时连接 Wi-Fi，使用 Device Receiver API 取得 manifest，然后把其中短期 signed audio URL 直接交给音频库流式解码并输出到 I2S。

本 sketch 支持 EC11 旋转调台与 `startOffsetMs`，等待流就绪后通过音频库原生 seek 接入节目中途。开机自动播放一条，此后仅用户旋转会换台；当前节目出声后后台预取下一条 manifest。不含 TFT、调谐静电、按键功能或自动播放下一条。

## 硬件与接线

目标板：ESP32-S3 N16R8（16MB Flash、8MB PSRAM）。MAX98357A：

| MAX98357A | ESP32-S3 |
| --- | --- |
| VIN | 5V |
| GND | GND（共地） |
| BCLK | GPIO4 |
| LRC | GPIO5 |
| DIN | GPIO6 |
| SD | 3V3 |
| GAIN | 悬空 |

4Ω 3W 扬声器只接 MAX98357A 的 `SPK+` 与 `SPK-`。`SPK-` 是 bridge output，**绝不能接 GND**。ESP32-S3 GPIO 也不耐 5V。

## EC11 旋转调台（009A）

沿用鼓机接线，在 [controls.h](controls.h) 中配置：VCC → 3.3V、GND → GND、S1/CLK → GPIO7、S2/DT → GPIO15、KEY/SW → GPIO16。CLK/DT 使用内部上拉；GPIO16 仅保留定义，按键无功能。

第一次有效相位变化即记录旋转，主循环停止旧节目、排空旧回调、清除 seek/EOF/错误状态并进入 tuning。任一方向都视为调台，不等待完整 detent。中断只更新少量输入状态，不操作网络、Serial 或音频；忽略无效两位跳变和间隔小于 2 ms 的边沿，主循环没有去抖 delay。

最后一次有效动作后停稳 300 ms，优先使用有效预取 manifest；缓存未命中时只发送一次现场 Device tune。HTTP 请求、读取 manifest 或连接音频期间有新旋转时，丢弃旧结果，等新动作停稳。旋转即使发生在 Audio.loop 内，也先处理手动停播，再判断 EOF，防止误 completed。

每个成功接受的节目加入内存中最近两条历史；Device tune 的 excludeProgramIds 带上这些 ID。no_signal 保持 idle，保留排除项，不放宽历史或自动重试。中途换走的节目不 completed、不 retire；新 signal 继续使用既有 startOffsetMs、库补丁和失败保护，自然 EOF 才 completed。

必要日志为 encoder activity、manual retune: stop current program、tuning settled、tune request，不逐 loop 输出。

## Arduino 依赖

在 Arduino IDE 的 Boards Manager 安装 **esp32 by Espressif Systems 3.x**，然后选择 ESP32-S3 对应开发板，并启用板载 PSRAM。当前 `ESP32-audioI2S` 4.0.0 上游要求 Arduino-ESP32 Core 3 与 PSRAM。

在 Library Manager 安装：

- `ESP32-audioI2S-master` by schreibfaul1，4.0.0（Library Manager 中的完整名称）；当前上游声明支持 ESP32-S3、MAX98357A、HTTP(S) streaming、WAV 与 MP3。该库采用 GPL-3.0，使用前请确认项目许可策略。
- `ArduinoJson` by Benoit Blanchon，7.x。

N16R8 的 Arduino IDE 参数：板型 `ESP32S3 Dev Module`、Flash Size `16MB`、PSRAM `OPI PSRAM`、Partition Scheme `16M Flash (3MB APP/9.9MB FATFS)`。使用 USB 转串口连接时保持 USB CDC On Boot 为 Disabled；上传速度可选 `460800`。不要沿用默认的 4MB Flash / PSRAM Disabled。

正式 Renderer 输出的 32kHz、mono、16-bit PCM WAV 是本 sketch 的最低验收格式；同一库也支持 MP3。音频播放调用 `Audio::connecttohost()`：它持续从 signed URL 读取、解码并写入唯一的 I2S 输出，不会由 sketch 把整条音频读入 RAM/PSRAM。Supabase signed URL 使用 HTTPS，由音频库处理。注意：4.0.0 库内部调用 `setInsecure()`，不校验服务器证书；这是 signed audio HTTPS 的临时原型方案，不是正式 TLS 安全实现。

## 配置

复制并填写私密配置：

```bash
cd /home/wlf/esp32/radio-device
cp secrets.example.h secrets.h
```

在 `secrets.h` 填写：

- `WIFI_SSID`
- `WIFI_PASSWORD`
- `WIFI_GATEWAY_MAC`（可选），同名热点对应不同网络时填写电脑实际网关 MAC，例如电脑上 `arp -n <gateway-IP>` 的结果；留空保留普通连接方式。
- `DEVICE_API_BASE_URL`，例如 `http://192.168.1.20:3000`，必须是电脑的局域网 IP，不是 `localhost`
- `DEVICE_API_TOKEN`

`secrets.h` 被忽略，不要提交。ESP32 只持有 Device token；不要放入 Supabase service-role、DeepSeek、TTS 或其他服务端密钥。

## 启动 Web 服务

```bash
cd /home/wlf/esp32/radio
pnpm dev:device
```

确认 `radio/.env.local` 中的 `DEVICE_API_TOKEN` 与 `secrets.h` 相同，并先在 Web 管理页准备至少一条 ready inventory 节目。Device API 的 LAN 访问只应在受信任本地网络中使用。

## 手动验证

1. 确认 MAX98357A 与扬声器按上表接线，尤其 `SPK-` 不接 GND。
2. 在 Arduino IDE 中选择 ESP32-S3 N16R8 对应板型、启用 PSRAM，烧录 `radio-device.ino`。
3. 打开 115200 baud Serial Monitor。
4. 预期看到 `Wi-Fi connected`、`tune request`、`signal`、节目标题和 `audio playback started`。
5. 确认 `startOffsetMs`。大于 0 时应接着看到 `seeking to: N s` 与 `audio seek queued`，随后实际跳转成功才有 `audio seek applied: position=N`；扬声器应从中途播放；0 时正常从头播放。
6. 自然播完后，预期看到 `audio playback completed` 和 `completed request succeeded`；此时服务端会机会式补一条库存。

`no_signal`、Wi-Fi 失败、manifest 解析失败或播放失败都会进入 idle，不会伪造 completed，也不会自动 tune 下一条。Wi-Fi 已连接时可旋转手动重试。播放期间 `loop()` 每轮都让 decoder 继续运行，没有长时间 delay。

Device tune 使用 HTTP/1.0，避免将 HTTP chunked 分块标记交给 JSON 解析器。音频库 4.0.0 的 EOF 延迟一轮派发，且音频头超时也可能发送 EOF：固件会先排空停止时的事件，确认流已就绪、产生过真实音频样本且没有已报告错误，再上报 completed。15 秒未产生样本或播放位置连续 30 秒没有推进会停止播放；断网也会停止，不上报完成。样本回调只设置原子标志，不创建任务或改变 I2S 输出。

中途接入：保存 manifest 的 offset，在主循环收到 `stream ready` 后，每条节目最多调用一次 `setAudioPlayTime(startOffsetMs / 1000)`，使用秒级精度。正数不足 1 秒时调用原生 seek 到 0 秒；超过 API 的 `uint16_t` 秒数范围时拒绝，避免截断。等待 seek 期间的样本不算播放成功的依据。seek 请求接受后重新计算启动与进展超时；失败输出 `audio seek failed`，停止并进入 idle，不从头继续，不发送 completed，也不自动调台。

4.0.0 的 seek 接口返回成功表示接受了请求（日志为 `audio seek queued`），实际网络读取由随后的音频库循环执行，原有错误、断网与停滞保护继续生效。固件不自行计算 WAV 字节偏移、构造 Range 或下载整条文件。真机仍需确认实际听到的切入位置；若库的 HTTP WAV seek 不可靠，记录现象后停止，不以代理或整文件下载绕过。

上板时还需验证：音频响应头正常但 body 卡住、播放中断网、音频 body 中途停传，均应输出失败且服务端节目不被下线；正常播完应只发送一次 completed。

Wi-Fi 排查：连接后和 HTTP 失败时输出设备 STA MAC、所连 SSID、热点 BSSID、信道、RSSI、IP、网关、子网掩码和 DNS。关联、取得 IP、丢失 IP、断线事件附带启动后的毫秒时间；断线包含 SDK 原因码及名称。即使 tune 失败进入 idle，也每 15 秒报告连接状态。事件回调只写入一个固定长度队列，由主循环输出；不会打印 Wi-Fi 密码或 Device token，也不会自动重新 tune。HTTP 负数是客户端传输错误，不是服务器 HTTP 状态码，日志会附库提供的错误说明。

tune 失败后还会对网关进行一次限时 HTTP GET 探测，只输出状态码，并在 lwIP 线程读取网关 ARP MAC。不发送 Device token，也不输出网关管理页内容。可将 `Gateway MAC` 与电脑的 `arp -n <gateway-IP>` 对照，判断是否存在同名 Wi-Fi / 相同网段但实际网关不同的情况；网关关闭 HTTP 服务时，HTTP 探测失败本身不能证明 Wi-Fi 已断开。

配置 `WIFI_GATEWAY_MAC` 时，启动后扫描同名 SSID 并最多依次验证 8 个热点，每个连接最多等待 15 秒。只在网关 MAC 匹配后固定该热点 BSSID、发送一次 tune；找不到匹配网关则进入 diagnostic idle。这个选项用于选择正确局域网，不是网关身份认证。SSID 和密码无需改动，也不会无限扫描或连续消费节目。

2026-10-05 实测：同名 Wi-Fi 原先接入不同网关，导致 Device API 连接超时。启用网关选择后，ESP32 进入电脑所在局域网，电脑 ping 设备成功、ARP MAC 与 STA MAC 一致，Device tune 返回 signal，并进入网络音频播放。路由器名称和 Wi-Fi 密码无需修改。

Task 008 已实际出声，串口曾确认自然完成及 completed 成功。用户仍反馈音频不流畅，该问题暂缓排查，不能视为连续播放验收通过。008B 基于远程提交 `1f4f88f` 开发，当时的 EC11 工作保存于 stash `fc994c05c7085c68a5e70914aa2fe8dd55ea0479`，008B 检查点未启用旋钮；009A 已恢复并按新任务调整，stash 备份仍保留。

### 008B 真机验收记录（2026-10-05）

主机回归与 ESP32 编译通过，固件占应用分区 2,078,987 字节（66%），烧录写入校验通过。真机选中《来自奥尔特云的回声》（节目 `1e2cc003-78bf-42de-8b45-1275322e3d09`，时长 60.287 秒），输出：

```text
startOffsetMs: 8301
seeking to: 8 s
audio seek succeeded
audio playback failed
```

接口返回成功后，随后的库网络播放阶段失败，设备进入 idle。Wi-Fi 保持连接，未出现 completed；读取本地节目接口确认 `status=ready`、`retired_at=null`，没有误下线。现有日志只保留库错误标志，不能据此判断具体底层失败原因，亦不能把 API 接受请求算作实际 seek 验收通过。

**真机中途接入尚未通过。** 按 008B 要求记录现象后停止；未改音频库、整文件下载、手工 Range 或代理，也未自动调台。后续需单独定位原生 HTTP WAV seek 的失败原因，并重新验证实际切入位置和自然完成。

HTTP WAV seek 的原始诊断与失败证据见 [diagnostics/README.md](diagnostics/README.md)。后续经授权修复了音频库的 Range 判定与重填路径，当前构建需要应用 [patches/README.md](patches/README.md) 中的库补丁；仅拉取 sketch 不会更新本机 Arduino 库。

### HTTP WAV seek 修复（2026-10-05）

有效的首次 206 / Content-Range 可以证明 Range 支持；后续 seek 响应必须与目标位置、文件总长和片段长度一致。失败立即停止，不再读取旧连接。修复后的 WAV seek 仅预填两个解码块（8 KiB），随后继续原生流式读取，保留 3 秒超时；其他格式保持原生预填量。Range 响应解析后保留完整文件长度，不把片段 Content-Length 当作总长。

`audio seek queued` 只表示请求被接受；`audio seek applied: position=N` 表示原生重填和格式对齐已完成。真机已确认跳转至 8 秒（位置 512044）、8 KiB 重填与 WAV 对齐通过，随后自然 EOF 与 completed 成功。用户确认有声音，但仍断断续续，连续播放流畅度尚未通过。完整记录见 [patches/README.md](patches/README.md)。

主机回归检查（Python 3 与支持 C++17 的 `clang++`，可通过 `CXX` 指定编译器）：

```bash
python3 radio-device/tests/playback_test.py
python3 radio-device/tests/controls_test.py
python3 radio-device/tests/library_seek_test.py
```

检查直接提取 sketch 的播放函数，用模拟音频库验证 EOF 延迟派发、音频头超时、错误、断网、无进展超时及计时器回绕；也覆盖 offset 0、等待 ready、单次 seek、毫秒转秒、范围检查、seek 失败不 completed、seek 后自然 EOF 与失败保护。这不等同于 ESP32 编译或硬件验收。

009A 控制检查直接提取实际调台、manifest 与播放函数，使用真实 ArduinoJson 和主机 I/O 替身；验证旋转立即停播、300 ms 合并、最近两条 JSON 排除项、no_signal 不重试/不清历史、请求期间过期结果丢弃、旧 EOF 排空、seek 保留及自然完成。需要已安装的 ArduinoJson 7.x 头文件，非默认库目录可设置 ARDUINO_LIBRARY_DIR。

### 009A 验收进度

远端任务提交 5201794 已快进拉取。恢复 stash 时只有 README 冲突，已保留 seek 基线并合并 009A 的旋钮说明，stash 备份仍保留。主机播放与控制回归通过；ESP32 Core 3.3.12 编译通过，固件占应用分区 2,091,295 字节（66%），烧录写入校验通过。已安装音频库的三个文件哈希与 seek 修复记录一致。

真机串口记录到两次 `encoder activity → manual retune: stop current program → tuning settled → tune request`，每段只有一次请求，均取得新 signal。《复古合成器 · 1174d2》（77c41f3b-916a-447e-bfdf-9ca59be7ed3e）以 startOffsetMs=7944 接入，原生 seek 至 7 秒 / 448044 成功；随后被旋转中断，没有 completed。下一条《异星信号 · f610e5》（c4602009-81ea-40ae-9859-4b6607ef7ddc）以 startOffsetMs=11982 接入，原生 seek 至 11 秒 / 704044 成功，最后自然 EOF，只上报一次 completed 并成功。

只读本地节目接口确认被中断的节目 `status=ready, retired_at=null`，自然播完的节目 `retired_at` 已设置。串口没有输出认证信息或 signed URL query。300 ms 边界、连续边沿合并、两条排除项的真实 JSON、请求期间新输入和旧 EOF 保护由主机回归覆盖；串口本身不记录每个边沿，不能单凭上述日志验证用户持续旋转的准确时序。用户确认可以切换，但反馈停稳后静音数秒才出声；双向手感和连续旋转的准确时序尚未单独确认。

声音断续按用户要求保留，不在本任务优化，也不开始 009B。

### 换台等待排查（2026-10-05）

用户确认换台可用，主要问题是停稳后静音数秒。Device tune 只选现有 ready 库存，不会在这个请求中生成节目；库存预热不能直接消除音频 HTTPS 建连及 seek 重连的等待。

通过串口接收时间戳测量，新 signal 的连接流程如下。首次样本为重启后自动 tune，第二次为旋钮调台，均在正确网关上；不含启动 Wi-Fi 扫描，也不含旋转停稳的 300 ms。seek 诊断事件由库在操作返回后集中派发，因此最后一项是重连、响应解析和重填的合计，不能从事件行间隔拆成各自耗时。

| 阶段 | 默认省电的样本 | 禁用省电的样本 |
| --- | --- | --- |
| tune 请求 → signal | 3.87 s | 3.06 s |
| signal → 音频连接建立 | 2.76 s | 1.23 s |
| 连接建立 → seek 接受 | 2.17 s | 1.28 s |
| seek 接受 → seek applied | 4.04 s | 2.75 s |
| tune 请求 → seek applied | 12.85 s | 8.32 s |

当前 sketch 在进入 STA 模式后调用 `WiFi.setSleep(false)`，并记录设置是否成功；接收器由 USB 供电，此设置会增加 Wi-Fi 功耗。调整版编译通过（2,091,663 字节，66%），烧录校验通过；新节目 seek 至 8 秒 / 512044 成功，之后第二次旋转也获得新 signal。音频库、300 ms 合并、历史排除项和 lifecycle 流程不变，没有增加自动调台、音频预取或缓存。

这是两个不同节目、不同时间的实测样本，网络和服务端耗时有波动，不能归因全部差值或承诺固定 8 秒；也不能以 seek applied 代替精确的扬声器首声时间。用户复测确认仍然等待很久，换台响应速度尚未验收通过。关闭省电的小调整保留，但不标记延迟问题已解决。

### Manifest 后台预取（2026-10-06，经用户授权扩大范围）

用户确认继续进行 manifest 预取，允许在旋转之前请求下一条节目信息。每个成功接受且开始产生音频样本的节目只尝试一次后台 Device tune，带上当前最近两条节目排除项。一个优先级为 1 的 FreeRTOS HTTP worker 仅请求/解析小型 JSON，不访问音频库、I2S、Serial、旋钮或当前播放状态；主循环以不等待的队列操作提交请求和接收结果，网络请求不会阻塞当前 audio loop。worker 使用 8 KiB 栈，最多一项任务与一项结果。

缓存只保存一条 manifest，含 signed URL；不预取或缓存音频 body，也没有第二条音频链路。后台返回 signal 时不修改最近节目历史，不调用 completed，也不会自动播放。手动停播后停稳 300 ms，若缓存仍有效且不在最近两条历史中，则输出 `manifest prefetch hit`，直接进入原有音频连接、startOffsetMs 原生 seek 和失败保护。消费缓存时才将新节目加入历史。

寿命以服务端 HTTP Date 与 manifest 的 audioExpiresAt 差值计算，预留 30 秒安全余量，最长保留 5 分钟，且从请求开始计时；不依赖 ESP32 UTC 时间。日期缺失/非法、URL 临近过期、no_signal、HTTP/JSON 失败或历史不匹配都不会自动重试。用户之后旋转时才按原流程现场 tune。自然 EOF 保持 idle，缓存也必须等下一次旋转才能播放。

快速旋转发生在后台请求未完成时，现场 tune 可以先执行；此时后台旧结果按代次丢弃，不能覆盖新的播放或 no_signal。缓存音频连接失败仍按原失败保护停播，不以失败为由再次请求节目。缓存是一次库存选择的快照；期间管理页的手动下线不会实时推送到设备。HTTPS 音频连接及 Range seek 仍在换台现场执行，因此预取只省掉 manifest 请求的等待，不承诺立即出声。

主机回归覆盖非阻塞入队、单次后台尝试、真实排除项 JSON、缓存命中与过期、UTC 日期及 millis 回绕、后台旧结果、停稳期间结果到达、新旋转打断缓存音频连接、失败回退、自然 EOF 与手动中断保护。真机编译通过（2,098,815 字节，66%；静态 RAM 60,932 字节，18%），烧录写入校验通过。启动节目原生 seek 至 7 秒 / 448044 成功并开始产生样本，随后后台请求 1,809 ms 完成，输出 `manifest prefetch ready`，有效期剩余 298,191 ms。随后当前节目自然 EOF，仅一次 completed 且接口成功；设备保持 idle，没有自动播放下一条。四分钟串口采集已正常退出并释放串口，尚未收到实体旋转，缓存命中及其耗时仍待用户验证。验证时请在新节目出声后等待约 5 秒再旋转；若设备已闲置超过缓存寿命，第一次会回退现场 tune，之后再测下一次。

用户随后反馈换台“快点儿了”，确认实际等待有所改善；该次操作未同步采集串口，尚未量化缓存命中后的首声耗时。调台沙沙声尚未实现，仍属于后续 009B；本检查点调台期间保持静音。原有音频断续问题仍暂缓。

## 安全与调试边界

- Serial 只输出 signed audio URL 的 host/path，绝不输出 query string、Device token 或 Wi-Fi 密码。
- `startOffsetMs` 通过库原生 seek 实现，日志记录 offset、实际请求秒数和结果；不自行构造 HTTP Range。
- 本任务仅有 `NETWORK_AUDIO` 一个 I2S owner；没有 static/tuning、多个输出或 FreeRTOS 自建音频任务。
- 使用 Arduino IDE 内置 CLI、ESP32 Core 3.3.12、ESP32-audioI2S-master 4.0.0、ArduinoJson 7.4.3 编译并烧录到检测为 16MB Flash / 8MB PSRAM 的 ESP32-S3。Task 008 的出声与 completed 已确认；008B 原始失败及后续 seek 修复验收见上述记录。
