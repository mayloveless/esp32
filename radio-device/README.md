# Cosmic Radio Device — Task 008 / 008B

这是 ESP32-S3 到 MAX98357A 的最小单节目播放固件。启动时连接 Wi-Fi，使用 Device Receiver API 取得 manifest，然后把其中短期 signed audio URL 直接交给音频库流式解码并输出到 I2S。

本 sketch 不含 TFT、EC11、调谐静电、自动下一条或自行实现的 HTTP Range。Task 008B 已加入 `startOffsetMs`：等待流就绪后，通过音频库原生 seek 接入节目中途。

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

`no_signal`、Wi-Fi 失败、manifest 解析失败或播放失败都会进入 idle，不会伪造 completed，也不会自动 tune 下一条。播放期间 `loop()` 每轮都让 decoder 继续运行，没有长时间 delay。

Device tune 使用 HTTP/1.0，避免将 HTTP chunked 分块标记交给 JSON 解析器。音频库 4.0.0 的 EOF 延迟一轮派发，且音频头超时也可能发送 EOF：固件会先排空停止时的事件，确认流已就绪、产生过真实音频样本且没有已报告错误，再上报 completed。15 秒未产生样本或播放位置连续 30 秒没有推进会停止播放；断网也会停止，不上报完成。样本回调只设置原子标志，不创建任务或改变 I2S 输出。

中途接入：保存 manifest 的 offset，在主循环收到 `stream ready` 后，每条节目最多调用一次 `setAudioPlayTime(startOffsetMs / 1000)`，使用秒级精度。正数不足 1 秒时调用原生 seek 到 0 秒；超过 API 的 `uint16_t` 秒数范围时拒绝，避免截断。等待 seek 期间的样本不算播放成功的依据。seek 请求接受后重新计算启动与进展超时；失败输出 `audio seek failed`，停止并进入 idle，不从头继续，不发送 completed，也不自动调台。

4.0.0 的 seek 接口返回成功表示接受了请求（日志为 `audio seek queued`），实际网络读取由随后的音频库循环执行，原有错误、断网与停滞保护继续生效。固件不自行计算 WAV 字节偏移、构造 Range 或下载整条文件。真机仍需确认实际听到的切入位置；若库的 HTTP WAV seek 不可靠，记录现象后停止，不以代理或整文件下载绕过。

上板时还需验证：音频响应头正常但 body 卡住、播放中断网、音频 body 中途停传，均应输出失败且服务端节目不被下线；正常播完应只发送一次 completed。

Wi-Fi 排查：连接后和 HTTP 失败时输出设备 STA MAC、所连 SSID、热点 BSSID、信道、RSSI、IP、网关、子网掩码和 DNS。关联、取得 IP、丢失 IP、断线事件附带启动后的毫秒时间；断线包含 SDK 原因码及名称。即使 tune 失败进入 idle，也每 15 秒报告连接状态。事件回调只写入一个固定长度队列，由主循环输出；不会打印 Wi-Fi 密码或 Device token，也不会自动重新 tune。HTTP 负数是客户端传输错误，不是服务器 HTTP 状态码，日志会附库提供的错误说明。

tune 失败后还会对网关进行一次限时 HTTP GET 探测，只输出状态码，并在 lwIP 线程读取网关 ARP MAC。不发送 Device token，也不输出网关管理页内容。可将 `Gateway MAC` 与电脑的 `arp -n <gateway-IP>` 对照，判断是否存在同名 Wi-Fi / 相同网段但实际网关不同的情况；网关关闭 HTTP 服务时，HTTP 探测失败本身不能证明 Wi-Fi 已断开。

配置 `WIFI_GATEWAY_MAC` 时，启动后扫描同名 SSID 并最多依次验证 8 个热点，每个连接最多等待 15 秒。只在网关 MAC 匹配后固定该热点 BSSID、发送一次 tune；找不到匹配网关则进入 diagnostic idle。这个选项用于选择正确局域网，不是网关身份认证。SSID 和密码无需改动，也不会无限扫描或连续消费节目。

2026-10-05 实测：同名 Wi-Fi 原先接入不同网关，导致 Device API 连接超时。启用网关选择后，ESP32 进入电脑所在局域网，电脑 ping 设备成功、ARP MAC 与 STA MAC 一致，Device tune 返回 signal，并进入网络音频播放。路由器名称和 Wi-Fi 密码无需修改。

Task 008 已实际出声，串口曾确认自然完成及 completed 成功。用户仍反馈音频不流畅，该问题暂缓排查，不能视为连续播放验收通过。008B 基于远程提交 `1f4f88f` 开发，之前的 EC11 工作完整保存于 stash `fc994c05c7085c68a5e70914aa2fe8dd55ea0479`，本检查点不启用旋钮。

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
```

检查直接提取 sketch 的播放函数，用模拟音频库验证 EOF 延迟派发、音频头超时、错误、断网、无进展超时及计时器回绕；也覆盖 offset 0、等待 ready、单次 seek、毫秒转秒、范围检查、seek 失败不 completed、seek 后自然 EOF 与失败保护。这不等同于 ESP32 编译或硬件验收。

## 安全与调试边界

- Serial 只输出 signed audio URL 的 host/path，绝不输出 query string、Device token 或 Wi-Fi 密码。
- `startOffsetMs` 通过库原生 seek 实现，日志记录 offset、实际请求秒数和结果；不自行构造 HTTP Range。
- 本任务仅有 `NETWORK_AUDIO` 一个 I2S owner；没有 static/tuning、多个输出或 FreeRTOS 自建音频任务。
- 使用 Arduino IDE 内置 CLI、ESP32 Core 3.3.12、ESP32-audioI2S-master 4.0.0、ArduinoJson 7.4.3 编译并烧录到检测为 16MB Flash / 8MB PSRAM 的 ESP32-S3。Task 008 的出声与 completed 已确认；008B 的实际 seek 未通过，详见上述记录。
