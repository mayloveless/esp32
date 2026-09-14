# Task 005 — Inventory Orchestrator：统一节目库存与自动补货

## 目标

Task 004 已经把节目内容能力补齐到可用状态：

- news / chat 文本节目；
- 双音色 Renderer；
- alien 外星语与中文字幕；
- expressive delivery；
- procedural music；
- speech background bed；
- Program 生命周期、Receiver manifest、completed retire / restore。

下一步不再继续增加内容种类，而是解决一个更基础的问题：**收音机调台时不应该现场等 AI 生成节目；电台应持续有节目库存，AI 只负责后台把库存补回来。**

本任务把现有“库存空了才临时补一条”的逻辑升级为统一 Inventory Orchestrator，并移除旧 auto-replenish 绕过新 Renderer 的 legacy 单音色 MP3 路径。

完成后目标体验：

> Receiver 调台只从 ready 库存选择节目，立即返回 signal / no_signal；生成节目永远不在 tune 主链路里等待。节目被完整听完并 retire 后，系统可以补回缺少的节目类型。

## 当前基线

- 基线提交：`251d090e596b8e5070af0521efd18baf639c6557`
- `receiver/auto-replenish.ts` 当前仍直接：
  - DeepSeek 生成稿件；
  - `getSynthesisText()` 拼成单段文本；
  - `synthesizeWithSiliconFlow()` 生成单音色 MP3；
  - 使用 legacy `saveSynthesizedProgramAudio(...)` overload 保存。
- 这条路径绕过了当前 Renderer，因此不会自动获得：
  - 双 speaker 音色；
  - delivery profile；
  - alien mode；
  - background bed；
  - 当前 WAV 渲染与 metadata。
- `receiver/replenishment.ts` 当前只根据上一条节目粗略决定 news / chat。
- `/api/receiver/tune` 已经只读取 `listActiveReadyPrograms()`；保持这个原则，不要把 AI 生成重新塞进 tune。
- music 已有 procedural generator，可以无需外部付费服务直接生成 ready Program。

开始前读取最新 main；如果代码已有更新，以最新代码为准，不覆盖用户改动。

---

## 核心原则

### 1. Tune 只消费库存

`POST /api/receiver/tune`：

- 只查询当前 active + ready Program；
- 从候选中挑选；
- 立即返回 manifest 或 `no_signal`；
- **不得等待 DeepSeek / TTS / procedural generation。**

不要为了“永远有信号”让 tune 请求卡几十秒现场生产内容。

### 2. 自动节目必须复用正式生产链路

news / chat 自动生成必须复用当前已经验证过的：

```text
DeepSeek semantic script
→ renderProgramAudio()
→ TTS segment rendering
→ delivery / alien / background bed
→ final WAV
→ saveSynthesizedProgramAudio()
→ ready
```

禁止继续保留一套“自动补货专用”的 legacy 单音色 MP3 合成流程。

music 自动补货复用当前 procedural music generator + ready music 保存逻辑。

### 3. Inventory 只关心节目类型与数量，不变成世界观系统

第一版不要建立 station/channel/world 数据库，也不要设计复杂排播表。

引入一个很小的 inventory kind 概念即可，例如：

```ts
type InventoryKind =
  | "news"
  | "chat"
  | "alien"
  | "music";
```

分类规则通过 `format + recipe.render_mode` 推导，不新增数据库列：

- `format=news && render_mode!=alien` → news
- `format=chat && render_mode!=alien` → chat
- `render_mode=alien` → alien
- `format=music` → music

第一版 active-ready 最低库存目标：

```ts
{
  news: 1,
  chat: 1,
  alien: 1,
  music: 1
}
```

这是 prototype buffer，不是最终播出比例。不要一次自动生成很多付费语音。

### 4. 每次 ensure 最多生成一条缺口

`ensureInventory()` 一次只补一个最缺的 kind，然后返回。

理由：

