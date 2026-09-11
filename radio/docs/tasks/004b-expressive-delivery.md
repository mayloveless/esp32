# Task 004B.5 — Expressive Delivery：让声音像电台，不像朗读

## 背景

Task 004 Checkpoint B 已完成并由用户实际试听：外星语本身可以接受，但当前合成仍有两个明显问题：

1. **语气太像普通 TTS 朗读，不像正在播出的电台节目**；
2. **整体语速偏慢**，削弱了“调进一个正在直播的频道”的临场感。

这一小任务插在 Task 004 Checkpoint B 与 Checkpoint C（Music Program）之间。不要提前实现音乐。

当前 SiliconFlow CosyVoice2 支持：

- `speed` 控制，范围 0.25–4.0；
- 在 `input` 前加入自然语言指令，并用 `<|endofprompt|>` 与正文分隔，可控制情感、语速、角色扮演、方言和韵律；
- 现有 Renderer 已负责 speaker → voice、多段 WAV 合并、alien spokenText 与 captions。

本任务只给现有 Renderer 增加一层很薄的 **delivery**，不要改成复杂语音导演系统。

## 目标

让同一份语义稿件在 TTS 时可以带有明确的“广播表演方式”，并提高默认语速。

完成后至少能明显区分：

- 普通广播：利落、有重点、不是逐字朗读；
- 活泼聊天：更自然、更有反应感；
- 突发新闻：更紧张、更快；
- 神秘广播：有氛围，但仍保持电台节奏；
- alien 模式：外星语本身不变，但听起来像“某个频道正在广播”，而不是慢吞吞念伪语言。

## 设计原则

### 1. delivery 是节目表现，不是供应商配置

不要把这些做成新的 `.env`：

- emotion
- pace
- role
- delivery prompt

环境变量继续只保存 TTS provider / key / model / voices 等基础供应商配置。

节目级表现存在 Renderer / Program metadata 中。

### 2. 上层使用通用 delivery，供应商适配层负责翻译成 API 参数

新增轻量结构，例如：

```ts
type DeliveryProfile = {
  id: "broadcast" | "lively" | "urgent" | "mysterious";
  instruction: string;
  speed: number;
};
```

Renderer 只选择 profile。SiliconFlow transport 再把它转换成：

- `input = instruction + "<|endofprompt|>" + spokenText`
- `speed = profile.speed`

不要在 Renderer 中硬编码 SiliconFlow 字段名。

### 3. 第一版只做有限 profile

不要开放任意 prompt 编辑器。先内置 4 个 profile：

#### `broadcast` — 默认

- 适合普通新闻与一般广播；
- 建议 speed 起点约 `1.15`；
- instruction 重点：真实电台主播、利落、有重音和句间节奏、避免逐字朗读腔。

#### `lively`

- 适合聊天；
- 建议 speed 起点约 `1.12`；
- instruction 重点：自然对话、反应明确、轻松、有情绪起伏、不要主持稿朗读腔。

#### `urgent`

- 适合突发新闻/警报；
- 建议 speed 起点约 `1.20`；
- instruction 重点：紧迫、专注、信息密度高，但不能含糊或喊叫。

#### `mysterious`

- 适合外星频道、深夜频道、异常事件；
- 建议 speed 起点约 `1.08`；
- instruction 重点：神秘、克制、有广播感，不要故意拖慢。

这些值只是第一版起点，保持集中定义，方便用户试听后微调。

## 实现要求

1. 新增轻量 `renderer/delivery.ts`（或等价位置）：
   - 定义 profile；
   - 校验 profile id；
   - 返回 instruction + speed；
   - 不调用 TTS。
2. 合成 UI 在现有 `normal / alien` 旁增加一个很小的“播报风格”选择：
   - 普通广播 `broadcast`
   - 活泼聊天 `lively`
   - 突发新闻 `urgent`
   - 神秘广播 `mysterious`
3. 默认选择可按 format 做最小智能默认：
   - `news` → `broadcast`
   - `chat` → `lively`
   - 如果用户手动选了 profile，以用户选择为准。
   - alien 不强制覆盖用户选择；可以让用户选 `mysterious` 或其他 profile。
4. `renderProgramAudio` / render plan 把 delivery 信息传给每个 TTS unit。
5. `tts/speech` 的通用请求类型增加必要的通用字段，例如：

```ts
{
  text,
  voice,
  responseFormat,
  sampleRate,
  instruction?,
  speed?
}
```

不要出现 `siliconflowInstruction` 之类供应商专属命名。
6. SiliconFlow transport：
   - 若有 instruction，按官方格式拼成 `instruction + "<|endofprompt|>" + text`；
   - 把通用 speed 传入 API；
   - speed 必须做合理边界校验；
   - 无 delivery 时仍兼容现有调用路径。
7. normal 与 alien 都必须走同一套 delivery：
   - normal 的正文仍是原始 text；
   - alien 的正文仍是 spokenText；
   - delivery 只改变“怎么说”，不能改变“说什么”。
8. 双人 chat 保持现有 voice mapping；delivery 不得把两个 speaker 又合回一个 voice。
9. `recipe` 记录实际表现参数，至少：

```json
{
  "delivery_profile": "lively",
  "tts_speed": 1.12
}
```

如需要可同时记录 instruction 版本/id，但不要把一大段动态 prompt 当核心数据模型。
10. 不新增数据库列，不改 Receiver manifest，不改 captions 时间生成逻辑。
11. 不使用 LLM 再生成 delivery prompt，不增加额外 AI 调用。
12. 暂不加入 `[laughter]` / `[breath]` 等自动插入逻辑；避免 Renderer 擅自增加原稿没有的表演内容。
13. 不做声音克隆、不做 EQ/混响、不做背景音乐混音、不接 ESP32、不实现 Music Program。

## 测试

增加不产生费用的测试：

- 默认 profile 选择正确；
- 手动 profile 覆盖默认值；
- profile speed 在允许范围；
- instruction 正确传递到通用 TTS request；
- SiliconFlow transport 正确生成 `<|endofprompt|>` input；
- SiliconFlow transport 正确传 `speed`；
- normal 模式 delivery 不修改原始正文；
- alien 模式 delivery 不修改确定性的 `spokenText`；
- chat 的两个 voice mapping 不受 delivery 影响；
- recipe 保存 delivery profile 和实际 speed。

运行现有 test、lint、typecheck、build。

## 手动验收

代码完成后先不要批量合成。用户只需要挑一条已有节目做 1–2 次实际试听：

1. 一条 chat 使用 `lively`；
2. 一条 alien 或新闻使用 `mysterious` / `broadcast`。

重点只听：

- 是否明显比当前更快；
- 是否还有“逐字朗读稿”的感觉；
- 重音与句间节奏是否像广播；
- chat 是否更像人在交流；
- alien 是否像“频道广播”，而不是慢速念伪语言。

如果实际听感仍慢，只微调集中定义的 profile speed / instruction，不继续扩架构。

完成后暂停 review，再决定是否进入 Task 004 Checkpoint C（Music Program）。
