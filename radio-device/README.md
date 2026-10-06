# Cosmic Radio Device — Task 008 / 008B / 009A / 009B / 010A

这是 ESP32-S3 到 MAX98357A 的最小单节目播放固件。启动时连接 Wi-Fi，使用 Device Receiver API 取得 manifest，然后把其中短期 signed audio URL 直接交给音频库流式解码并输出到 I2S。

本 sketch 支持 EC11 旋转调台与 `startOffsetMs`，等待流就绪后通过音频库原生 seek 接入节目中途。开机自动播放一条，此后仅用户旋转会换台；当前节目出声后后台预取下一条 manifest。009B 增加 FFat 本地调谐沙沙声，与网络节目共用同一个 Audio 对象。010A 增加 ST7735 状态、节目类型与中文标题显示。不含字幕、按键功能或自动播放下一条。

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

## ST7735 状态屏（010A）

使用已验证的 1.8" ST7735 128×160 面板，`initR(INITR_BLACKTAB)`，横屏 `setRotation(3)`，显示区域 160×128。用户因走线需要，将原 rotation 1 翻转 180° 为 3；接线不变。翻转版编译和烧录校验通过，应用与 RAM 占用不变；启动、11 秒原生 seek、PLAYING 及预取正常，串口已释放。

| ST7735 | ESP32-S3 |
| --- | --- |
| VCC / LED | 3.3V |
| GND | GND（共地） |
| CS | GPIO10 |
| RESET | GPIO8 |
| DC | GPIO9 |
| MOSI | GPIO11 |
| SCK | GPIO12 |

不使用 MISO。`RadioDisplay.h` 在编译期验证 TFT 五个引脚互不重复，且不占用 I2S GPIO4/5/6 或 controls.h 配置的 EC11 GPIO7/15/16。

显示库沿用本机安装：Adafruit GFX Library **1.12.6**（1.12.x）、Adafruit ST7735 and ST7789 Library **1.11.0**（1.11.x）、U8g2_for_Adafruit_GFX **1.8.0**（1.8.x），以及 Adafruit BusIO **1.17.4** 依赖。上述版本已用于本次编译；范围内其他版本仍需编译验证。

中文使用 `u8g2_font_wqy12_t_gb2312`，约 12px、7,539 个字形；库内字体数组 **208,526 字节**（约 204 KiB）。标题最多三行，按实际字形宽度排版，超过区域直接截断。模型最多保留 192 字节完整 UTF-8，非法字符替换为 `?`，换行等控制字符转为空格；字库未覆盖的 Unicode 字形（如 emoji）显示 `?`，常见中文正常显示。没有字幕或滚动标题。

`RadioDisplayModel.h` 只保存显示内容与 dirty flag；`RadioDisplay.cpp` 只负责绘制。画布在 setup 初始化后一次分配 **40,960 字节**，文字先画入画布，再通过一次 SPI 写入显示完整帧。只有状态、标题或类型实际变化时刷新，同一状态反复提交不刷新；ISR、音频回调和 HTTP worker 不操作 TFT。画布分配失败会在 Serial 报告并禁用显示，保留原音频链路。

开机依次显示 BOOTING / CONNECTING；转动时显示 TUNING，小幅反馈结束后恢复原节目界面。manifest 已准备或接入 HTTPS 时显示 LOCKING SIGNAL 与已知标题；seek 排队仍保持 LOCKING，原生 seek 应用后真正输出网络节目采样才显示 SIGNAL LOCKED。NEWS / CHAT / ALIEN / MUSIC 使用 ASCII。no_signal 及自然播完显示 NO SIGNAL，播放或 tune 失败显示 SIGNAL LOST，断网显示 NO NETWORK。屏幕不显示 IP、HTTP 错误码、授权信息、URL 或 programId。Wi-Fi 的启动网关选择和原有重连行为保持不变，TURN TO RETRY 提示不新增网络扫描或自动 tune。

本次最终构建（ESP32 Core 3.3.12、现有 3MB APP / 9.9MB FATFS 分区）占应用 **2,396,747 / 3,145,728 字节（76%）**，剩余 **748,981 字节**；相比 009B 增加 259,152 字节。静态 RAM **62,956 字节（19%）**，此外画布在运行时分配 40,960 字节。ELF 确认 GB2312 字体为 208,526 字节，保留原分区与音频功能。

