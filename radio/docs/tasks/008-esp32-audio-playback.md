# Task 008 — ESP32 最小音频播放：从 Device API 到 MAX98357A 扬声器

## 目标

Task 007 / 007A 已完成 Device Receiver API 与实体调台所需的持久节目库存缓冲。现在正式进入硬件主线。

本任务只证明一件事：

```text
ESP32-S3
→ Wi-Fi
→ Device Receiver tune API
→ 拿到 ready manifest
→ 直接从 signed audioUrl 流式读取音频
→ 解码
→ I2S
→ MAX98357A
→ 4Ω 3W speaker
```

最终验收不是“接口请求成功”，而是：**真实扬声器能连续播出一条宇宙电台节目。**

开始前读取最新 `main`，以最新实现为准。当前已知基线：

```text
cd355bfa8f4d64c3391a4473c150c2b22dfc18ed
fix: task 7.1
```

本任务先不要接 TFT、EC11，也不要做 tuning/static。

---

## 一、硬件基线

使用：

```text
ESP32-S3 N16R8
16MB Flash
8MB PSRAM
```

音频：

```text
MAX98357A
VIN  -> 5V
GND  -> ESP32 common GND
BCLK -> GPIO4
LRC  -> GPIO5
DIN  -> GPIO6
SD   -> 3V3
GAIN -> floating
```

扬声器：

```text
4Ω 3W
```

注意：MAX98357A 是 bridge output：

```text
SPK+ -> speaker+
SPK- -> speaker-
```

**SPK- 绝不能接 GND。**

ESP32-S3 GPIO 不耐 5V。

---

## 二、固件目录

仓库目前没有宇宙电台硬件固件目录。

请新建一个独立 Arduino sketch，例如：

```text
radio-device/
  radio-device.ino
  secrets.example.h
  .gitignore
  README.md
```

不要修改已有：

```text
drum/
drum-web/
```

`radio/` 继续是 Next.js Web / server 代码。

真实 Wi-Fi 密码、Device API token、电脑局域网地址不要提交到 Git。

建议：

```cpp
// secrets.example.h
#define WIFI_SSID ""
#define WIFI_PASSWORD ""
#define DEVICE_API_BASE_URL "http://192.168.x.x:3000"
#define DEVICE_API_TOKEN ""
```

本机复制为：

```text
secrets.h
```

并通过 `radio-device/.gitignore` 忽略。

不要把 Supabase service-role key、DeepSeek key、TTS key 放入 ESP32。

---

## 三、Device API

服务器使用现有：

```text
pnpm dev:device
```

ESP32 从局域网访问：

```http
POST http://<laptop-lan-ip>:3000/api/device/receiver/tune
Authorization: Bearer <DEVICE_API_TOKEN>
Content-Type: application/json
```

请求体第一版可直接：

```json
{
  "excludeProgramIds": []
}
```

返回：

```json
{
  "result": "signal",
  "manifest": {
    "programId": "...",
    "title": "...",
    "format": "news",
    "signalKind": "news",
    "audioUrl": "https://...signed...",
    "audioExpiresAt": "...",
    "durationMs": 60000,
    "startOffsetMs": 12000,
    "captions": [],
    "retireOnComplete": true
  }
}
```

或者：

```json
{ "result": "no_signal" }
```

要求：

- 使用 Bearer token；
- ESP32 不访问 localhost 管理 API；
- ESP32 不知道 Supabase service-role；
- `audioUrl` 是服务器生成的短期 signed URL；
- 音频文件直接从 Supabase Storage 流式读取；
- 不让 Next.js 代理整个音频文件。

JSON 解析可使用 ArduinoJson 等成熟轻量库，不要自己写脆弱字符串切割。

---

## 四、Wi-Fi 与 tune 流程

第一版只做明确、易调试的启动流程：

```text
boot
→ connect Wi-Fi
→ POST device tune
→ signal ?
    yes -> stream & play one program
    no  -> Serial 输出 no_signal，进入 idle
```

不要在本任务做无限自动扫台。

如果 Wi-Fi 连接失败：

- 明确 Serial 输出；
- 不崩溃重启风暴；
- 可以有限重试或进入可诊断状态。

Serial 至少输出：

