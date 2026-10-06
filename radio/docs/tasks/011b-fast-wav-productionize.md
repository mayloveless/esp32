# Task 011B — Fast WAV 起播稳定性收口与默认启用

## 目标

011A 已证明单 TLS WAV fast path 在真机成立：

- Legacy prefetch-hit 首声中位数：5675.5 ms
- Fast prefetch-hit 成功样本中位数：3282 ms
- 改善：42.2%
- 最后 5 个 prefetch-hit fast 样本连续成功
- seek / 字幕绝对时间正确
- A/B 后发现并修复 fast 首帧初始化导致自然 EOF stall 的问题
- 修正版已额外完成 1 条真机自然 EOF + completed

当前默认仍：

```cpp
RADIO_FAST_WAV_START=0
```

本任务不再探索新架构，只做稳定性收口。通过后将 fast path 正式作为默认路径，同时保留 legacy fallback。

当前基线：

```text
8024c4a681d0a8787a10b7a4876ee38c5645af99
feat: add optional single-connection WAV start experiment
```

---

## 一、先不要改默认值

先保持：

```cpp
RADIO_FAST_WAV_START=0
```

使用显式 fast=1 构建完成下面的修正版真机验收。

不要用 011A 修 bug 前的 A/B 样本替代本任务验收。

---

## 二、修正版连续真机验证

至少完成 8 次实体换台，其中：

- 至少 6 次 prefetch hit；
- 至少包含 NEWS / CHAT / ALIEN / MUSIC；
- 至少 2 条节目让其自然播放到 EOF；
- 至少 1 次 startOffsetMs >= 10s；
- 至少 1 次字幕节目；
- 至少 1 次连续快速旋转后再锁台。

每次记录：

```text
prefetch
fast/fallback
TLS count
dial locked → first network PCM
startOffset
kind
```

验收：

- 无 crash；
- 无 mutex assert；
- 无 RingBuffer error；
- 无错误 EOF/stall；
- 手动换台不 completed；
- 自然 EOF 仅一次 completed；
- 字幕 seek 后位置正确；
- static / TFT 正常。

---

## 三、处理 011A 的 initial body timeout

011A 有一次：

```text
5852 / 8192 bytes
→ 3s timeout
→ fallback legacy
```

先判断这是偶发网络抖动还是 initial finite Range 过大导致的脆弱点。

允许做一个很小的实验：

- 比较 initial finite Range 8192 与 4096；
- 当前项目 WAV 由自有 renderer 生成，但仍必须真正解析 RIFF chunks，不得写死 dataStart=44；
- 如果完整 WAV header / data chunk 在 4096 内，允许使用 4096；
- 如果 header 超过有限窗口，fast path 失败并 fallback legacy。

不要为了追求成功率把 read timeout 大幅拉长。

目标是减少第一次 finite body 读取耗时和 timeout 概率。

如果 4096 没有明确收益或反而增加兼容复杂度，就保留 8192。

---

## 四、Fallback 必须继续保留

fast path 任意阶段失败：

```text
fast wav start failed: <stage>
fallback to legacy seek
```

要求：

- 先彻底关闭/清理 fast 连接；
- 不污染 decoder buffer；
- 不 completed；
- fallback 后 startOffset / caption clock 正确；
- fallback 失败继续走现有 failPlayback。

不要 silent fallback。

---

## 五、默认启用条件

只有修正版真机满足：

1. 8 次换台无 crash / assert；
2. 至少 6 次 fast 成功；
3. 至少 2 次自然 EOF completed；
4. fast 成功率 >= 85%；
5. prefetch-hit fast 首声中位数仍明显优于 legacy；
6. 字幕 / seek / static / TFT 无回归；

才将：

```cpp
RADIO_FAST_WAV_START
```

默认值改为 1。

legacy 路径和 fallback 代码必须保留，不能删除。

---

## 六、性能目标

不要求继续追到 2 秒。

本任务只确认 011A 的约 3.3 秒级体验在修正版上可稳定复现。

记录：

- fast prefetch-hit median；
- p90 或最慢成功值；
- fallback 次数；
- fallback 原因。

如果修正版 median 大致仍 <= 3.5s，就可接受为当前版本收口。

---

## 七、测试

保留并全部运行现有回归：

- playback
- controls
- display model
- captions
- tuning wav
- library seek
- library mutex
- caption clock
- fast WAV

再补最小测试：

1. fast first-play 修复后真实 EOF；
2. fast → fallback 后 legacy EOF；
3. finite initial body 不完整时不能发送第二 GET；
4. 4096/8192 若调整，header 超窗口必须安全 fallback；
5. fast 默认开关为 1 后 legacy API 本身仍能测试通过。

---

## 八、完成后的状态

如果通过：

- 将 fast path 默认开启；
- README 标记为正式路径；
- 011A 诊断保留；
- legacy 作为 fallback；
- 不再继续优化起播延迟。

如果不通过：

- 保持默认 0；
- 写明失败原因；
- 不继续扩大 library patch。

---

## 九、本任务明确不做

- 服务端音频代理；
- 音频 body 预取；
- TLS session cache；
- 更换 Storage；
- 更换音频格式；
- 新 UI；
- 新硬件功能；
- 自动下一台；
- 网络音频断续专项修复。

完成后暂停。