010A 已通过六组 host regression、ESP32 编译与烧录写入校验。首版三分钟串口记录到四次原生 seek 应用成功（8 / 13 / 13 / 10 秒），均在 seek 应用后产生节目采样才显示 PLAYING；三次实体换台命中 manifest 预取，本地 static 产生样本，MUSIC / ALIEN / NEWS 的 manifest 均正常接入。首条节目自然 EOF 后显示 NO SIGNAL，仅一次 completed 且接口成功，随后保持 idle，直到下一次物理旋转。状态刷新耗时 18–24 ms，同一播放状态没有持续重绘；未记录到重启、mutex 断言、播放失败或 RingBuffer_Log。

该次实测发现，旋转中预取标题到达会导致第二次 TUNING 重绘。已修正模型：TUNING 中保存隐藏的标题/类型不再标 dirty，进入 LOCKING 时才一起显示；连续边沿和 manifest 到达不重复刷 TUNING 的回归已通过。串口证明的是软件状态与播放链路，屏幕实际中文、朝向、连续旋转闪烁和音频听感仍待用户确认，不能据此标记完整硬件验收通过。原有断续和换台等待数秒的问题保留；网络连接及 Range 期间仍沿用原主循环阻塞行为，显示不会改变这一限制。010B 尚未开始。

最终修正版再次编译与烧录校验通过；重新采集完整开机日志，确认 BOOTING / CONNECTING，FFat tuning WAV 命中缓存；拒绝错误网关后连接正确 AP，12 秒 / 768044 的原生 seek 成功，之后才提交 PLAYING 帧，预取耗时 1,838 ms。最终版刷新耗时 18–22 ms；两分钟采集未记录到播放失败或重启，结束后已释放串口。该轮没有新的实体旋转输入，修正后连续旋转只刷一次 TUNING 的真机验收仍待用户测试。

用户已确认屏幕有显示，并因走线要求翻转 180°。有状态提示后等待可以暂时接受，但最新反馈仍然不能快速播放；本版先保留并提交，换台接入延迟尚未解决，不能把显示反馈视为速度验收通过。

010A 的独立模型回归：

```bash
python3 radio-device/tests/display_model_test.py
```

覆盖状态映射、持续转动不重复标 dirty、新标题/类型、UTF-8 边界、三行截断和 malformed UTF-8（启用 AddressSanitizer / UBSan）。控制回归另外直接执行 sketch 的映射函数，验证 seek 排队、seek 应用、实际采样、临时旋转反馈和失败对应的屏幕状态。显示驱动不参与 host tests。

## EC11 旋转调台（009A / 009B 校准）

沿用鼓机接线，在 [controls.h](controls.h) 中配置：VCC → 3.3V、GND → GND、S1/CLK → GPIO7、S2/DT → GPIO15、KEY/SW → GPIO16。CLK/DT 使用内部上拉；GPIO16 仅保留定义，按键无功能。

第一次有效相位变化即记录旋转并更新原子反馈时间戳；正在播放时，唯一 Audio 的 raw PCM 回调将节目采样临时替换为低幅本地噪声，保留网络连接与预取。中断只更新少量输入状态，不操作网络、Serial 或音频；忽略无效两位跳变和间隔小于 2 ms 的边沿，主循环没有去抖 delay。

根据 2026-10-06 的用户手感反馈，换台改为转动幅度触发：累计同方向净 4 个有效相位边沿即选择并准备新节目；阻塞的 HTTPS/Range 接入等待停稳 300 ms，只执行一次。选中后以及新节目接入后保护 4 秒，保护期内累计净 16 个边沿可再次换台；反向边沿抵消累计位移，小幅转动停稳后清零。一段转动在新节目被接受前只允许一次选择，避免持续转动反复丢弃请求和重新连接。不同 EC11 的边沿数与机械角度关系不同，这些参数定义在 ReceiverControls.h，不声称精确的角度值。

小幅转动未达到换台阈值时，PCM 回调输出与本地 WAV 相同算法的噪声，并在最后一次有效边沿 150 ms 后恢复节目采样；不会 stopSong、connecttoFS、重新 HTTPS/seek，也不清掉预取缓存。回调内没有文件读写、网络、分配、Serial 或 Audio 控制调用。噪声替换整个节目采样块，不与节目混音，也不作为新网络播放成功的证据。若网络没有可供输出的 PCM（例如连接/seek 等待或断流），回调没有执行机会，此时不能保证反馈连续；没有添加第二个 Audio 或独立 I2S writer。

