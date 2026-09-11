# Task 004 — Broadcast Renderer：让节目真正像宇宙电台

## 目标

Task 003 已经让 Web Receiver 跑通了调台、临场切入、播放完成下线、恢复与小型预取缓存。下一步暂时不接 ESP32，而是把“可播放的一条普通 TTS”升级为真正有节目形态的广播。

本任务聚焦三个当前缺口：

1. **聊天节目至少有两种不同音色**，而不是所有 speaker 都由一个声音朗读。
2. **收音机里能真正出现音乐节目**，先把音乐作为 Program 类型和库存打通，不为了这一步绑定新的 AI 音乐供应商。
3. **支持外星语播报 + 中文翻译字幕**，外星语必须稳定、可重复、像一种语言，而不是随机乱码。

任务结束后，Web Receiver 应该能收到至少三种明显不同的节目体验：单人新闻、双人对话、音乐；并能收到一条外星语节目，在播放时看到与语音对应的中文翻译。

## 当前基线

- 仓库：`mayloveless/esp32`
- 基线提交：`c6c363932631c55fb6cb9602792c555971fe63c9`
- Task 003 的 Receiver runtime 已经由用户手动验证可用；其中缓存/补货逻辑虽提前在 B 提交中实现，但视为当前基线，不回滚重做。
- 现有架构继续复用：
  - `content/`：DeepSeek 语义稿件
  - `tts/`：单次 TTS 供应商调用
  - `program/`：节目与音频资源
  - `receiver/`：播放 manifest 与运行时
- 当前 TTS 配置使用通用 `TTS_*` 环境变量；当前唯一实现仍是 SiliconFlow + `FunAudioLLM/CosyVoice2-0.5B`。供应商只是当前可用实现，不把上层 Renderer 设计绑死在 SiliconFlow。
- DeepSeek 文本侧继续保持 `DEEPSEEK_*`，不为统一命名而重构。

开始前读取最新 main；如用户已有更新，以最新代码为准，不覆盖用户改动。

## 核心设计原则

### 1. `tts` 与 `renderer` 分层

`tts/` 只负责“给一段文本和一个 voice，返回一段语音资源”。

新增轻量 `renderer/`，负责：

- speaker → voice 分配；
- 将语义 `segments` 转为实际播报单元；
- 多段语音的顺序与间隔；
- 外星语的 spoken text 与中文 translation；
- 合并最终节目音频；
- 根据实际片段时长生成粗粒度 captions。

不要建立通用媒体流水线、插件框架、时间轴编辑器或复杂音频工程系统。

### 2. Program 仍尽量是一个最终音频资源

Receiver 当前已经稳定消费一个 `audioUrl`。Task 004 不把 Receiver 改成复杂 playlist 协议。

语音节目在服务端 Renderer 阶段产出一个最终可播放文件，再保存到现有 `audio_path`。这样以后 ESP32 仍只需播放一个节目资源。

### 3. 多音色不要靠“伪装 speaker 文本”

聊天节目必须真正使用至少两种 voice。第一版不做声音克隆。

当前 CosyVoice2 单个请求的 `voice` 只接受一个音色，因此聊天可按 speaker/连续发言单元分别调用 TTS，再安全合成为一个节目文件。不要把多个 MP3 文件直接做未经验证的二进制拼接。

当前 SiliconFlow 官方 TTS 支持 `mp3 / opus / wav / pcm`，WAV/PCM 支持 32kHz。优先考虑统一请求 WAV 32kHz 作为多片段中间/最终格式：解析并验证 WAV PCM 参数一致后拼接 data chunk，重写合法 RIFF/WAV header；必要时在 speaker 切换处加入约 120–250ms 静音。若实际响应格式与预期不符则失败，不猜测。

如果实现者选择其他合并方式，必须说明为什么可靠，并用真实格式验证；不要为这一点引入独立 ffmpeg 服务或大型媒体基础设施。

### 4. 外星语是 Renderer，不是第二套“真实含义”

语义稿件仍以中文（或用户指定的可理解语言）保存，作为含义来源。

