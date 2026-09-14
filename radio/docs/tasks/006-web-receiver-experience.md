# Task 006 — Web Receiver Experience：接收机体验收口

## 目标

Task 005 已经把节目生产和库存编排拆开：

- Producer 负责生成 ready Program；
- Inventory Orchestrator 负责维持 news / chat / alien / music 最低库存；
- Receiver tune 只消费 ready 库存，不等待 AI；
- completed 后节目 retire，并机会式触发库存补货。

Task 006 不再增加新的内容生成能力，而是把当前 Web Receiver 从“协议验证页”收口成一个更接近最终实体收音机体验的产品模拟器。

核心体验仍然是：

> 调台时先听到短暂噪声，随后像接入一个本来就在播出的信号；不同节目类型表现不同，用户不需要理解内部的 manifest / offset / inventory 实现。

完成后，Web Receiver 应成为上 ESP32 之前的最终行为基线。

## 当前基线

- 基线提交：`39b6d52027a5fd67772d5efc6707d68859808f24`
- 当前 Receiver 已有：
  - `idle / no_signal / tuning / buffering / playing / ended / error` 状态；
  - tuning static noise；
  - signed URL 播放；
  - startOffset 中途切入；
  - captions；
  - 下一节目 blob prefetch（12 MB 上限）；
  - completed retire；
  - 首次进入 / completed / no_signal 时异步 ensure inventory；
  - autoplay blocked 的手动播放 fallback。
- 当前 UI 偏调试工具：
  - 标题仍是 `Web Receiver Simulator`；
  - 直接显示“开始偏移”；
  - native audio controls 始终暴露，可任意拖动进度；
  - news / chat / alien / music 在视觉和字幕文案上区分不明显。

开始前读取最新 main；如果已有更新，以最新代码为准，不覆盖用户改动。

---

## 核心原则

### 1. 不再改内容生产架构

本任务不新增：

- 新 TTS / LLM / music provider；
- station / channel / world 数据库；
- AI singing；
- robot voice；
- 新 inventory kind；
- cron / worker；
- ESP32 API。

Task 006 只处理 Receiver 的信息、状态、切台和播放体验。

### 2. Receiver 主界面是“收音机”，不是调试器

内部仍可保留调试信息，但主界面优先显示用户能理解的内容：

- 当前信号类型；
- 节目标题；
- 当前字幕 / 译文；
- 播放状态；
- 调台按钮。

`startOffsetMs`、精确 duration、native audio controls 等实现细节可以放到一个折叠的“调试信息”区域，不要占据主视觉。

### 3. 手动调台与自然续播语义不同

- 用户主动点击“调台 / 下一个信号”：视为切入一个正在播出的信号，继续使用 manifest 的 `startOffsetMs`；
- 当前节目自然播放结束：completed / retire 后自动进入下一节目，可以从 0 开始，模拟电台节目自然衔接；
- 中途换台不能 retire 当前节目；
- 只有真正 `ended` 才 retire。

保持现有生命周期语义，不要为了 UX 简化破坏它。

### 4. Tune 永远不等待补货

Task 005 的边界不能回退：

- tune 只拿 ready；
- no_signal 可后台 ensure；
- UI 可以告诉用户“暂未捕获到信号”；
- 不要在 tune 内等待 AI 后再重试。

---

## A. Manifest 增加轻量展示语义

当前 manifest 只有 `format`，不足以让 UI 区分 normal chat 与 alien chat。

新增一个轻量字段，例如：

```ts
signalKind: "news" | "chat" | "alien" | "music"
```

直接复用现有 inventory 分类规则，从 Program 推导；不要新增数据库列。

如果实现上更适合使用 `kind` 也可以，但命名要明确是 Receiver 展示语义，不要把整个 inventory 对象暴露给设备。

测试至少覆盖：

- normal news → news；
- normal chat → chat；
- alien render mode → alien；
- music 即使 recipe 中有其他字段也优先为 music。

这个字段以后也可以给 ESP32 TFT 使用，因此保持稳定、简单。

---

## B. 主界面信息收口

把当前 Receiver 主区域调整为更像实际收音机状态面板。

建议主信息顺序：

```text
[状态 / SIGNAL]
节目类型
节目标题
当前字幕 / 译文 / 音乐状态
[调台 / 下一个信号]
```

### B1. 类型文案

使用用户可读标签，例如：

- news → `新闻广播`
- chat → `访谈 / 对话`
- alien → `未知语言信号`
- music → `音乐节目`

不要直接在主界面显示内部枚举 `news/chat/alien/music`。

### B2. 字幕区域

按 signal kind 调整文案：

#### news / chat

标签可以是：

```text
字幕
```

显示当前 caption：

```text
主持人：……
```

#### alien

标签改成：

```text
译文
```

因为当前 captions 是语义中文，应让用户理解屏幕显示的是翻译，而不是外星语转写。

#### music

不要留一个空的“中文字幕”框。

显示一个静态状态即可，例如：

```text
音乐广播中
```

不要为了这个任务给音乐生成歌词。

### B3. “中途接入”的表达

主界面不要强调“startOffset 00:12”。

当手动 tune 且 startOffset > 0 时，用体验文案：

```text
已接入正在播出的信号
```

精确 offset 放到调试信息。

自然续播从 0 开始时可以显示：

```text
新节目开始
```

不需要构建 station timeline。

---

## C. 调台反馈节奏

