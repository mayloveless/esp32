# Task 003 — Web Receiver Simulator：先让浏览器成为一台宇宙收音机

## 目标

在现有 `radio/` 的节目生成/管理能力之上，增加一个独立的 Web Receiver Simulator，用浏览器先验证未来 ESP32 真正需要的运行时行为：调台、临场切入、缓存、播放状态、节目下线/恢复、签名 URL 失效与失败恢复。

这一任务的重点不是继续做后台页面，也不是做硬件，而是把“接收机协议”和“播放运行时”先跑顺。以后 ESP32 应尽量复用同一套服务端协议，而不需要理解 Supabase、DeepSeek 或 TTS。

## 当前基线

- 仓库：`mayloveless/esp32`
- 当前基线提交：`4c002d523ae53f083e64c0e10148ebdc3c2a10f1`
- `radio/` 已有：
  - DeepSeek 稿件生成
  - TTS 生成并保存 MP3
  - `radio_programs`
  - 私有 `radio-audio` bucket
  - 后台节目列表/详情/试听
- 当前节目生产状态：`queued / generating / ready / failed`
- 当前服务端管理接口默认仅本机开发可用。

开始前必须先读取最新 main，若用户已提交新代码，以最新代码为准，不覆盖用户改动。

## 核心设计原则

### 1. 生产状态与播出状态分开

`status` 继续表示节目资源生产状态，不用它表示“节目是否还在播出池”。

新增最小播出生命周期字段：

- `retired_at timestamptz null`
  - `null`：节目可进入接收机候选池
  - 非空：节目已下线，但资源仍完整保留

“完整听完后下线”只更新 `retired_at`，不删除数据库记录和 Storage 音频。后台必须可以恢复节目（将 `retired_at` 置空）。

第一版不要提前增加频道表、session 表、播放历史表、用户表、世界观表、任务队列等。

### 2. Program 与 Receiver Manifest 分开

Receiver 不直接读取数据库字段，也不直接拼 Supabase Storage 路径。服务端为接收机返回一个轻量播放 manifest，第一版至少包含：

```ts
{
  programId: string;
  title: string;
  format: "news" | "chat" | "music";
  audioUrl: string;
  audioExpiresAt: string;
  durationMs: number;
  startOffsetMs: number;
  captions: unknown[];
  retireOnComplete: boolean;
}
```

可按实际代码轻微调整，但不要把 service role、Storage path 或内部数据库结构暴露给 Receiver。

### 3. 临场切入

第一版先验证“我调进来时节目已经播了一会儿”的感觉，不做真实 24 小时电台时间线。

服务端为每次 tune 计算合理的 `startOffsetMs`：

- 不能永远从 0 开始；
- 不能随机到只剩几秒；
- 很短的音频允许从 0 开始；
- 对普通 30–90 秒节目，优先跳过几秒到十几秒；
- startOffset 必须严格小于 duration，并保留足够可听内容。

具体算法保持简单、可测试，不要建立“宇宙统一时间轴”。

### 4. 播放完成才 retire

Receiver 在音频真正播放到结束时发送 completed 事件。服务端将节目下线，但不删除物理资源。

用户中途切台、暂停、页面关闭、加载失败都不能当作“完整听完”。

completed 接口应可幂等：已经 retired 的节目再次 completed 不应报错或重复产生副作用。

### 5. Web 是未来 ESP32 的模拟器

Web Receiver 应调用未来设备也能调用的 receiver API，而不是直接复用后台 CRUD。这样以后 ESP32 只需要实现同样的 tune / complete / manifest 消费流程。

第一版仍保持本机保护，不开放公网设备鉴权；真正硬件接入前再设计 LAN/设备认证方式。

## 检查点 A — Inventory 生命周期 + Receiver API

只实现服务端和后台最小支持，不做 Receiver 页面。

1. 新增一条可复现 Supabase migration，为 `radio_programs` 增加：
   - `retired_at timestamptz null`
   - 如确实必要可增加一个针对 `status + retired_at + created_at` 的轻量索引；不要增加其他字段。
2. 迁移由一个明确入口执行；执行前检查远端 schema 与迁移历史，禁止重复应用。只修改 `radio_programs`。
3. 更新 TypeScript 类型。
4. 新增最小 inventory 能力：
   - 查询 `status=ready AND retired_at IS NULL AND audio_path IS NOT NULL` 的可播节目；
   - retire；
   - restore；
   - 后台列表/详情能看出“可播 / 已下线”，并可手动下线或恢复。