- 防止一次请求意外产生多次付费 DeepSeek/TTS 调用；
- 失败范围小；
- 易于重试；
- 后续真正 worker / scheduler 可以循环调用同一个 orchestrator。

不要在一个 HTTP 请求里自动补满 4～10 条节目。

### 5. 失败不能影响现有 ready 库存

新节目生产失败：

- 允许留下 `failed` Program 供调试；
- 不能 retire / 修改已有 ready Program；
- 不能影响 Receiver 调台；
- 不自动无限重试。

---

## Checkpoint A — 统一节目生产路径

先把 legacy auto replenish 重构掉。完成后暂停 review。

### A1. 新建轻量 Program Producer

建议新增类似：

```text
inventory/
  classify.ts
  plan.ts
  producer.ts
```

名字可以根据当前结构调整，但不要引入 framework / queue abstraction。

`producer.ts` 负责按 kind 生产一条 ready Program：

```ts
produceInventoryProgram(kind)
```

#### news

- DeepSeek 生成 news 稿件；
- normal render；
- 使用当前默认 delivery；
- 使用当前默认 background bed；
- 最终走 `renderProgramAudio()`。

#### chat

- DeepSeek 生成 chat 稿件；
- 必须继续走双音色 Renderer；
- 使用当前默认 chat delivery + background bed。

#### alien

- 第一版自动 alien 可以随机但可测试地选择：
  - `cosmic-1`
  - `continental-1`
  - `machine-1`
- render mode 为 `alien`；
- background bed 继续走现有默认规则；
- 不建立世界/语言数据库。

为了测试稳定性，随机选择逻辑应允许注入 random 或 seed，不要把不可控 `Math.random()` 深埋在业务逻辑中。

#### music

- 复用 `createProceduralMusicRecipe()` + `synthesizeProceduralMusic()`；
- style 可以 `random`；
- 复用现有 ready music 保存逻辑；
- 不经过 DeepSeek/TTS。

### A2. 删除 legacy 自动 TTS 路径

`receiver/auto-replenish.ts` 不应再：

- `getSynthesisText()`；
- `synthesizeWithSiliconFlow()` 单段 MP3；
- 调用 legacy `saveSynthesizedProgramAudio(audioBytes, durationMs, legacyMetadata)`。

如果 legacy overload 只剩旧测试或无实际调用，可在确认无使用方后删除；如果仍有其他兼容用途，可以暂时保留，但 auto inventory 不能再使用它。

### A3. recipe 必须能证明自动节目走了正式 Renderer

自动生成的 speech Program 应继续记录当前已有 metadata，例如：

- renderer
- render_mode
- alien_dialect（如适用）
- delivery_profile
- tts provider/model/speed
- speaker voice mapping
- background_bed / gain / generator / seed

同时加一个轻量来源字段，例如：

```json
{
  "inventory_source": "auto"
}
```

music 同样记录 `inventory_source=auto`，并保留当前 procedural recipe 信息。

不要新增数据库列。

### A4. 测试

至少覆盖：

- 自动 news 调用 Renderer 而非 legacy single-voice path；
- 自动 chat 真正走多 speaker voice mapping；
- alien 保存 `render_mode=alien` 与 dialect；
- music 不调用 DeepSeek/TTS；
- 生产失败不会创建伪 ready Program；
- 同一种 seed/random 输入下 planner 可复现。

完成 A 后暂停，不执行 Checkpoint B。

---

## Checkpoint B — Inventory Orchestrator

A review 通过后再做。

### B1. 分类 active-ready 库存

新增纯函数：

```ts
classifyInventory(programs)
```

输出每个 kind 的 ready 数量和 Program IDs。

只统计：

- `status=ready`
- `retired_at=null`
- `audio_path` 存在
- `duration_ms` 有效

尽量复用 `listActiveReadyPrograms()` 返回结果，不再重复造 SQL 语义。

### B2. 选择一个缺口

目标：

```ts
const target = {
  news: 1,
  chat: 1,
  alien: 1,
  music: 1,
};
```

纯函数：

```ts
pickInventoryDeficit(current, target)
```

