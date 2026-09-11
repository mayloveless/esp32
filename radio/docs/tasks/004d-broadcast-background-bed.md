# Task 004D — Broadcast Background Bed：让讲话节目更像电台

## 目标

当前 news / chat / alien 节目已经可以生成完整语音，music Program 也已经支持程序化生成。下一步把现有程序音乐能力复用到讲话节目里，作为低音量背景 bed，与最终语音混合成一个 WAV。

这一步只解决“讲话节目太干、太像纯 TTS”的问题，不做真正歌曲演唱。

## 当前基线

- 最新基线提交：`f36c65847a5a5baa0042e41bca52302a289158f2`
- 现有语音 Renderer 输出 32kHz / mono / PCM WAV。
- `music/` 已可程序化生成 32kHz / mono / 16-bit PCM WAV，包含 orbital ambient / retro synth / mechanical pulse / alien signal 等风格。
- Receiver 继续只消费一个最终 `audioUrl`，不要改为多轨播放。
- captions / startOffset / completed / retire 生命周期保持不变。

开始前读取最新 main；如果用户又有新提交，以最新代码为准。

## 核心设计

### 1. 背景音乐在服务端混入最终节目文件

不要让浏览器或 ESP32 同时播放两条音轨。

流程：

```text
语音 Renderer -> speech WAV
程序音乐生成 -> background bed WAV
                 ↓
             PCM mixer
                 ↓
          final broadcast WAV
```

Receiver 仍然只拿一个最终音频文件。

### 2. 背景音乐不是完整 music Program 的直接复用

可以复用现有 `music/` 的合成基础能力，但 background bed 必须更克制：

- 没有强主旋律抢人声；
- 减少高频尖锐方波与密集 percussion；
- 低动态、持续感更强；
- 音量明显低于语音；
- 长度严格匹配最终 speech WAV。

优先给 music synth 增加一个轻量 `bed` / exact-duration 入口，而不是先生成一首完整音乐再硬截断。

### 3. 第一版只做少量 preset

增加：

- `none`
- `ambient`
- `pulse`
- `mysterious`

含义：

- `ambient`：新闻/普通宇宙广播可用，低频 pad + 很少量音色变化。
- `pulse`：突发新闻/机械广播可用，轻节拍但不能干扰语音。
- `mysterious`：外星/深夜广播，弱 drone / signal texture。

不要建立复杂音乐配置后台。

### 4. UI

在已有语音合成区域增加一个简单“背景音乐”选择：

```text
无 / 氛围 / 脉冲 / 神秘
```

默认：

- news: `ambient`
- chat: `ambient`
- alien + machine-1: `mysterious`
- 用户可以手动改为 `none`

不要隐藏随机决定是否有背景音乐；第一版让用户明确选择，便于试听比较。

### 5. 混音

新增轻量 PCM mixer，不引入 ffmpeg 或大型音频库。

要求：

- 两路必须都是同样的 32kHz / mono / PCM WAV；
- 解析成 PCM 后再混，不做 WAV/MP3 二进制拼接；
- speech 为主轨；
- background 基础 gain 建议约 `0.08 ~ 0.16`，按实际听感选一个克制默认值；
- intro / outro 可以比正文略高，但不要为了第一版建立时间轴编辑系统；
- 利用 captions 的 speaking ranges 做简单 ducking：有人声时背景更低，句间短暂停顿可略微抬高；
- ducking 的 gain 变化要有短 ramp，避免点击声；
- 混音结束统一做 DC removal / peak normalization 或 soft limiter，防止 clipping；
- 最终 duration 与 speech 保持一致；
- captions 不重新计算，人声时间轴必须保持不变。

### 6. recipe metadata

最终保存：

```json
{
  "background_bed": "ambient",
  "background_bed_seed": "...",
  "background_bed_gain": 0.12,
  "background_bed_generator": "procedural-bed-v1"
}
```

`none` 时也记录 `background_bed = "none"`，便于复现。

### 7. 失败策略

- TTS 成功但 background bed 合成/混音失败时，本次“重新合成”整体失败，不覆盖现有可用音频；
- 不保存半成品；
- 不因为 background bed 失败再次发起 TTS；
- 如果实现结构允许，先把 TTS 结果保存在内存，bed 与 mix 全部完成后再一次性写 Storage。

## 歌声：本任务不做

目前程序音乐是纯合成器，现有 CosyVoice / TTS 链路不是歌唱模型。不要用普通 TTS 强行做“唱歌”，也不要用 pitch-shift 把朗读伪装成演唱，听感通常会比没有歌声更差。

后续如果接入专门的 singing / music-generation model，再把 `music` Program 的 `audio_source` 扩展为新的 provider；Receiver 和 Program 生命周期不需要改。

## 测试

补充不收费测试：

- background bed 对同一 seed 可复现；
- exact duration 与 speech 一致；
- PCM 格式不一致时拒绝；
- `none` 不改变 speech audio；
- mixer 不 clipping；
- speaking range 内 background gain 明显低于句间；
- captions 时间完全保持；
- machine / alien 音效之后再混背景时顺序明确且稳定；
- 重新合成失败不覆盖旧 ready audio。

运行：

```bash
pnpm test:checkpoint-b
pnpm lint
pnpm typecheck
pnpm build
```

如 package script 已调整，执行项目当前等价命令。

## 完成后暂停

不要继续做歌声、AI Music provider、ESP32。

用户手动试听至少：

1. 一条普通 news + ambient；
2. 一条 chat + ambient；
3. 一条 alien/machine + mysterious；
4. 同一条节目切回 none 做 A/B 对比。

重点判断：背景音乐是否让节目更像真实电台，同时没有明显压住人声。