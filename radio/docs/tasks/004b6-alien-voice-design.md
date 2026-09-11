# Task 004B.6 — Alien Voice Design：从“伪语言朗读”到真正的异星广播

## 背景

Task 004B 已完成外星语 + 中文字幕；Task 004B.5 已加入 delivery profile、TTS instruction 与 speed。用户实际试听后确认：

- 外星语本身可接受；
- 语速问题有所改善；
- 但整体仍然更像“人类 TTS 在念一串陌生音节”，不是脑海里电影中的异星广播；
- 用户期待两类更鲜明的声音：
  1. **机械、尖锐、像电影里的非人类通信**；
  2. **像某种陌生欧洲小语种，明显是一门语言但听不懂**。

因此本检查点不再继续调“神秘/兴奋”等 delivery 文案，而是直接处理两件真正决定听感的因素：

1. **phonology（伪语言的音节结构）**；
2. **timbre（最终声音的轻量音频后处理）**。

完成后再继续 Task 004C Music Program。

## 当前基线

- 最新基线以开始开发时的 `main` 为准；不要覆盖用户已提交改动。
- 已有：
  - `renderer/alien-language.ts`：确定性中文词 → 拉丁音节；
  - `renderer/delivery.ts`：broadcast/lively/urgent/mysterious + speed；
  - `renderer/wav.ts`：PCM WAV 解析、拼接、字幕时间计算；
  - normal / alien 合成；
  - Receiver 中文字幕。
- 当前 `cosmic-1` 的伪词通常为 2–4 个规则的“辅音 + 元音”音节，听感偏圆润、偏慢。

## 目标

同一条 alien 节目可以选择三种异星声音：

- `cosmic-1`：保留当前较柔和、传统科幻感的版本；
- `machine-1`：短促、尖锐、带机械通信质感；
- `continental-1`：像真实存在但陌生的欧洲语言，不做机械滤镜。

三者都必须：

- 确定性；
- 同一词在同一 dialect 下稳定映射；
- 原始中文语义不变；
- 中文字幕不变；
- 不增加新的 AI/音频供应商；
- 不引入 ffmpeg 或大型 DSP 依赖。

---

## A. 重做外星语 phonology

### 1. dialect 类型

把当前只有 `cosmic-1` 的实现扩为：

```ts
type AlienDialect = "cosmic-1" | "machine-1" | "continental-1";
```

UI 仅在 `renderMode = alien` 时显示 dialect 选择。

中文标签建议：

- `cosmic-1`：柔和宇宙语
- `machine-1`：机械通信语
- `continental-1`：大陆异语

默认仍可保持 `cosmic-1`，避免破坏已有行为。

### 2. 缩短整体伪词

当前 2–4 音节会把语义长度显著膨胀，是“听起来很慢”的原因之一。

调整原则：

- 高频/短中文词允许生成 1 个音节；
- 普通词以 1–2 个音节为主；
- 少量较长词可 3 个音节；
- 不再默认大量生成 3–4 音节长词；
- 保持 stable hash，不用随机数。

不要求真正做词频词典。可以基于 token 长度 + stable hash 决定 1/2/3 音节。

### 3. `cosmic-1`

保留现有总体风格，但缩短词长即可。不要为了兼容历史音频而冻结旧算法；新生成节目使用新版算法即可。

### 4. `continental-1`

目标不是模仿某个真实国家/民族，而是制造“像欧洲某种陌生语言”的语言感。

建议 phonology：

- onset 可包含：`k / g / t / d / p / b / v / z / s / r / l / m / n / f / sh / zh / ts`；
- 允许有限辅音簇：`kr / gr / tr / dr / vr / st / sk / pr / br`；
- vowel 偏：`a / e / i / o / u / ai / ei`；
- 允许少量词尾辅音：`n / r / s / k / t / l`；
- 词长以 1–2 音节为主；
- 不能直接复制真实单词列表，也不要刻意伪装成具体真实语言。

示意听感即可，不要求固定输出示例。

### 5. `machine-1`

语言本身也应更短促、更硬：

- onset 偏 `k / t / z / v / r / sk / kr / tr / ts`；
- vowel 以短元音为主；
- 更多 1 音节词；
- 可有词尾 `k / t / s / r`；
- 避免大量柔和连续元音。

真正的机械感由后面的 WAV DSP 完成，不要只靠拼写。

### 6. 标点与确定性

继续保留：

- 中文标点映射到英文标点；
- 句界保持；
- `Intl.Segmenter` + fallback；
- 同 dialect + 同词 => 同 pseudo-word；
- 不输出随机 Unicode 乱码。

---

## B. `machine-1` 轻量 WAV 后处理

### 1. 边界

只在：

```text
renderMode = alien && alienDialect = machine-1
```

时处理最终合并后的 WAV。

`cosmic-1`、`continental-1`、normal 模式完全不经过该 DSP。

后处理放在 `renderer/`，例如：

```text
renderer/audio-effects.ts
```

不要塞进 SiliconFlow transport，也不要让 TTS supplier 知道 alien dialect。

### 2. 目标听感

不是“搞坏音质”，而是：

- 仍能听出连续语言；
- 明显削弱正常人声的温暖感；
- 更窄、更尖、更像无线电/机器通信；
- 有轻微金属周期感；
- 不要做到严重失真、耳朵刺痛或完全听不清。

