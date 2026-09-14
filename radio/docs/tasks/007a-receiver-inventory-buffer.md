# Task 007A — Receiver Inventory Buffer：让实体旋钮调台不依赖现场生成

## 目标

Task 007 已完成 Device Receiver API。下一步虽然要进入 ESP32 音频链路，但当前还有一个必须在实体旋钮前解决的问题：**ready 节目库存太浅。**

当前每类最低库存只有 1 条：

```ts
{
  news: 1,
  chat: 1,
  alien: 1,
  music: 1,
}
```

Web 上点击一次“调台”还能勉强工作，但实体设备会使用 EC11 旋钮快速扫台。真实体验要求：

```text
转动旋钮
→ 立即播放本地 tuning/static
→ 停止转动
→ 很快从已有 ready inventory 锁定一个信号
→ 播放
```

**DeepSeek / TTS / procedural generation 绝不能进入调台关键路径。**

偶尔出现 `no_signal` 可以作为世界观的一部分，但不能因为库存长期只有几条，导致用户连续转动旋钮时经常“扫不到台”。

本任务只增强 **Receiver 持久节目库存缓冲**，不要开始写 ESP32 I2S、MAX98357A、TFT 或 EC11 固件。

开始前先读取最新 `main`。当前已知基线：

```text
fe5c6986e2fe5f3333daf124fe4ab84295b7298c
fix: task 7
```

---

## 一、核心原则

必须保留以下现有设计：

1. `/api/receiver/tune` 与 `/api/device/receiver/tune` **只读取 active + ready inventory**；
2. tune 不等待生成，不等待补货；
3. `no_signal` 立即返回；
4. AI 生成、TTS、music generation 永远在调台关键路径之外；
5. `ensureReceiverInventory()` 单次调用仍然**最多生产一条节目**；
6. 不因为本任务引入 Redis、队列框架、scheduler、workflow engine、microservice；
7. 手动换台不会 retire 当前节目；
8. 只有节目真正自然播放结束后才 completed / retire；
9. retired 与 status 仍然是两套生命周期语义；
10. music 继续使用 procedural generator，不调用 DeepSeek/TTS。

尤其不要把“库存不足”改成：

```text
tune
→ 发现没节目
→ 等 DeepSeek
→ 等 TTS
→ 再返回节目
```

这是明确禁止的。

---

## 二、把库存从“能跑”提升到“能调台”

当前 4 条总库存不适合实体旋钮。

请把 Receiver 的目标 ready inventory 调整为：

```ts
export const inventoryTargets = {
  news: 3,
  chat: 3,
  alien: 3,
  music: 5,
};
```

即正常目标总量约 14 条。

原因：

- news/chat/alien 各有多条，快速切台不会立刻重复；
- music 生成成本低，适合作为更丰富的宇宙信号库存；
- 14 条仍然很小，不需要复杂调度系统；
- Program 已经是持久化库存，不需要另造 cache 表。

同时增加一个明确的“低水位”概念，仅用于库存健康判断，例如：

```ts
export const inventoryMinimums = {
  news: 2,
  chat: 2,
  alien: 2,
  music: 3,
};
```

语义：

- `target`：希望平常维持的库存；
- `minimum`：低于它说明库存明显偏低，需要尽快补；
- 不是要求每次低于 minimum 就同步生成；
- tune 不关心 minimum，只关心当前有没有 ready candidate。

如果现有命名结构有更合适的实现方式，可以调整命名，但不要增加通用配置框架。

---

## 三、保留“一次 ensure 最多补一条”

现有：

```ts
ensureReceiverInventory()
```

及其 core 行为应继续保持：

```text
读取 active-ready
→ classify
→ 找一个最大缺口 kind
→ 最多 produce 一条
→ 返回最新 inventory
```

不要把它改成一次调用循环生成十几条。

`pickInventoryDeficit()` 应按新的 `inventoryTargets` 判断缺口。

例如：

```text
news  2 / 3
chat  3 / 3
alien 3 / 3
music 5 / 5
```

一次 ensure 只补 1 条 news。

这样继续保留当前的付费调用保护：**一个普通补货请求不会突然生成四条甚至十条付费节目。**

---

## 四、增加“预热库存”能力，但不要让 Device tune 承担它

问题：从旧的 1/1/1/1 升到 3/3/3/5 后，初始需要补很多条；单靠等待节目播放结束会太慢。

因此需要一个非常轻量的 **本地开发预热方式**。

优先方案：复用现有 localhost-only：

```text
POST /api/receiver/replenish
```

它仍然一次只补一条。

在 Web 管理/Receiver 调试页面增加一个简单的：

```text
预热节目库存
```

操作。

用户明确点击后，前端可以**串行**重复调用 `/api/receiver/replenish`：

```text
request 1 → 最多生产 1 条
完成
request 2 → 最多生产 1 条
完成
...
直到 healthy
```

要求：

- 每个 HTTP request 仍最多生成一条；
- 必须串行，不要并发打 DeepSeek/TTS；
- 遇到错误立即停止，并展示当前结果；
- 如果返回 `healthy`，停止；
- 可以设置一个合理的单次预热最大循环次数，例如 12，防止异常状态无限循环；
- 只属于 localhost 管理能力；
- 不加入 Device API；
- ESP32 不需要知道这个能力；
- 不为了这个按钮重新设计管理 UI。