```text
Wi-Fi connecting
Wi-Fi connected: <local ip>
tune request
signal / no_signal
program title
signalKind
audio playback started
audio playback completed / failed
```

不要打印：

- `DEVICE_API_TOKEN`
- 完整 signed URL（query string 中包含临时授权信息）
- 任何服务端 secret

调试时最多打印 audio host / path 简要信息。

---

## 五、音频必须流式播放

这是本任务最重要的技术约束。

禁止：

```text
HTTP GET
→ 整个 WAV/MP3 下载进 RAM / PSRAM
→ 再播放
```

必须：

```text
HTTP(S) stream
→ 小 buffer
→ decoder
→ I2S continuously
```

PSRAM 可以被成熟音频库用于内部缓冲，但不能把整个节目当作 blob 下载后再播。

当前正式 Renderer / procedural music 主要产出：

```text
32kHz
mono
16-bit PCM WAV
```

手动 fallback 仍可能有 MP3/WAV。

请选择一个**成熟且支持 ESP32-S3 的 Arduino 音频流方案**。优先选择能够同时处理：

- HTTP / HTTPS URL streaming
- WAV
- MP3
- I2S output
- ESP32-S3

不要在本任务自己从零实现 MP3 decoder。

如果采用第三方库：

1. 在 `radio-device/README.md` 写清库名与安装方式；
2. 若能确定版本，记录已验证版本；
3. 不要为了抽象库再封装大型音频 framework；
4. 当前生成的 WAV 必须作为最低验收格式；
5. 如果所选成熟库天然支持 MP3，则保留支持；没有 MP3 测试素材时不要求人为制造复杂测试。

---

## 六、I2S 原则

当前只有网络节目播放，因此：

```text
NETWORK_AUDIO owns I2S
```

I2S pins 固定：

```cpp
BCLK = 4
LRC  = 5
DIN  = 6
```

后续 Task 009 才会增加：

```text
TUNING / static owns I2S
BUFFERING
PLAYING / network decoder owns I2S
```

所以本任务代码不要做出“多个对象同时写 I2S”的结构。

保持一个明确的 audio output owner，为后续切换留出简单边界即可。

---

## 七、startOffsetMs 本任务先不实现

Web Receiver 调入节目时会：

```text
startOffsetMs > 0
→ audio.currentTime = offset
```

ESP32 的 HTTP 流若要从中途开始，需要额外处理：

- HTTP Range
- WAV byte offset / header
- 或音频库自身的 seek 能力
- MP3 seek 又有不同复杂度

**Task 008 暂时不要因为它扩大范围。**

本任务允许：

```text
收到 startOffsetMs
→ Serial 记录其存在
→ 实际从 0 开始播放
```

必须在 README / 代码注释里明确：

```text
Task 008 intentionally ignores startOffsetMs.
```

后续实体调台体验收口前再解决 HTTP stream seek / Range。

不要伪装成已经实现了 offset。

---

## 八、自然播放结束与 completed

如果音频自然播放到结尾：

调用：

```http
POST /api/device/receiver/programs/<programId>/completed
Authorization: Bearer <DEVICE_API_TOKEN>
```

要求：

- 只在真正自然播放完成后调用；
- 播放失败不调用；
- 用户中途切台的逻辑本任务还没有，所以不要为了测试伪造 completed；
- completed 成功后进入 idle；
- 本任务不要自动 tune 下一条，避免刷掉大量库存。

服务端会自行 best-effort 补回一条库存；ESP32 不负责 replenish。

---

## 九、HTTPS / signed URL

Device API 当前是可信 LAN 内的 prototype HTTP；`audioUrl` 是 Supabase HTTPS signed URL。

要求：

- 音频请求必须支持 HTTPS；
- 正确处理 signed URL 中较长的 query string；
- 正确处理可能的 HTTP redirect；
- 不把 signed URL 写死；
- 每次 tune 使用 manifest 当前返回的 URL。

如果所选 Arduino 音频库需要单独配置 TLS client，请使用它推荐的 ESP32-S3 方式。

如果为了 prototype 暂时使用 `setInsecure()`，必须：

- 只用于 signed audio HTTPS prototype；
- 在 README 明确标记为临时方案；
- 不要把“关闭证书校验”描述为正式安全实现。

不要为了 Task 008 自建音频代理服务器。