### 3. 第一版 DSP 链

在现有 PCM WAV 上直接做，不引入第三方 DSP 库。

建议按以下顺序实现一个**克制版**效果：

1. **轻量高通 / 去低频**
   - 目标约 250–400 Hz 以下逐渐衰减；
   - 去掉正常人声的厚度。

2. **轻量低通**
   - 目标约 4–5.5 kHz 以上逐渐衰减；
   - 形成通信设备的窄频带感觉。

3. **轻微 ring modulation**
   - 约 70–120 Hz；
   - wet 比例约 0.08–0.18；
   - 只增加一点金属/机械感，不覆盖原始语音。

4. **轻微软削波 / 饱和**
   - 非线性很轻；
   - 防止变成纯净 TTS；
   - 最终必须限制在合法 PCM 振幅范围。

参数可以微调，但保持可读、可测试、可复现。不要随机变化参数。

### 4. PCM 处理要求

优先复用现有 `parsePcmWav()` / `buildPcmWav()`。

实现应：

- 解析 WAV；
- 把 PCM sample 转成归一化浮点数；
- DSP；
- 再编码回**相同 channels / sampleRate / bitDepth**；
- WAV duration 不应发生可感知变化；
- captions 时间无需重算；
- 若某种 PCM 位深实现成本明显过高，可以先明确只支持当前 TTS 实际返回的 PCM 格式，但必须：
  - 用代码验证参数；
  - 遇到不支持格式要清晰失败；
  - 不得静默写坏 WAV。

不要做 sample-rate 变换，不做 pitch shifting，不做 FFT，不引入 WebAudio 到服务端。

### 5. recipe metadata

alien 合成后继续记录：

```json
{
  "render_mode": "alien",
  "alien_dialect": "machine-1"
}
```

对于 machine 可额外记录：

```json
{
  "audio_effect": "machine-radio-v1"
}
```

`continental-1` / `cosmic-1` 不需要该字段，或设 null；保持最小即可。

---

## C. UI 与试听

### 1. 后台

在现有 alien 播报模式下增加 dialect 选择，不新增新页面。

建议 UI：

```text
播报模式  ○ normal  ● alien
外星方言  [机械通信语 ▼]
播报风格  [神秘广播 ▼]
```

不要把 DSP 参数暴露给用户，不做 EQ / ring frequency / distortion 滑杆。

### 2. delivery profile

继续复用现有 delivery profile。

不要把 `machine-1` 和 `mysterious` 强绑定：用户仍可组合，例如：

- machine-1 + urgent
- machine-1 + mysterious
- continental-1 + lively

但默认值可以简单：alien 模式仍沿用现有默认，不做复杂自动推荐逻辑。

### 3. 重新合成 ready 节目

沿用 Task 004B.5 已支持的 regenerate audio 行为。重新合成失败时不得覆盖当前可用音频。

---

## D. 测试

所有自动测试不得调用真实 TTS。

至少覆盖：

1. 三种 dialect 都是确定性的；
2. 同词在同 dialect 中重复映射一致；
3. 同一词在不同 dialect 中一般得到不同结果；
4. 新算法产生的平均伪词长度明显短于旧 2–4 音节策略；
5. `continental-1` 能产生辅音簇 / 词尾辅音；
6. `machine-1` 产生更短、更硬的词形；
7. punctuation 保留；
8. machine DSP 输入合法 WAV 后仍能被 `parsePcmWav()` 正常解析；
9. DSP 前后 sampleRate / channels / bitDepth / duration 保持一致；
10. DSP 输出 PCM 不溢出；
11. 非 machine dialect 不执行 DSP；
12. recipe 正确记录 dialect / audio_effect；
13. captions 内容与时间不因 DSP 被改坏；
14. unsupported PCM 明确失败（如实现选择有限格式支持）。

运行：

```bash
pnpm test:checkpoint-b
pnpm lint
pnpm typecheck
pnpm build
```

若仓库已有更新后的测试脚本名称，以实际 package.json 为准。

---

## 手动验收

完成后不要自动批量收费合成。

用户手动使用**同一条中文语义稿件**分别生成三版 alien 音频：

1. `cosmic-1`
2. `machine-1`
3. `continental-1`

尽量保持同一个 delivery profile，便于只比较 dialect / DSP 差异。

重点听：

- machine-1 是否明显更“电影通信 / 机械 / 尖锐”，同时还能辨认出语言节奏；
- continental-1 是否像“真实但陌生的小语种”，而不是咒语或随机 syllable；
- 整体语速是否因伪词缩短而自然加快；
- 哪一版最接近用户脑海里的声音。

根据这次试听再决定是否继续微调；不要在没有试听证据前继续增加 DSP 效果。

---

## 本任务明确不做

- pitch shifting / formant shifting
- vocoder
- FFT 频域处理
- 新 TTS / Voice Conversion 供应商
- 声音克隆
- 用户可调 DSP 参数面板
- 完整人工语言语法
- 真实欧洲语言模仿
- 多轨背景噪声混音
- station/channel 模型
- Music Program
- ESP32

完成并由用户试听确认后，再回到 Task 004 Checkpoint C Music Program。
