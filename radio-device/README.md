# Cosmic Radio Device — Task 008

这是 ESP32-S3 到 MAX98357A 的最小单节目播放固件。启动时连接 Wi-Fi，使用 Device Receiver API 取得 manifest，然后把其中短期 signed audio URL 直接交给音频库流式解码并输出到 I2S。

本 sketch 不含 TFT、EC11、调谐静电、自动下一条、HTTP Range 或 `startOffsetMs` seek。收到 `startOffsetMs` 时会记录，但 **Task 008 有意从 0 ms 开始播放**。

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

- `ESP32-audioI2S` by schreibfaul1，4.0.0；当前上游声明支持 ESP32-S3、MAX98357A、HTTP(S) streaming、WAV 与 MP3。该库采用 GPL-3.0，使用前请确认项目许可策略。
- `ArduinoJson` by Benoit Blanchon，7.x。

正式 Renderer 输出的 32kHz、mono、16-bit PCM WAV 是本 sketch 的最低验收格式；同一库也支持 MP3。音频播放调用 `Audio::connecttohost()`：它持续从 signed URL 读取、解码并写入唯一的 I2S 输出，不会由 sketch 把整条音频读入 RAM/PSRAM。Supabase signed URL 使用 HTTPS，由音频库处理；本 sketch 没有调用 `setInsecure()` 或自行下载音频。

## 配置

复制并填写私密配置：

```bash
cd /home/wlf/esp32/radio-device
cp secrets.example.h secrets.h
```

在 `secrets.h` 填写：

- `WIFI_SSID`
- `WIFI_PASSWORD`
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
5. 扬声器应连续播出一条节目。
6. 自然播完后，预期看到 `audio playback completed` 和 `completed request succeeded`；此时服务端会机会式补一条库存。

`no_signal`、Wi-Fi 失败、manifest 解析失败或播放失败都会进入 idle，不会伪造 completed，也不会自动 tune 下一条。播放期间 `loop()` 每轮都让 decoder 继续运行，没有长时间 delay。

## 安全与调试边界

- Serial 只输出 signed audio URL 的 host/path，绝不输出 query string、Device token 或 Wi-Fi 密码。
- `startOffsetMs` 暂不做 seek / HTTP Range；日志会明确说明实际从 0 ms 播放。
- 本任务仅有 `NETWORK_AUDIO` 一个 I2S owner；没有 static/tuning、多个输出或 FreeRTOS 自建音频任务。
- 尚未在本环境编译或上板：这里没有 Arduino CLI/PlatformIO，也没有可访问的 ESP32-S3 与 MAX98357A。请按上述步骤进行真实硬件验收。