达到换台阈值才停止旧节目、排空旧事件并进入本地 WAV tuning；优先消费现有预取 manifest，没有则用原 HTTP worker 获取。返回的 manifest 在旋转中只保存到待播放区，不调用 connecttohost，停稳 300 ms 后才接入。static EOF 不 completed，实际手动换走的节目不 retire。

每个成功接受的节目加入内存中最近两条历史；Device tune 的 excludeProgramIds 带上这些 ID。no_signal 保持 idle，保留排除项，不放宽历史或自动重试。中途换走的节目不 completed、不 retire；新 signal 继续使用既有 startOffsetMs、库补丁和失败保护，自然 EOF 才 completed。

必要日志为 encoder feedback、manual retune: stop current program、dial travel threshold: retune、manifest prepared; waiting for dial stop、dial stopped: static off、dial locked: connect prepared program、tune request，不逐 loop 输出。

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

HTTP WAV seek 的原始诊断与失败证据见 [diagnostics/README.md](diagnostics/README.md)。后续经授权修复了音频库的 Range 判定与重填路径，当前构建需要应用 [patches/README.md](patches/README.md) 中的 HTTP seek 补丁及 009B 解码锁补丁；仅拉取 sketch 不会更新本机 Arduino 库。

### HTTP WAV seek 修复（2026-10-05）

有效的首次 206 / Content-Range 可以证明 Range 支持；后续 seek 响应必须与目标位置、文件总长和片段长度一致。失败立即停止，不再读取旧连接。修复后的 WAV seek 仅预填两个解码块（8 KiB），随后继续原生流式读取，保留 3 秒超时；其他格式保持原生预填量。Range 响应解析后保留完整文件长度，不把片段 Content-Length 当作总长。

`audio seek queued` 只表示请求被接受；`audio seek applied: position=N` 表示原生重填和格式对齐已完成。真机已确认跳转至 8 秒（位置 512044）、8 KiB 重填与 WAV 对齐通过，随后自然 EOF 与 completed 成功。用户确认有声音，但仍断断续续，连续播放流畅度尚未通过。完整记录见 [patches/README.md](patches/README.md)。

主机回归检查（Python 3 与支持 C++17 的 `clang++`，可通过 `CXX` 指定编译器）：

```bash
python3 radio-device/tests/playback_test.py
python3 radio-device/tests/controls_test.py
python3 radio-device/tests/display_model_test.py
python3 radio-device/tests/library_seek_test.py
python3 radio-device/tests/tuning_wav_test.py
python3 radio-device/tests/library_mutex_test.py
```

检查直接提取 sketch 的播放函数，用模拟音频库验证 EOF 延迟派发、音频头超时、错误、断网、无进展超时及计时器回绕；也覆盖 offset 0、等待 ready、单次 seek、毫秒转秒、范围检查、seek 失败不 completed、seek 后自然 EOF 与失败保护。这不等同于 ESP32 编译或硬件验收。

控制检查直接提取实际调台、manifest 与播放函数，使用真实 ArduinoJson 和主机 I/O 替身；验证旋转立即沙沙声、净位移阈值、4 秒保护/大幅越过保护、反向抵消、150 ms 停转结束反馈/小幅拨动不重新连接原节目，300 ms 稳定后才接入新节目、最近两条 JSON 排除项、no_signal 不重试/不清历史、请求期间过期结果丢弃、旧 EOF 排空、seek 保留及自然完成。需要已安装的 ArduinoJson 7.x 头文件，非默认库目录可设置 ARDUINO_LIBRARY_DIR。

### 009A 验收进度

远端任务提交 5201794 已快进拉取。恢复 stash 时只有 README 冲突，已保留 seek 基线并合并 009A 的旋钮说明，stash 备份仍保留。主机播放与控制回归通过；ESP32 Core 3.3.12 编译通过，固件占应用分区 2,091,295 字节（66%），烧录写入校验通过。已安装音频库的三个文件哈希与 seek 修复记录一致。

真机串口记录到两次 `encoder activity → manual retune: stop current program → tuning settled → tune request`，每段只有一次请求，均取得新 signal。《复古合成器 · 1174d2》（77c41f3b-916a-447e-bfdf-9ca59be7ed3e）以 startOffsetMs=7944 接入，原生 seek 至 7 秒 / 448044 成功；随后被旋转中断，没有 completed。下一条《异星信号 · f610e5》（c4602009-81ea-40ae-9859-4b6607ef7ddc）以 startOffsetMs=11982 接入，原生 seek 至 11 秒 / 704044 成功，最后自然 EOF，只上报一次 completed 并成功。