如果当前页面已有合适的调试/管理区域，就放在那里；不要把它做成 Receiver 主交互的一部分。

目的只是：在真正拿旋钮测试前，可以一次明确操作，把持久库存预先填起来。

---

## 五、节目自然播完后自动补回一条

一旦库存已经预热到 target，正常运行时每次节目自然播完只会少一条，因此只需要补回一条即可。

请确保 **Web completed 和 Device completed** 在成功 retire 后，都能机会式触发一次：

```ts
ensureReceiverInventory()
```

要求：

- completed 的成功响应**不能等待** DeepSeek/TTS；
- replenish 必须是非关键链路；
- replenish 失败不能让 completed 失败；
- `ReplenishmentInProgressError` 可以直接忽略；
- 其他补货失败最多记录 warning，不修改 completed 生命周期结果；
- 一次 completed 最多触发一次 single-step ensure；
- 手动切台不调用 completed，所以不会因为用户疯狂转旋钮而疯狂生成节目。

如果当前 Web 客户端已经在 ended 后自行 ensure，请尽量把“播完后补一条”的语义收敛到共享服务端逻辑，避免 Device 与 Web 各自记一套规则。

不要因此让 `completeReceiverProgram()` 本身同步等待节目生成。

推荐语义：

```text
natural audio ended
→ POST completed
→ retire 成功
→ completed 立即响应
→ server best-effort 单步 replenish
```

---

## 六、旋钮场景下的 Receiver 语义

本任务不实现旋钮，但代码设计必须服务后续 Task 008/009。

未来实体设备会出现这种调用：

```text
旋钮转动
→ 本地 static owns I2S
→ 停止转动
→ Device tune
→ 从 ready inventory 选节目
→ HTTP audio stream
```

所以：

### 允许

- 偶尔 tune 返回 `no_signal`；
- 最近节目通过 `excludeProgramIds` 防止立刻重复；
- 同一 ready Program 未来再次被调到；
- 中途切走后节目仍保持 active；
- natural ended 才 retire。

### 禁止

- 每一个旋钮刻度生成一个节目；
- 每次 tune 都触发 AI 补货；
- tune 等待 replenish；
- 为了“不够节目”把同一条节目复制成多份数据库记录；
- 用假的 loading 延时掩盖 AI 生成。

真实体验应来自“库存本来就在播”，而不是“用户转到这里系统才临时制作”。

---

## 七、库存健康状态

在现有 inventory classify 结构上增加简单健康判断即可。

至少能够区分：

```text
healthy
low
```

建议：

- 所有 kind >= target：`healthy`；
- 任一 kind < minimum：`low`；
- minimum <= count < target 可以视为 `refilling` / `below_target`，若不想增加状态也可以只通过 summary 表达。

不要为了状态显示改数据库 schema。

管理调试区域如果已有库存 summary，可以显示：

```text
news   2 / 3
chat   3 / 3
alien  2 / 3
music  5 / 5
```

但 UI 不是本任务重点。

---

## 八、测试

至少补充/调整测试覆盖：

1. 新目标库存：
   - news target = 3
   - chat target = 3
   - alien target = 3
   - music target = 5
2. minimum 判断正确；
3. `pickInventoryDeficit()` 仍能找出最大缺口；
4. `ensureInventoryCore()` 一次仍最多调用一次 `produceInventoryProgram()`；
5. target 全满时返回 healthy，不生产；
6. music 缺口仍通过正式 procedural music producer；
7. completed 成功后补货失败不会改变 completed 成功结果；
8. completed 的补货是 best-effort，不同步阻塞响应核心生命周期；
9. 中途换台不会 retire，也不会因此触发生成；
10. tune/no_signal 不等待 inventory production；
11. Device API guard 与 localhost management guard 行为不被本任务破坏；
12. 预热逻辑串行调用 replenish，不并发补货，并能在 healthy / error / 最大次数时停止。

运行：

```bash
pnpm test:checkpoint-b
pnpm lint
pnpm typecheck
pnpm build
```

以最新 main 的实际脚本为准。

---

## 九、本任务明确不做

- ESP32 firmware
- Wi-Fi 请求代码
- WAV / MP3 decoder
- I2S
- MAX98357A
- TFT
- EC11
- local tuning/static 音频
- Redis
- queue framework
- cron / scheduler
- workflow engine
- station/world database
- 24h timeline
- TTS 模型更换
- AI singing
- robot voice 调优

---

## 验收标准

1. ready inventory 目标约为 14 条：3 news / 3 chat / 3 alien / 5 music；
2. 有独立 minimum/low-watermark 健康判断；
3. tune 仍然只读取 ready inventory，不等待任何生成；
4. `ensureReceiverInventory()` 一次仍最多生成一条；
5. localhost 可以显式执行“预热节目库存”，串行补到 target；
6. Device API 不暴露预热/生成能力；
7. 节目自然播放完成后会 best-effort 补回一条；
8. 手动切台不 retire、不触发对应补货；
9. 快速连续 tune 不会造成 DeepSeek/TTS 请求风暴；
10. tests / lint / typecheck / build 通过。

完成后暂停，不开始 Task 008 ESP32 音频固件。