规则保持简单、稳定：

1. 先找 `count < target` 的 kind；
2. 优先缺口比例最大的；
3. 并列使用固定顺序，不用随机。

若全部达标，返回 null。

### B3. `ensureReceiverInventory()`

替换当前“库存彻底空才补一条”的 replenish 行为：

```ts
ensureReceiverInventory():
  | { result: "healthy"; inventory: ... }
  | { result: "replenished"; kind; programId; inventory: ... }
```

一次最多调用一次 `produceInventoryProgram(kind)`。

继续保留进程内 lock，避免本地开发时同时产生多个付费请求；不要现在引入 Redis / distributed lock。

### B4. API

继续使用或调整：

```text
POST /api/receiver/replenish
```

语义改成“ensure inventory”，不要要求客户端传正在播放节目来决定生成什么类型。

返回当前库存摘要，便于 Web Receiver / 后台观察。

### B5. Web Receiver 的触发方式

第一版做**机会式补货**，不要引入 cron / worker scheduler：

- Receiver 页面首次进入后，可以调用一次 ensure；
- 一条节目 completed 并成功 retire 后，调用一次 ensure；
- 调台拿到 signal 后，如果需要，也可以非阻塞触发一次 ensure，但不能让当前 tune 等它完成。

重要：

- replenish 失败只记录/展示轻量状态，不中断正在播放的节目；
- `no_signal` 可以提示库存暂空，但不要自动把 tune 变成长等待请求；
- 不要形成短时间内无限 replenish loop。

如果当前 React 生命周期不好安全实现，可只做“进入 Receiver + completed 后触发”两处。

### B6. 后台可见性

管理页加一个很小的库存摘要即可，例如：

```text
Ready Inventory
news 1 / chat 1 / alien 0 / music 2
```

可以提供一个“补一条缺口”按钮用于手动调试，调用同一个 ensure API。

不要做完整运营后台、排播配置器或比例编辑器。

### B7. Tune 候选体验

当前 `findManifestCandidate()` 是按 `listActiveReadyPrograms()` 顺序找到第一条未 exclude 的节目。Task 005 可以做一个很小的改善：

- 保持 `excludeProgramIds` 最高优先级；
- 候选节目中允许随机选择，或稳定打散，避免总是偏向最新创建的一条；
- 不需要复杂推荐算法；
- 不要求严格“news → chat → music”轮播。

如果改为随机，测试中允许注入 random，保证可测试。

---

## 本任务明确不做

- cron / durable scheduler
- Redis / queue service
- distributed lock
- station/channel/world 数据库
- 完整节目时间线
- 24h 连续广播排程
- AI singing / robot voice 新 provider
- ESP32 Device API
- TFT / knob
- Vercel production deployment

---

## 验收标准

Checkpoint A：

1. auto news/chat/alien 全部走当前 Renderer；
2. chat 不再退化为单音色 MP3；
3. alien/background/delivery metadata 正常保存；
4. procedural music 可作为自动 inventory Program 生产；
5. 自动生产失败不污染已有 ready 库存；
6. tests / lint / typecheck / build 通过。

Checkpoint B：

1. active-ready 可按 news/chat/alien/music 分类；
2. 缺一个 kind 时 ensure 一次只补一条；
3. 四类都达到最低目标时不产生付费调用；
4. tune 永远不等待 replenish；
5. completed 后可机会式触发补货；
6. replenish 失败不影响当前播放；
7. 后台能看到简单库存摘要；
8. tests / lint / typecheck / build 通过。

## 手动验证

A 完成后只手动触发一次 auto chat 或 alien：

- 确认真正有双音色 / alien / background bed；
- recipe 能看到 Renderer metadata；
- 不要批量产生付费节目。

B 完成后：

1. 保留至少 3～4 条 ready Program；
2. 连续调台，确认无需等待 AI；
3. 完整听完一条，让它 retire；
4. 确认 ensure 后只补一条缺口；
5. 再调台仍可立即收到已有库存。