---

## 十、资源与稳定性

ESP32-S3 N16R8 资源足够，但第一版仍需保持简单：

- 不创建整个节目大小的内存 buffer；
- 不频繁动态复制整段 JSON / URL；
- 网络掉线时能够停止播放并输出错误；
- 播放失败后不要误报 completed；
- `loop()` 必须持续让音频 decoder / stream 获得运行机会；
- 不要在播放期间用长时间 blocking delay 卡住 decoder；
- 不需要 FreeRTOS 多任务架构，成熟音频库如无必要不要自己拆 task。

---

## 十一、README 必须包含手动验证步骤

请在：

```text
radio-device/README.md
```

写最短可执行说明，至少包括：

### 依赖库

列出 Arduino IDE / Library Manager 需要安装的库。

### 配置

```text
cp secrets.example.h -> secrets.h
填写：
- Wi-Fi SSID
- Wi-Fi password
- laptop LAN IP / API base URL
- DEVICE_API_TOKEN
```

### Web server

```bash
cd radio
pnpm dev:device
```

并确认 `.env.local` 中有同一个：

```dotenv
DEVICE_API_TOKEN=...
```

### 接线

明确写：

```text
MAX98357A VIN  -> 5V
MAX98357A GND  -> GND
MAX98357A BCLK -> GPIO4
MAX98357A LRC  -> GPIO5
MAX98357A DIN  -> GPIO6
MAX98357A SD   -> 3V3
MAX98357A GAIN -> floating
speaker -> SPK+ / SPK-
```

特别提示：

```text
SPK- 不接 GND
```

### 验证

```text
1. 先在 Web 管理页确认 ready inventory 有节目；
2. 启动 pnpm dev:device；
3. 烧录 ESP32；
4. 打开 Serial；
5. 看到 Wi-Fi connected；
6. 看到 tune signal；
7. 扬声器实际播出节目；
8. 自然播放结束后看到 completed 请求成功。
```

---

## 十二、编译检查

如果当前环境有 Arduino CLI / PlatformIO 且可以直接编译，请对 ESP32-S3 做一次编译验证。

如果环境没有完整 Arduino toolchain：

- 不要伪造“编译通过”；
- 做静态 review；
- 把用户需要安装的第三方库写清；
- 在总结中明确哪些部分必须由真实 Arduino 环境验证。

本任务最终一定需要用户上板试听，因此 Codex 不需要假装完成硬件验收。

Web 端如无必要不要改；如果确有兼容性问题才做最小修改，并确保：

```bash
cd radio
pnpm test:checkpoint-b
pnpm lint
pnpm typecheck
pnpm build
```

仍通过。

---

## 本任务明确不做

- TFT / ST7735
- U8g2 中文显示
- EC11
- 旋钮调台
- tuning/static 本地噪声
- 多个 I2S owner
- `startOffsetMs` seek / Range
- 自动连续播放多条节目
- Device inventory replenish API
- Wi-Fi 配网页面
- mDNS
- MQTT / WebSocket
- OTA
- microphone
- voice assistant
- Supabase service-role 下发
- TTS 调优
- robot voice
- AI singing

---

## 验收标准

代码层面：

1. 新增独立 `radio-device` Arduino sketch；
2. Wi-Fi / token 等 secret 不提交；
3. ESP32 能用 Bearer token 调 Device tune；
4. 正确解析 `signal / no_signal` 与 manifest；
5. 不把完整 signed audio 文件加载进 RAM/PSRAM；
6. 使用 HTTP(S) streaming + decoder + I2S；
7. I2S pins 为 GPIO4 / GPIO5 / GPIO6；
8. 当前 Renderer 的 32kHz mono 16-bit PCM WAV 能进入播放链路；
9. 自然播放结束后调用 Device completed；
10. 播放失败不 retire；
11. 不实现 TFT / EC11 / static / offset；
12. README 有明确依赖、接线、配置、验证说明。

真实硬件验收：

```text
ESP32 上电
→ 连 Wi-Fi
→ tune 到一条 ready 节目
→ 不整文件下载
→ MAX98357A + 4Ω3W 扬声器实际连续播放
→ 播完后 completed 成功
```

完成代码后暂停，等待用户真实上板验证；不要开始 Task 009。