5. 新增 Receiver API：
   - `POST /api/receiver/tune`
   - 请求可带 `excludeProgramIds?: string[]`，用于避免立即重复和配合缓存；限制数组长度。
   - 服务端从 active ready 库存中选择一条节目，签发短期 audio URL，生成 `startOffsetMs`，返回 manifest。
   - 没有节目时返回明确的 `no_signal` 结果，不用 500，也不要伪造节目。
6. 新增：
   - `POST /api/receiver/programs/:id/completed`
   - 将对应 ready program 设置 `retired_at=now()`；不删除音频。
   - 非 ready / 不存在的情况返回清晰结果。
   - 重复 completed 幂等。
7. Receiver API 暂时沿用本机开发保护；不要因为未来 ESP32 要访问，就在本阶段把接口暴露到局域网或公网。
8. `startOffsetMs` 单独做纯函数并写测试，覆盖：极短节目、普通节目、接近边界的时长，确保不会只剩几秒。
9. 添加针对 inventory / manifest / completed / restore 的必要测试。数据库测试使用可清理数据；不要碰其他业务表。
10. 运行 test、lint、typecheck、build。完成后暂停等待 review。

## 检查点 B — Web Receiver Simulator

检查点 A review 通过后再做。

新增独立页面（建议 `/receiver`），现有管理后台继续保留，不做视觉重构。

Receiver 第一版至少包含：

1. 运行时状态：
   - `idle/no_signal`
   - `tuning`
   - `buffering`
   - `playing`
   - `ended`
   - `error`
2. 提供一个明显的“调台/下一个信号”操作；可以使用按钮、键盘等简单交互模拟旋钮，不需要先画真正旋钮 UI。
3. 每次调台：
   - 立即进入 tuning；
   - 可以用 Web Audio API 本地生成很短的调谐噪声/静电反馈，不新增付费或远程音频资源；
   - 获取/消费 manifest；
   - 音频可播放后跳到 `startOffsetMs`；
   - 再进入 playing。
4. 音频播放到真正 `ended` 时调用 completed 接口；成功后该节目不再进入 active 候选池。
5. 中途切台不能 retire 当前节目。
6. 页面显示最必要的信息：节目标题、形式、当前状态、开始偏移、播放进度；不要做新的复杂 UI 风格。
7. signed URL 失效或音频加载失败时允许重新 tune / 重新获取 manifest，不无限重试。
8. 完成后用至少 3 条 ready 测试节目手动验证连续调台和完整播放下线。测试数据必须可恢复/清理。
9. 暂不做预取缓存；先把 tune + start offset + complete 跑通。完成后暂停 review。

## 检查点 C — 小型预取缓存 + 连续调台体验

检查点 B review 通过后再做。

1. Receiver 维护一个很小的内存预取缓存，默认缓存 2 条未来候选节目。
2. 缓存只存在浏览器内存，不写 IndexedDB，不新增 Redis/队列/缓存服务。
3. 优先缓存实际音频 bytes/blob，而不是只缓存即将过期的签名 URL；设置简单的数量和总字节上限，避免无限占内存。
4. tune 时优先消费缓存；缓存不足再即时请求。
5. `excludeProgramIds` 应包含当前节目和缓存节目，减少立即重复。
6. 预取失败不能影响当前播放；缓存是优化，不是主链路依赖。
7. 调台时 stale request 不能覆盖后一次调台结果。使用简单 request sequence / AbortController 即可，不引入状态机框架。
8. 验证快速连续调台、网络失败、缓存耗尽、节目库存不足等情况。
9. 完成后暂停 review。

## 后续再做，不属于 Task 003

以下内容都重要，但不要塞进本任务：

- 双人/多人不同音色对话
- 音乐节目生产
- 外星语生成与中文翻译字幕
- station/channel 数据模型
- 真实持续播出时间线
- 自动节目库存补货 worker
- ESP32 网络播放
- TFT 字幕/翻译
- 旋钮输入
- 调谐动画/复杂视觉
- 用户账号/公网鉴权

这些在 Receiver runtime 稳定后单独拆任务。

## 完成标准

Task 003 最终完成时，应能在浏览器里像接收机一样连续调台：服务端从 active ready 库存返回播放 manifest，播放器从合理中间位置进入，完整听完会让节目下线但资源不删除，后台可一键恢复；切台有短暂临场反馈，下一条节目可由小型缓存快速进入，异常不会把整个 Receiver 卡死。

整个任务不修改 ESP32/鼓机，不调用额外付费 AI，不扩展内容生成能力。