当前 tuning noise 会在请求和音频加载期间一直播放。保留这个设计，但做一次体验收口。

### C1. 最短调台反馈

对于已经 prefetched 的节目，如果切换快到几乎瞬时，static noise 可能一闪而过。

给用户主动调台增加一个很短的最小 tuning feedback，例如约 `250–400ms`。

要求：

- 允许测试中注入 / 控制等待函数，避免测试真的 sleep；
- 不要把正常网络请求额外固定拖慢很久；
- 如果音频本身加载超过最短时间，就按真实加载时间；
- repeated tune 必须能 abort 前一次等待 / 请求；
- 不要产生多个并行 AudioContext 泄漏。

### C2. 状态不要闪烁

现在 `tuning` 很快切到 `buffering`，用户可能只看到 buffering。

主视觉可以把 tuning + buffering 都表现为“正在搜索 / 锁定信号”，内部状态仍可保留。

不要为了 UI 合并删掉现有 runtime 状态。

### C3. no_signal

no_signal 时：

- 停止 static；
- 不显示成系统错误；
- 文案类似“暂未捕获到可用信号”；
- 后台 ensure 可以继续，但不要自动阻塞重试 tune；
- 用户可以再次点击调台。

---

## D. 播放控件收口

实体收音机不会暴露 seek bar，因此主界面不要一直显示原生 `<audio controls>`。

建议：

- `<audio>` 继续作为实际播放元素；
- 默认不显示 native controls；
- autoplay 被浏览器拦截时，继续显示现有“开始播放”按钮；
- 把 native controls、programId、精确 offset、duration、signed URL expiry 等放到 `<details>`：

```text
调试信息
```

调试区只用于 Web 开发验证，不代表未来设备 UI。

如果隐藏 native controls 会影响当前自动化测试，可保留 DOM 元素，但不要让它占据主产品界面。

---

## E. 连续播放 / prefetch 行为确认

保持现有 prefetch 思路，不重做缓存系统。

### E1. 手动 tune

- 优先使用 prefetched Program（如存在）；
- 仍然按手动 tune 语义使用 manifest startOffset；
- current program 只加入 exclude，不 retire。

### E2. natural ended

- completed 成功后 retire；
- 异步 ensure，不等待；
- 自动切下一节目；
- 下一节目从 0 开始；
- 如果已有 prefetch，直接使用；
- 如果没有 ready signal，则进入 no_signal，不让 AI 阻塞播放主链路。

### E3. stale request

保留 / 加强现有 sequence + AbortController 保护：

- 快速连续点击调台时，旧 manifest / audio load / delayed tuning wait 不能覆盖新状态；
- 旧 blob URL 要正常 revoke；
- 旧 tuning noise 要关闭。

---

## F. 轻量视觉调整

不要做一次大型 UI redesign，也不要引入组件库。

只调整 Receiver 自身 CSS，让它更像独立设备面板，而不是管理后台里的普通 form。

可以做：

- 更聚焦的 now-playing 区；
- signal kind 小标签；
- 更醒目的节目标题；
- 字幕 / 译文区域固定最小高度，避免切换时布局跳动；
- music 时用不同但克制的占位文案；
- 调台按钮保持唯一主操作；
- debug details 视觉降级。

不要做：

- 假旋钮动画；
- 3D 收音机外壳；
- 大量复古贴图；
- Canvas / WebGL；
- 为 Web 页提前模拟 TFT 像素屏。

真正的旋钮与屏幕体验留给实体硬件阶段。

---

## G. 测试

至少覆盖：

1. manifest 正确输出 signalKind；
2. music 优先分类为 music；
3. manual tune 继续使用 startOffset；
4. natural ended 下一节目从 0 开始；
5. no_signal 不等待 replenish；
6. repeated tune 的 stale request 不覆盖新状态（如果当前组件测试体系难以覆盖，至少把关键状态决策抽成纯函数测试）；
7. tuning minimum delay 的计算 / 决策可测试，不用真实 sleep；
8. captions：alien 显示为“译文”语义，music 不显示空字幕框（可通过纯展示 helper 测试）。

不要为了测试引入完整 browser E2E framework。

---

## 手动验证

完成后至少准备四类 ready Program 各一条，然后在 `/receiver` 连续体验：

1. 手动调台到 news：应有短 tuning noise，随后中途切入；
2. 再调到 chat：双音色、背景音乐不受本任务影响；
3. 调到 alien：主界面明确显示“未知语言信号”，屏幕区域标为“译文”；
4. 调到 music：不出现空字幕，显示“音乐广播中”；
5. 快速连续点调台 3～5 次，不应出现旧节目突然覆盖新节目；
6. 完整听完一条：节目 retire，自动衔接下一条从 0 开始；
7. 临时让 ready 库存为空：调台应快速进入 no_signal，同时后台 ensure，不应卡住等待 AI；
8. 浏览器阻止 autoplay 时，“开始播放” fallback 仍可用。

如果这轮体验没有明显问题，Web Receiver 视为收口，下一任务进入 Device Receiver API / ESP32。

---

## 本任务明确不做

- station / frequency 持久化模型
- 真实 FM 频率逻辑
- 世界观时间线
- 新内容类型
- AI singing
- 新音色 provider
- cron / scheduler
- Device token / LAN endpoint
- ESP32 firmware
- TFT / EC11

这些不应阻塞 Task 006。