只读本地节目接口确认被中断的节目 `status=ready, retired_at=null`，自然播完的节目 `retired_at` 已设置。串口没有输出认证信息或 signed URL query。300 ms 边界、连续边沿合并、两条排除项的真实 JSON、请求期间新输入和旧 EOF 保护由主机回归覆盖；串口本身不记录每个边沿，不能单凭上述日志验证用户持续旋转的准确时序。用户确认可以切换，但反馈停稳后静音数秒才出声；双向手感和连续旋转的准确时序尚未单独确认。

009A 检查点中声音断续按用户要求保留，当时未开始 009B。

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

009A 检查点中，快速旋转时现场 tune 可先于后台请求执行；009B 改为共用原 HTTP worker，现场请求等待旧后台请求结束，此时旧结果按代次丢弃，等待期间继续服务本地 static。缓存音频连接失败仍按原失败保护停播，不以失败为由再次请求节目。缓存是一次库存选择的快照；期间管理页的手动下线不会实时推送到设备。HTTPS 音频连接及 Range seek 仍在换台现场执行，因此预取只省掉 manifest 请求的等待，不承诺立即出声。

主机回归覆盖非阻塞入队、单次后台尝试、真实排除项 JSON、缓存命中与过期、UTC 日期及 millis 回绕、后台旧结果、停稳期间结果到达、新旋转打断缓存音频连接、失败回退、自然 EOF 与手动中断保护。真机编译通过（2,098,815 字节，66%；静态 RAM 60,932 字节，18%），烧录写入校验通过。启动节目原生 seek 至 7 秒 / 448044 成功并开始产生样本，随后后台请求 1,809 ms 完成，输出 `manifest prefetch ready`，有效期剩余 298,191 ms。随后当前节目自然 EOF，仅一次 completed 且接口成功；设备保持 idle，没有自动播放下一条。四分钟串口采集已正常退出并释放串口，尚未收到实体旋转，缓存命中及其耗时仍待用户验证。验证时请在新节目出声后等待约 5 秒再旋转；若设备已闲置超过缓存寿命，第一次会回退现场 tune，之后再测下一次。

用户随后反馈换台“快点儿了”，确认实际等待有所改善；该次操作未同步采集串口，尚未量化缓存命中后的首声耗时。009A 检查点尚未实现调台沙沙声，当时调台期间保持静音；009B 实现见下节。原有音频断续问题仍暂缓。

## 本地调谐沙沙声（009B）

启动时 mount FFat，检查 `/radio-tuning.wav` 的固定 WAV 头、长度及 `/radio-tuning.version` 格式版本；缺失、截断或版本不符时重新生成。仅当磨损均衡层的整个逻辑 FAT 卷是擦除态时才初始化格式（忽略该层自身元数据），无法挂载的非空分区保留原数据并禁用 static，不会自动清盘。生成时用 512 字节块写临时文件，写完才替换目标文件，不在代码内嵌大 PCM 数组。文件为 32 kHz、mono、16-bit PCM，6 秒；固定 seed 的 xorshift 噪声经过简单平滑和首尾约 4 ms 渐变，PCM 峰值不超过满幅的 1/8。static volume=15，网络节目 volume=15；用户反馈 7 和 10 仍偏小，随后只提高 static 播放音量，PCM 内容与格式版本不变。

小幅旋转先走 NETWORK 的原 PCM 回调替换反馈，保留唯一 Audio 与连接；达到选择阈值，owner 先置 NONE，等 decoder 停止后用 Audio.loop 排空旧事件并清除 EOF/error/samples/seek，再切 STATIC_LOCAL_FILE、connecttoFS。静电 raw samples 等本地 stream ready 后只更新独立标记，EOF 只在 tuning 内重播 WAV，不上报 completed；本地文件启动或解码失败会禁用文件 static，调台仍可继续。

达到换台幅度立即消费预取或提交现场 manifest 请求，HTTP worker 最多执行一条请求。连续旋转期间只服务本地 WAV 和保存待播放 manifest，不反复连接网络。停转 150 ms 停止 static；停稳 300 ms 并有待播放 manifest 时，切 NONE 排空旧事件，再切 NETWORK 和 connecttohost，连接成功才恢复节目音量。NONE 以及新 stream ready 前的残留 PCM 清零；no_signal、请求或 manifest 失败会清理待播放 manifest、回 idle，不自动重试。boot tune 及 worker 不可用时保留同步请求退化路径。

