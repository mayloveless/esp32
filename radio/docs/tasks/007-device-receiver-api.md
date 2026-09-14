# Task 007 — Device Receiver API：给 ESP32 一条独立、可控的接收机入口

## 目标

Task 006 已完成 Web Receiver 体验收口，并经过人工体验确认：调台、节目切换、字幕/译文和整体交互已经符合预期。下一步开始把同一套 Receiver 语义交给实体 ESP32。

本任务只做 **Device Receiver API**，先不要写 ESP32 音频解码代码。

目标链路：

```text
ESP32
  → laptop LAN device API
  → ready inventory
  → short-lived Supabase signed audio URL
  → ESP32 后续直接流式读取音频
```

关键边界：

- ESP32 永远不知道 Supabase service-role key；
- Device API 与现有本机管理 API 分开；
- 现有管理 API 继续只允许 localhost，不因为设备接入而放宽；
- tune 继续只消费 ready inventory，不现场等 AI；
- 不引入 WebSocket/MQTT/Redis/新服务；
- 本任务不接旋钮、TFT、I2S、扬声器。

开始前读取最新 main，以最新实现为准，不覆盖 Task 006 / 用户后续声音调校。

---

## 当前基线

最新已知基线：`1b0cc564ff938db44a8c7ca57a52cadd91a757cd`。

当前：

- `pnpm dev` 使用 `next dev --hostname 127.0.0.1`，ESP32 无法从局域网访问；
- 管理/Receiver API 使用 `assertLocalDevelopmentRequest()`，会拒绝非 localhost Host；
- `/api/receiver/tune` 已能从 active-ready inventory 构造完整 `ReceiverManifest`；
- manifest 已包含 `signalKind / audioUrl / audioExpiresAt / durationMs / startOffsetMs / captions / retireOnComplete`；
- 音频对象位于 private Supabase Storage，通过服务端签发短期 URL；
- Receiver tune 不等待 Inventory 生产。

不要直接放宽 `assertLocalDevelopmentRequest()`。

---

## A. 独立 Device Request Guard

新增轻量 device guard，例如放在：

```text
lib/device-api.ts
```

使用环境变量：

```dotenv
DEVICE_API_TOKEN=
```

并加入 `.env.example`，不要提交真实 token。

### 鉴权协议

设备请求使用：

```http
Authorization: Bearer <DEVICE_API_TOKEN>
```

要求：

1. `DEVICE_API_TOKEN` 未配置时，Device API 明确拒绝请求；
2. token 不匹配返回 403；
3. 不依赖浏览器 `Origin` / `Sec-Fetch-Site`，因为 ESP32 不是浏览器；
4. 不读取或返回 Supabase service-role key；
5. token 比较实现保持简单但不要直接把 token 打到日志；若方便可用 constant-time compare；
6. 不修改现有 `assertLocalDevelopmentRequest()` 语义。

第一版这是局域网 prototype token，不做用户账号、OAuth、JWT、设备注册表。

---

## B. 增加 LAN 开发启动方式

保留现有：

```json
"dev": "next dev --hostname 127.0.0.1"
```

新增独立脚本，例如：

```json
"dev:device": "next dev --hostname 0.0.0.0"
```

目的：

- 普通开发继续默认仅本机；
- 需要 ESP32 测试时显式运行 `pnpm dev:device`；
- 用户仍从 `http://127.0.0.1:<port>` 打开管理后台，这样 localhost 管理 guard 继续成立；
- ESP32 使用电脑的局域网 IP 访问 device endpoint。

不要为了设备访问把所有管理接口改成 LAN 可访问。

README / task 说明中简短注明这一点即可，不需要写网络教程。

---

## C. Device Tune API

新增：

```text
POST /api/device/receiver/tune
```

### 请求

沿用现有 tune 语义，支持：

```json
{
  "excludeProgramIds": []
}
```

允许空 body 的话也可以，但不要为了 ESP32 另造一套完全不同的 tune 规则。

### 返回

