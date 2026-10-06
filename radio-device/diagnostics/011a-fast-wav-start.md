# 011A 单连接起播实验状态

2026-10-06，基线 `c1e1960`，任务文档 `0f472e5`。**首声 A/B 已完成；自然结束暴露的首帧初始化问题已修复，九组主机回归与修正版真机 completed 验证通过。本任务暂停，保留默认关闭的实验。**

本机安装的 4.0.0 library 已保留 HTTP seek、decode mutex 和 caption clock 三个补丁，并追加独立计时层和显式 fast API 层。仓库默认 `RADIO_FAST_WAV_START=0`；设备在完成 legacy 基线后已烧录显式开启的 fast 实验固件，仓库源文件默认仍关闭。服务端无改动。

## 已测数据

同一设备 ESP32-S3 N16R8、AP `50:4F:3B:CC:FB:4E` / channel 9；115200 串口。实际 legacy 首次启动：

| 请求 | Prefetch hit | Offset | TLS 次数 | TLS ready | WAV header ready | Target Range sent | Target Range ready | First network PCM |
|---|---|---|---|---|---|---|---|---|
| boot | 否 | 12 s | 2 | 2067 ms | 3280 ms | 4989 ms | 5371 ms | 5799 ms |

所有时间点相对该次 network selection 锁定，目标 Range header 为 382 ms。严格 seek 到 `768044`，206 / 文件总长匹配，8192-byte prefill、WAV alignment 通过。随后 natural EOF，completed 请求成功。证据只保存常量诊断和数值：[011a-legacy-startup.txt](011a-legacy-startup.txt)。

这不是 prefetch-hit 换台，因此 **不计入 baseline median**。随后重新开启串口，已取得 6 次有效 prefetch-hit 物理换台基线（下表）；实验版已烧录，首次启动实际成功复用了同一 TLS，未回退；prefetch-hit A/B 结果见下表。

## Legacy prefetch-hit 基线

2026-10-06 晚间重新采集；所有样本 `prefetch=1 fallback=0 tls=2`，同一 AP / channel 9。`headerMs`、Range sent/ready、首个 PCM 均相对锁台，Range ms 是 GET sent 到 header validated。

| # | Kind | Offset (s) | Header (ms) | Target Range (ms) | First PCM (ms) |
|---|---|---|---|---|---|
| 1 | music | 9 | 2877 | 321 | 4650 |
| 2 | chat | 7 | 3762 | 491 | 6445 |
| 3 | news | 11 | 2258 | 452 | 4798 |
| 4 | music | 9 | 4367 | 311 | 6219 |
| 5 | music | 13 | 2175 | 482 | 6121 |
| 6 | chat | 5 | 2526 | 341 | 5230 |

中位数 **5675.5 ms**。全部严格 Range / seek / 8192-byte prefill 成功，无 crash、assert、RingBuffer 或播放失败日志。CHAT 样本 6 从绝对 5 秒的字幕第一页开始，随后 6/11/16/21/24 秒正常推进。新增证据：[011a-legacy-prefetch.txt](011a-legacy-prefetch.txt)。最早启动样本依然排除。

机器可读计数：[011a-start-timing-results.json](011a-start-timing-results.json)，筛选脚本：

```bash
python3 radio-device/diagnostics/summarize-start-timing.py /path/to/legacy.log /path/to/fast.log
```

脚本只读取严格 summary 数值字段并输出筛选结果，不输出原始日志行或 URL。它的样本计数达标不代表连续成功、听感、字幕和生命周期验收已通过。

## Fast 首次启动（排除 A/B median）

首次请求 `prefetch=0 fallback=0 tls=1`。WAV finite response 全部消费 8192 bytes；首次 206 总长 3041644；随后同一 client 在目标 `832044` / 13 秒取得 206，file total 一致。Header ready 3102 ms，目标 GET sent 3105 ms、header validated 3505 ms，首个 PCM 4241 ms。无连接不可复用或 fallback 日志。证据：[011a-fast-start.txt](011a-fast-start.txt)。

## Fast prefetch-hit A/B

同一 AP / channel 9，连续测量。表中 fallback 明确单列；成功样本均完整消费 initial 8192-byte response、目标 206、一个实际 TLS connect，目标 byte position = 实际 WAV dataStart 44 + seconds × byteRate 64000。

| # | Kind | Offset (s) | TLS | Header (ms) | Target Range (ms) | First PCM (ms) | Fallback |
|---|---|---|---|---|---|---|---|
| 1 | news | 4 | 1 | 2876 | 240 | 3405 | 否 |
| 2 | news | 14 | 3 | 7943 | 301 | 9815 | 是 |
| 3 | music | 11 | 1 | 2409 | 280 | 3067 | 否 |
| 4 | music | 8 | 1 | 2667 | 342 | 3387 | 否 |
| 5 | alien | 14 | 1 | 2388 | 291 | 3177 | 否 |
| 6 | music | 7 | 1 | 2167 | 280 | 2749 | 否 |
| 7 | chat | 12 | 1 | 2365 | 410 | 3557 | 否 |