用户反馈优先于原任务的停播/持续 static 细节：小幅拨动现在保留原连接，沙沙声只随有效转动而播放，不覆盖停稳后的 manifest 等待；禁止在旋转中立刻阻塞接入网络。实际换台的 HTTPS/Range 接入仍可能静音数秒。009B 不修改网络播放断续问题，也不添加第二个 Audio、音频 body 预取或自动下一台。

主机回归已覆盖单次 static 启动、连续旋转、静电 EOF 循环、两次 owner handoff 的 stop/drain/connect 顺序、旧 EOF/错误/raw samples 隔离、网络自然 EOF 与原生 seek、no_signal/失败停止、预取命中、异步现场请求及请求期间新旋转。独立生成检查验证标准 WAV 参数、保守幅度、首尾渐变、缓存无重复写入、版本更新、截断恢复和中断写入不覆盖旧目标，并检查空逻辑卷可初始化、非空不可挂载卷/读取错误不得自动格式化。ESP32 Core 3.3.12 编译通过：应用 2,133,071 字节（67%），静态 RAM 61,036 字节（18%）；烧录校验通过。

### 009B 真机验收进度（2026-10-06）

快进拉取任务提交 `e685d41`，基线为 `68c5ed4`。首次挂载暴露了 FFat 空分区判断顺序问题：磨损均衡层会先写入元数据，raw flash 因而不再全空。修复为先通过 SDK wear_levelling API 读取完整逻辑卷，仅在全空时允许 FFat 初始化；对应回归通过。921600/460800 下整区备份传输失败，115200 下成功只读备份了起始 64 KiB 与末尾 128 KiB（非整区备份）：起始全空，末尾仅三个页面有 64/64/48 字节元数据。固件独立检查完整逻辑卷后输出 `FFat initialized on blank volume`，随后生成 WAV；没有主动擦除非空分区。

首个出声版本串口确认 `local tuning WAV generated: 32000 Hz mono 16-bit, 6 s`。《异星信号 · 870aa5》以 startOffsetMs=6019 接入，原生 seek 至 6 秒 / 384044 成功，随后 `manifest prefetch ready: requestMs=952 validMs=299048`。

串口记录到多次实体调台，本地 WAV 每次启动后确实产生样本；三次 `encoder activity → local static ready` 的接收时间差约 96 / 134 / 88 ms，这是主循环检测到动作后的软件证据，不是扬声器首声测量。两次 `manifest prefetch hit` 保留快速路径；缓存未命中时，`tune request queued → local static ready → signal` 证明现场 manifest 请求期间仍服务本地 Audio.loop。连接新节目期间的再旋转输出 `tune superseded while connecting audio`，随后回 static 并丢弃旧选择。

《机械脉冲 · 0600aa》（daa0a3dd-8d9c-4f6a-88b1-1d0c587fc4b8）以 startOffsetMs=14080、14 秒 / 896044 接入，在同一采集记录中自然 EOF，仅一次 `audio playback completed` 与 `completed request succeeded`。此前被中断的 ff64af5d、3ad72e1d、9969dabb 三条节目经只读本地 API 查询仍为 `status=ready, retired_at=null`，没有错误下线。自然完成后重启验证输出 `local tuning WAV cached`，不再生成文件；随后网络 seek 至 10 秒 / 640044 和 prefetch 正常。

本次实体动作包含多次 300 ms 以上停稳，static 每段仅持续约 1–2 秒，尚未在真机记录到 6 秒 static EOF 循环；持续有效边沿不重复启动和 static EOF 不 completed 已由 host regression 验证。沙沙声连续性、实际音量与切换爆音仍待用户听感反馈，不能标记完整硬件验收通过。当前网络节目断续仍按原要求暂缓；完成后不开始 Task 010。