外星语模式在 Renderer 中把每个 segment 的语义文本转换为可发音的伪语言 `spokenText`，同时保留原文为 `translation`。TTS 只读 `spokenText`；字幕显示 `translation`。

第一版不要让 LLM 每次自由编一串随机外星语。优先做**确定性转换**：

- 给一种默认方言/seed；
- 相同输入词在同一方言中应稳定映射到相同或高度一致的音节；
- 保留标点和句子节奏；
- 产物只使用当前 TTS 能稳定读出的可发音字符；
- 不要求真正构造完整人工语言语法。

可利用 Node/浏览器内建能力（例如 `Intl.Segmenter`）做中文分词后，对词做稳定 hash → 音节组合；不要为了第一版引入大型 NLP 依赖。

### 5. 音乐先解耦“节目能力”和“音乐生成供应商”

Task 004 必须让 Receiver 能收到真正的 music Program，但不要求现在注册或绑定新的 AI 音乐服务。

第一版允许后台创建 music Program 并上传用户本地拥有/有权使用的 MP3/WAV。上传成功、格式及时长校验通过后才进入 `ready`；`recipe` 记录 `audio_source = manual_upload`。以后 AI 音乐生成器只需成为另一个 audio source，不改 Receiver 协议。

不要把版权受限的音乐文件提交进 Git。

## 检查点 A — Renderer 基础 + 双人音色聊天

先解决“聊天像聊天”。完成后暂停 review。

1. 新增 `renderer/` 轻量模块；保持 `tts/` 为底层供应商调用，不把 voice 分配逻辑塞进 API route。
2. TTS 配置继续使用通用环境变量，增加两种通用 voice 配置：
   - `TTS_VOICE_PRIMARY`
   - `TTS_VOICE_SECONDARY`
   当前 SiliconFlow 实现可使用两个不同的 CosyVoice2 内置 voice；不要在上层用 `SILICONFLOW_*`。
3. speaker → voice 映射必须稳定：
   - 一个节目中第一个 speaker → primary；
   - 第二个不同 speaker → secondary；
   - 若语义稿件出现更多 speaker，可稳定复用两种 voice，不因 segment 顺序变化随机切音色。
   - 保存实际 speaker/voice 映射到 `recipe`，便于复现和调试。
4. 合并相邻的同 speaker segment 以减少不必要的付费 TTS 调用，但不能改变语义顺序。
5. 新闻仍可单音色；聊天至少真正用到两种不同 voice。
6. 多段合成优先使用 WAV 32kHz：
   - 校验 WAV header / PCM format / channels / bit depth / sample rate；
   - 只合并参数一致的片段；
   - 重建合法最终 WAV；
   - speaker 切换间加入很短静音；
   - 根据每个真实片段时长累计生成 captions。
7. 把现有硬编码“只保存 MP3”的保存逻辑适度泛化为 audio asset：至少能保存 `audio/mpeg` 和 `audio/wav`，正确的扩展名、duration、sample rate 与 metadata。不要新增数据库列，继续存在 `audio_path / duration_ms / recipe / captions`。
8. captions 第一版使用粗粒度结构即可，例如：

```ts
{
  startMs: number;
  endMs: number;
  speaker: string;
  text: string;
}
```

时间必须来自实际合成片段时长累加，不伪造逐字时间戳。
9. UI 对 chat 仍只有一个“合成语音”入口；由 Renderer 自动选择两种 voice，不要求用户逐角色配置。
10. 保持显式点击才产生付费调用，不自动重试、不批量生成。失败保留语义稿件，不覆盖已有可用音频。
11. 写不产生费用的测试：speaker 映射、相邻 segment 合并、WAV 解析/拼接、静音、字幕时间、格式不一致失败、TTS 片段中途失败时不保存半成品。
12. 运行 test、lint、typecheck、build。

完成后用户可手动选一条两人 chat，只合成 1 条实际节目验证两种声音与最终文件播放；不要自动生成测试节目。

## 检查点 B — 外星语播报 + 中文翻译字幕

A review 通过后再做。完成后暂停 review。

