# Task 004C.1 — Procedural Music Generator：不用上传，也能持续产生音乐节目

## 背景

Task 004 Checkpoint C 已完成：后台可以手动上传 MP3 / PCM WAV，创建 `format = "music"` 的 ready Program；Receiver 无需专用协议即可调到音乐，完整播放后 retire，后台可恢复。

用户不希望日常自己准备和上传音乐文件，因此在现有 C 基础上增加一个**程序化音乐生成器**。它不是新的 AI 音乐供应商，也不替换手动上传；目标是让系统自己快速生成一段原创、无版权依赖、适合“宇宙电台”的音乐节目并放入现有播出池。

当前基线：以最新 main 为准，至少包含提交 `d4353a4889608f0fe964a2e09dee249dbde174cb`（Task 004 C）。开始实现前再次读取最新 main，不覆盖用户后续改动。

## 核心目标

新增一个“生成音乐节目”入口：

```text
选择/随机一种宇宙音乐风格
        ↓
生成 seed + recipe
        ↓
服务端纯 TypeScript 合成 PCM
        ↓
封装为合法 WAV
        ↓
保存到现有 radio-audio bucket
        ↓
创建 ready music Program
        ↓
Receiver 按现有 tune / completed 逻辑播放
```

用户不需要提供音乐文件，也不需要写 prompt。

## 设计原则

### 1. 保留 Task C 的手动上传

不要删除现有 `/api/programs/music`、`parseManualMusicUpload` 或后台手动上传能力。它继续作为 fallback / 调试入口。

新增程序生成路径，而不是重写 C。

### 2. 第一版不接新的音乐供应商

本任务使用本地程序化合成，不产生额外 API 费用，不依赖 ffmpeg，不引入大型 DSP / 音频库。

当前 SiliconFlow 仍可继续用于现有 TTS；本任务不为了“统一供应商”强行调用与音乐无关的模型。

未来若接真正的 Music Model，应新增 provider 作为另一个 `audio_source`，不改变 Receiver 协议和本任务的数据结构。

### 3. 音乐要像“节目”，不是单个提示音

目标时长第一版控制在约 30～50 秒。应至少有简单的段落变化，而不是从头到尾一个持续正弦波。

允许使用：

- 多个振荡器（sine / triangle / square / 轻量 saw 近似）；
- 音阶 / 和弦 / arp；
- ADSR 或最小 attack/release envelope；
- 简单低频 pulse；
- 程序生成的 noise percussion；
- 轻量 delay / echo；
- 简单一阶滤波或其他低成本处理。

不要实现 DAW、MIDI 编辑器、通用音频插件框架或实时 WebAudio 合成系统。

### 4. 可复现

每首音乐必须有 seed。相同 `style + seed + generator version` 必须生成相同 WAV bytes（或至少严格相同 PCM 数据）。

不要在合成核心中直接使用 `Math.random()`；实现小型 seeded PRNG。

### 5. 输出标准化

第一版统一输出：

- PCM WAV
- mono
- 16-bit signed little-endian
- 32 kHz

尽量复用现有 `renderer/wav.ts` 的 WAV 构建/解析能力；如需扩展公共 PCM helper，可以小幅泛化，但不要破坏 TTS Renderer 的行为。

生成完成后必须再次用现有 WAV parser 验证：

- RIFF/WAVE 合法；
- PCM 参数正确；
- duration 可解析且与目标基本一致；
- 数据长度按 frame 对齐。

## 第一版风格

至少提供以下 4 个固定 style id：

### `orbital_ambient`

轨道环境音乐。慢速、漂浮、宽松；低频 drone + 稀疏和声/旋律。避免过于明亮和密集。

### `retro_synth`

复古科幻 synth。中速，明显的 arpeggio / pulse，有 70s–80s 科幻电子音乐感，但不要模仿具体歌曲或艺术家。

### `mechanical_pulse`

机械文明节拍。规则、短促、工业感，带低频脉冲和程序化噪声打击，但仍应是可持续听几十秒的音乐而不是警报声。

### `alien_signal`

介于音乐与未知信号之间。稀疏音高、非典型节拍、重复但缓慢变化的 motif；仍要保持“音乐可听性”。

不要使用任何受版权保护的旋律模板或硬编码真实歌曲片段。

## 数据结构

新增生成出来的 music Program 仍使用现有 `radio_programs`，不要新增数据库列。

建议 recipe 至少记录：

```json
{
  "format": "music",
  "audio_source": "procedural",
  "audio_content_type": "audio/wav",
  "music_generator": "procedural-synth-v1",
  "music_style": "orbital_ambient",
  "music_seed": "...",
  "music_bpm": 72
}
```

可额外记录 scale / root / duration 等真正有助于复现或调试的少量参数，但不要把每个音符都塞进 recipe。

`content = {}`、`captions = []` 即可。

## 模块建议

新增轻量 `music/`（或同等清晰目录）：