随后重启复测中再次实体旋转，static 与 cache hit 正常，但原生 seek 期间出现 FreeRTOS `xTaskPriorityDisinherit` 断言，设备重启。已暂停测试并解码 ELF 回溯，定位到音频库 playAudioData 忽略获取解码 mutex 超时后错误释放未持有锁；因此不能以之前的通过样本认为切换稳定。最小库补丁及获取锁超时回归见 [patches/README.md](patches/README.md)，原有 HTTP seek 行为不变；修复版编译通过（2,133,091 字节，67%；静态 RAM 61,036 字节，18%），烧录校验通过；修复版四分钟采集有 11 次 static 启动、7 次预取命中、9 次成功 seek，未再出现该 mutex 断言；没有记录到 static EOF 循环。一段串口显示 POWERON 重启，但没有断言或 panic，不能据此判断原因。用户确认节目有声，后来也听到 static，但音量很小；随后将 static 音量 7 → 10，仍保持低幅 PCM 与节目音量 15，校准版编译通过（2,133,091 字节，67%；RAM 61,036 字节，18%），后续串口记录 static 响应约 24–102 ms，用户确认“一转就有”，但随后仍反馈音量偏小，因此进一步提高至 15。音量 10 的采集曾出现两条 RingBuffer_Log 警告，尚未定位；不能据此标记切换完全稳定。用户同时反馈仍希望“一转就切”；修复版前两次 cache hit 到 seek applied 分别约 3.69 / 4.09 秒，说明即使免去 manifest 请求，网络 HTTPS 建连与 Range seek 的等待仍存在。随后用户明确改为角度阈值换台与短期保护，小幅旋转仍出沙沙声，按上述参数实施；网络接入等待仍存在，不能把幅度触发声称为节目即播。

幅度触发校准版的控制与播放回归通过：同向 4 边沿立即调台、4 秒内 16 边沿越过保护、反向抵消、时间戳回绕、300 ms 停转静音/恢复原节目、静电 EOF 循环、缓存命中、异步请求与选择过期、no_signal/错误不自动重试均有实际函数回归。ESP32 编译通过：2,136,863 字节（67%），RAM 61,124 字节（18%）。本版烧录校验通过，启动串口记录原生 seek 至 7 秒 / 448044 成功，随后 manifest prefetch ready，耗时 962 ms。该版随后被用户否定：沙沙声出现晚、停下来接入更慢；不能用启动成功替代旋钮验收。根因是旋转过程中立刻调用 connecttohost，以及小幅旋转也 stop/重连原节目。此版本已被本节所述保留连接反馈、延后接入的修复替代。

随后修复已通过控制/播放回归，覆盖 ISR 后主循环未运行时 PCM 立即反馈、150 ms 结束、反馈不标记网络成功、小幅拨动保持原连接与预取、8 秒旋转不重连/不重复请求、300 ms 停稳后仅接入一次、本地 EOF 循环以及错误/完成语义。ESP32 编译通过：2,137,595 字节（67%），RAM 61,140 字节（18%）。本次调整源于用户对幅度版的跟手退步反馈，实际切台的 HTTPS/Range 等待仍未消除。烧录校验通过，启动时自动拒绝错误网关并接到正确 AP，seek 至 6 秒 / 384044 成功，预取耗时 932 ms；串口随后记录到多次实体换台，预取在旋转中准备好，停稳后才接入；三个完整样本的接入到 seek applied 分别为 3.807 / 3.880 / 3.729 秒。用户确认“小幅拨动恢复快，但换台仍慢”：小幅反馈与保留连接已获确认，真正换台的网络接入加速仍未解决。期间没有记录到 mutex 断言或 RingBuffer_Log，但没有完成连续 6 秒本地 EOF 循环的真机验收。用户最后确认停转后仍等几秒，决定先保留并提交；换台加速尚未通过验收，本次不继续优化。诊断见 [tuning-latency.md](diagnostics/tuning-latency.md)。

## 安全与调试边界

- Serial 只输出 signed audio URL 的 host/path，绝不输出 query string、Device token 或 Wi-Fi 密码。
- `startOffsetMs` 通过库原生 seek 实现，日志记录 offset、实际请求秒数和结果；不自行构造 HTTP Range。
- 只有一个 Audio 对象与 I2S 输出；owner 在 NONE / NETWORK / STATIC_LOCAL_FILE 间切换，切换前停止并排空旧事件。HTTP worker 不接触音频。
- 使用 Arduino IDE 内置 CLI、ESP32 Core 3.3.12、ESP32-audioI2S-master 4.0.0、ArduinoJson 7.4.3 编译并烧录到检测为 16MB Flash / 8MB PSRAM 的 ESP32-S3。Task 008 的出声与 completed 已确认；008B 原始失败及后续 seek 修复验收见上述记录。