尽量复用当前 Web Receiver 的 manifest 类型/构建逻辑：

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
    "durationMs": 62000,
    "startOffsetMs": 12000,
    "captions": [],
    "retireOnComplete": true
  }
}
```

或：

```json
{ "result": "no_signal" }
```

要求：

- Device tune 与 Web tune 使用同样的 active-ready 选择语义；
- `excludeProgramIds` 行为一致；
- `startOffsetMs` 继续保留“调入正在播出的节目”的感觉；
- signed URL 继续由服务器生成；
- tune 不触发/等待 DeepSeek、TTS、procedural generation；
- no_signal 立即返回。

### 避免两份 manifest 拼装逻辑

当前 Web `/api/receiver/tune` 内部如果直接手工拼 manifest，建议抽取一个很薄的共享函数，例如：

```ts
createReceiverManifest(program)
```

负责 signed URL + captions + signalKind + startOffset。

Web API 与 Device API 都调用它。

不要引入 service framework。

---

## D. Device Completed API

新增：

```text
POST /api/device/receiver/programs/:id/completed
```

语义与当前 Web completed 一致：

- 只有节目实际自然播放结束时调用；
- retire ready Program；
- 幂等；
- 中途换台不调用 completed；
- Device API 自己做 Bearer token 校验，不复用 localhost admin guard。

本任务不要求 Device completed 同步等待 inventory replenish。Inventory 可以继续按现有机会式机制工作；如果需要触发 ensure，应异步/非关键链路，并且失败不影响 completed 成功。

如果当前 Web completed route 的核心逻辑可以安全抽成共享 service，就复用；不要复制数据库 lifecycle 规则。

---

## E. Device API 不提供的能力

第一版 Device API **只服务接收机运行**，不要暴露：

- 创建/编辑/删除 Program；
- DeepSeek 生成；
- TTS 合成；
- music generation；
- restore / batch admin；
- Supabase 凭据；
- Inventory 管理按钮。

ESP32 不是管理客户端。

---

## F. HTTP / LAN 行为

Device API 是普通 HTTP JSON API。

当前阶段：

- ESP32 与电脑在同一可信 LAN；
- ESP32 后续通过 `http://<laptop-lan-ip>:3000/api/device/...` 访问；
- signed `audioUrl` 本身指向 Supabase HTTPS，ESP32 后续直接从该 URL 流式读取；
- 不让 Next.js 代理整个音频文件；
- 不做 WebSocket；
- 不做 mDNS 自动发现；
- 不做设备配网。

这些属于后续硬件步骤。

---

## G. 测试

至少覆盖：

1. Device guard：
   - 未配置 token 拒绝；
   - 无 Authorization 拒绝；
   - 错 token 拒绝；
   - 正确 Bearer token 通过；
   - 不依赖 Origin。
2. Web local guard 行为没有被放宽。
3. Device tune 与 Web manifest 共用核心构建逻辑；
4. Device tune 的 `no_signal` 不触发 inventory production；
5. Device tune 返回的 manifest 不含 Supabase service-role 或其他服务端 secret；
6. completed 生命周期保持幂等；
7. `excludeProgramIds` 仍可防止立刻重复节目。

把新增测试加入现有测试命令。

运行：

```bash
pnpm test:checkpoint-b
pnpm lint
pnpm typecheck
pnpm build
```

如仓库已有新的统一 test 脚本，以最新脚本为准。

---

## 本任务明确不做

- ESP32 firmware 网络请求
- MP3/WAV 解码
- I2S / MAX98357A
- TFT
- EC11 旋钮
- Wi-Fi provisioning
- mDNS
- WebSocket / MQTT
- 音频代理/转码服务
- production deployment
- 用户登录
- robot voice / singing voice 调优

---

## 验收标准

1. `pnpm dev` 仍默认只绑定 `127.0.0.1`；
2. `pnpm dev:device` 可显式绑定 `0.0.0.0`；
3. localhost 管理 API 没有为了 ESP32 被放开；
4. ESP32 风格的无 Origin HTTP 请求可用正确 Bearer token 调 Device tune；
5. Device tune 返回与 Web Receiver 同语义的 ready manifest；
6. Device 可以获得短期 signed audio URL，但永远拿不到 service-role key；
7. no_signal 不等待 AI；
8. Device completed 可正确 retire，换台不会自动 retire；
9. tests / lint / typecheck / build 通过。

## 手动验证（不需要 ESP32）

实现后先用 curl 模拟设备即可：

```bash
pnpm dev:device
```

再从本机用 Bearer token 请求局域网入口，验证：

- 错 token → 403；
- 正确 token → signal/no_signal；
- signal manifest 中 `audioUrl` 可访问；
- 管理后台从 `127.0.0.1` 仍可正常使用；
- 用 LAN IP 直接访问管理写接口仍应被拒绝。

验证完成后暂停，不开始 ESP32 firmware。