```text
music/
  types.ts
  random.ts
  recipe.ts
  synth.ts
  synth.test.ts
```

职责建议：

- `random.ts`：seed → deterministic PRNG；
- `recipe.ts`：style + seed → BPM / root / scale / arrangement 参数；
- `synth.ts`：recipe → PCM WAV asset；
- provider/API/数据库逻辑不要塞进 DSP 核心。

不要为四个 style 建四套互不相干的完整引擎；共用一个很薄的合成核心，通过 recipe 改变参数。

## API

新增本地开发 API，例如：

```text
POST /api/programs/music/generate
```

请求第一版足够简单：

```json
{
  "style": "random"
}
```

也允许四个明确 style id。

- `random`：服务端从四个 style 中选一个；
- 服务端生成新 seed；
- 不要求用户提交标题；
- 标题自动生成，例如基于 style + 短 seed 的可读名称，不调用 LLM；
- 保持现有 `assertLocalDevelopmentRequest`。

如果生成/上传/数据库写入任一阶段失败：

- 不创建半成品 ready Program；
- 已上传的新 Storage 对象按现有 cleanup 策略清理；
- 不影响已有音乐节目。

建议在 `program/service.ts` 抽出一个可复用的“从已验证 audio asset 创建 ready music Program”的内部 helper，让：

- 手动上传；
- procedural generator；

共享 Storage + DB 原子性/清理逻辑，而不是复制两份上传代码。

不要为了重构而扩大改动范围。

## 后台 UI

在现有“添加音乐节目”附近增加一个更优先的“生成音乐节目”区域。

第一版 UI：

- 风格下拉：随机 / 轨道氛围 / 复古合成器 / 机械脉冲 / 异星信号；
- 一个 `生成音乐` 按钮；
- loading 状态；
- 成功后自动刷新节目列表并选中新生成的 music Program，可以立即试听。

默认风格选 `随机`，因此用户只点一次按钮就能得到音乐。

手动上传可以放在其下方，保留但视觉优先级降低。

不要添加 BPM、调性、振荡器、seed 等专家参数面板。seed 只保存到 recipe，暂时不要求用户编辑。

## Receiver

原则上不修改 Receiver 协议。

procedural music 创建为普通 ready music Program 后，应自然获得：

- tune；
- `startOffsetMs` 临场切入；
- 预取缓存；
- 完整播放 completed → retire；
- 后台 restore。

如果为了兼容暴露出 bug，只做最小修复，不新增 music-specific manifest。

## 音频质量约束

程序合成时注意：

- 最终 PCM 不得整数溢出；
- 合并声部前用 float 累积，最终统一 limiter / normalization 后量化到 int16；
- 留出 headroom，避免持续硬削波；
- oscillator phase 连续，避免每个音符边界产生严重 click；
- note on/off 至少有很短 attack/release；
- noise 必须来自 seeded PRNG，保证可复现；
- 不要产生明显 DC offset；
- 30～50 秒的 mono 32kHz WAV 内存规模可接受，不需要流式 encoder。

质量目标不是专业作曲，而是：**调到一个 music Program 时，听起来确实像一小段来自别处的电子音乐，而不是测试音。**

## 自动库存

本任务先不把程序化音乐接进 `replenishReceiverInventory` 的自动补货流程。

原因：先验证实际听感和生成速度。用户手动确认后，再决定 music 是否按某个概率进入自动库存补货。

但是合成核心与创建 service 应设计成之后可以直接被 replenishment 调用，不依赖 React UI。

## 测试

不得产生外部 API 费用。至少覆盖：

1. seeded PRNG 同 seed 输出一致；
2. 同 style + seed 生成相同 PCM / WAV；
3. 不同 seed 的音频不完全相同；
4. 四种 style 都能生成合法 WAV；
5. WAV 为 32kHz / mono / 16-bit PCM；
6. duration 在预期范围；
7. PCM 峰值合法，无 int16 overflow；
8. `random` style 解析合法；
9. procedural recipe 正确记录 source / generator / style / seed / bpm；
10. Storage 成功但 DB 失败时调用 cleanup；
11. 现有 manual upload 测试继续通过。

运行仓库当前 test、lint、typecheck、build。

## 本任务明确不做

- AI Music provider / 文生歌曲 API
- 歌词 / 人声演唱
- 真实歌曲抓取
- Spotify / 网易云等音乐服务
- MIDI 文件导入导出
- 浏览器实时编曲器
- 用户自定义合成器参数
- 自动长期 worker
- ESP32 音频适配
- 修改 Alien Voice / TTS / delivery

## 验收

完成后暂停等待用户试听。

用户应能：

1. 不上传任何文件；
2. 后台保持“随机”并点击一次“生成音乐”；
3. 数秒内（以本机实际性能为准）获得一个 ready music Program；
4. 后台直接试听；
5. Web Receiver 能像普通节目一样调到它；
6. 连续生成几首时能明显听到不同 seed / style 的差异。

不要在任务实现过程中自动批量生成实际节目。