6 个成功 prefetch-hit 样本中位数 **3282 ms**，相对 legacy 5675.5 ms 减少 **2393.5 ms / 42.2%**。最后 5 个 prefetch-hit（#3–7）连续成功；#6/#7 之间有一次前台 tune，单连接同样成功（3148 ms），不计 prefetch-hit median。Startup 4241 ms 同样排除。数值来自 raw-sample callback 的首个可输出 NETWORK PCM，非 seek applied 或 Serial 到达时间。

一次失败发生在 initial finite response body 读取：原生 read 的 3 秒超时前只收到 **5852 / 8192 bytes**。该请求的 206/header 已合法，但响应体未消费到边界，故 **没有在脏连接上发送第二个 GET**，不将初始 PCM 放入 decoder，不 completed；停止该连接后明确 fallback。fallback legacy 目标 14 秒的 Range/seek 成功，字幕绝对 14 秒处 page 3/11，首声 9815 ms，TLS 总数 3。此样本不能作为 fast 成功统计，也不能证明服务器不支持 keep-alive。

换台验收窗口无 crash、mutex assert 或 RingBuffer 错误；随后自然结束出现一次 stall，详情见下节。NEWS fast 首帧字幕是绝对 4000 ms，ALIEN 为 14000 ms page 2/8，CHAT 为 12000 ms index 1/page 1，之后 14/18/24 秒正常推进。用户已确认“已换至少 5 次，声音和字幕正常”，没有报告新增爆音、声音错乱或字幕错位。该轮最后一条 CHAT 的自然结束未通过，不能将以上换台成功样本解释为 completed 验收通过。

## 自然结束发现与修复

换台 A/B 完成后，不再操作旋钮，让最后一条 CHAT 从绝对 12 秒播放至尾部。字幕正常推进至 62 秒，但在串口相对 483.481 秒发生 `audio playback failed`，状态为 libraryError=0 / WiFi=3 / ready=1 / seekPending=0 / samples=1 / running=1，没有 completed。

检查真实 `playAudioData()` 后定位：fast API 提前设置了 `m_audioDataReadPtr = target - dataStart`，却保留 `m_f_firstPlayCall=true`。首个 decode 迭代将 read pointer 清零，caption clock 仍正确，但末尾按完整 dataSize 等待缺失的 offset 数据，触发既有 30 秒 stall 保护。未伪造 EOF 或 completed。

修复只在显式 fast 初始化、同一 decode mutex 内提前完成原有 first-play 字段初始化并设 `m_f_firstPlayCall=false`；普通入口保持原样。新增 host test 执行真实 `playAudioData()`，检查首帧保留目标 offset，并只提供目标 Range 的剩余字节，最终必须到达真实 EOF。将修复字段还原为 true 时，这条回归能复现失败。九组 host 回归全部通过。

上述 A/B 数值来自修复前版本，保留原始证据，不将其重标为修正版重测。修正版额外完成一条真机节目：MUSIC 从 7 秒 / 448044 bytes 开始，initial 206 总长 3041644、8192 bytes 全部消费，目标 206、TLS=1、首个 PCM=2946 ms（startup，排除 A/B median）。串口相对 178.640 秒显示 NO SIGNAL / `audio playback completed`，181.135 秒 `completed request succeeded`。仅一次自然 EOF/completed，无新增 tune、fallback 或播放失败，采集结束并释放串口。证据：[011a-fast-eof.txt](011a-fast-eof.txt)。五次连续换台及听感来自先前 A/B，不声称修正版已额外完成五次物理换台。

## 当前结论与收口边界

**同 TLS 连接复用假设已在真机成立，并有明显首声收益。** 这次实际 legacy 比任务参考的约 3.8 s 更慢；依照同 Wi-Fi 的本次 baseline，median 改善 42.2%，超过 25% 相对标准，但 **3.282 s 尚未达到参考的 2.8–2.9 s 绝对目标**，且存在一次 body-read 超时回退。不能据此宣称稳定体验已完全收口。

保留可撤销的实验补丁和诊断；仓库默认开关仍为 0，普通 connect + seek 保持可用。修正版自然 EOF 验证已通过，现在暂停；正式采用另作决定。本任务不继续扩展代理、裁剪对象、音频 body/connection prewarm、音量/UI/自动下一台或断续专项。当前设备暂运行这次 A/B 的显式实验固件；没有把主分支默认行为切换到 fast。

## 构建

计时 legacy 固件已编译/烧录，校验通过：flash 2,407,967 bytes (76%)，静态 RAM 70,332 bytes (21%)。显式 fast 开关启用的实验版本已编译：flash 2,412,471 bytes (76%)，RAM 同上；当前源文件开关已恢复 0，追加 EOF 初始化修复前，默认关闭版本也已编译通过：flash 2,409,587 bytes (76%)，RAM 同上。EOF 修复只影响显式 fast API，最新两种开关的主机回归通过；最新硬件编译/烧录为 fast=1。

主机覆盖和补丁安装/回退方式见 [patches/README.md](../patches/README.md#011a-单连接-pcm-wav-实验与-ab-结果)。不要把 host transport fake 的单连接成功当成 Supabase/ESP32 实测结果。