1. 在“合成语音”附近增加轻量播报模式：
   - `normal`
   - `alien`
   默认 normal。
2. 语义内容不因 alien 模式被覆盖。保存/保留：
   - 原始 `text`：中文含义；
   - Renderer 产生 `spokenText`：外星语；
   - caption 的 `text`：中文翻译。
3. 新增一个默认外星方言实现，例如 `dialect = "cosmic-1"`，但不要建立方言管理后台或世界观数据库。
4. 外星语转换必须确定性、可测试：相同方言 + 相同词应得到相同结果；不同标点/句界保持自然停顿；输出不能是随机 Unicode 乱码。
5. 优先使用可发音的拉丁字母音节集合，让当前 TTS 能稳定读出。不要假设供应商懂“外星语”。
6. alien 模式仍使用现有通用 TTS / Renderer，多 speaker 时继续保留双音色。
7. `recipe` 记录 `render_mode`、`alien_dialect`、实际 voice mapping。
8. Receiver 页面增加最小字幕显示：根据当前播放时间显示对应 caption。normal 模式显示原文；alien 模式显示中文 translation。不要做复杂字幕编辑器或动画。
9. 调台从中途 `startOffsetMs` 进入时，字幕也必须立刻定位到对应时间段，而不是从第一句开始。
10. 测试确定性映射、标点、caption 时间查找、startOffset 字幕定位。
11. 只允许用户手动合成一条实际 alien 节目验证效果；不批量产生费用。

## 检查点 C — Music Program 打通

B review 通过后再做。完成后暂停 review。

1. 把 `music` 从数据库里“理论支持”升级为后台真实可创建类型；不要让 DeepSeek 稿件生成接口误处理 music。
2. 后台提供最小音乐节目创建流程：
   - 标题；
   - 可选说明/风格 metadata；
   - 本地 MP3 或 WAV 上传。
3. 服务端验证：
   - MIME 与文件签名匹配；
   - 文件大小限制；
   - 可解析的真实 duration；
   - 支持的音频格式。
4. 上传成功后保存到现有私有 `radio-audio` bucket，`status = ready`、`retired_at = null`，并记录：

```json
{
  "audio_source": "manual_upload"
}
```

5. 上传/DB 更新失败时保证可恢复，不留下明显孤儿对象；替换音乐时沿用当前资源清理策略。
6. music 不需要 `segments`、TTS 或 captions；Receiver manifest 与调台逻辑应无需特殊 API 即可播放 music。
7. music 也遵守 Task 003 生命周期：完整听完 retire，后台可以恢复，中途切台不 retire。
8. Receiver 的临场切入对 music 同样生效，但特别短的音乐/音效仍允许从 0 开始。
9. 不引入新的 AI 音乐供应商，不抓取网上音乐，不把真实音乐二进制提交 Git。测试用音频 fixture 必须自行程序生成或极小且无版权问题。
10. 运行 test、lint、typecheck、build，并用一条用户本地音乐手动验证调台与 completed/restore。

## 本任务明确不做

- AI 自动作曲供应商接入
- 自动节目库存 worker 的长期调度
- 完整频道/station 数据模型
- 世界观与角色数据库
- 真正连续 24h 电台时间线
- 声音克隆
- 多轨背景音乐 + 人声混音
- 混响、均衡器、复杂广播音效链
- 外星语完整语法/词典编辑器
- ESP32 播放
- TFT/旋钮
- 公网部署/设备鉴权

这些都可以在 Web Receiver 的节目体验稳定后再拆。

## Task 004 完成标准

在现有 `/receiver` 中可以连续收到并正确播放：

1. 一条单人新闻；
2. 一条至少两种真实不同音色的聊天节目；
3. 一条 music Program；
4. 一条外星语节目，语音是稳定可发音的伪语言，同时字幕显示对应中文含义。

它们都继续使用 Task 003 的调台、临场切入、缓存、completed retire 与后台 restore 机制。完成 Task 004 后，再决定是否补 station/jingle、AI 音乐生成和自动库存，再进入 ESP32。