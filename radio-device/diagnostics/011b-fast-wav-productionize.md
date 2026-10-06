# 011B WAV 起播稳定性验收

2026-10-06；实现基线 `8024c4a`，任务文档 `fe99697`。当前仍保持 `RADIO_FAST_WAV_START=0`，设备使用显式 fast 构建。011A 的修复前 A/B 和那次单条修正版 EOF 不计入 011B 的物理验收。

## 8192 初始窗口：修正版新一轮真机数据

同一 ESP32-S3 N16R8 / 115200 串口，以实际 NETWORK raw PCM 的事件时间计算首声。首次打开采集不重置设备，所有下表 selection 都来自新一轮实体换台，包含普通 tune 和 prefetch hit。

| # | Kind | Offset (ms) | Prefetch | TLS | First PCM (ms) | Natural EOF |
|---|---|---|---|---|---|---|
| 1 | music | 12877 | False | 1 | 5127 | 0 |
| 2 | alien | 9361 | True | 1 | 3725 | 0 |
| 3 | chat | 9462 | True | 1 | 3735 | 0 |
| 4 | music | 5793 | True | 1 | 3759 | 0 |
| 5 | alien | 7556 | True | 1 | 5179 | 0 |
| 6 | news | 13081 | False | 1 | 3218 | 0 |
| 7 | news | 10950 | True | 1 | 4634 | 1 |
| 8 | music | 12483 | True | 1 | 3194 | 0 |
| 9 | music | 12882 | True | 1 | 3635 | 0 |
| 10 | music | 10265 | True | 1 | 3822 | 1 |

10 次 fast 全部成功，无 fallback、crash、assert、RingBuffer 错误或播放失败。8 次 prefetch-hit 中位数 3747 ms，最慢成功 5179 ms。NEWS 在串口相对 462.365 秒自然结束，465.014 秒 completed 成功；MUSIC 在 662.894 秒自然结束，664.439 秒 completed 成功。每条均仅一次；其余手动中断没有 completed。字幕按 seek 后的绝对秒数推进，已覆盖四种节目和 >=10 秒 offset。用户确认沙沙声、显示、声音和字幕正常，并询问自然结束为什么不续播；当前任务明确不做自动下一台。

证据：[8192 trace](011b-8192-trace.txt)、[8192 数值](011b-8192-results.json)。本轮可以确认 EOF 初始化修复的稳定性，但中位数略超 3500 ms 目标，因此继续进行任务允许的 4096 窗口比较，暂不默认启用。

## 有限响应大小判断

011A 的 5852/8192、3 秒 initial-body 超时是完整响应体未消费到边界；旧日志不足以独立断言是网络抖动还是窗口大小所致。本轮 10 次 8192 均完整消费，但首声/初始响应时间存在波动。TLS ready → WAV header ready 包含初始 HTTP response header 和 finite body，不能当成纯 body read 时间；本轮该段中位数 1520.5 ms。将请求窗口缩至 4096 可能减少需要等候的 body，仍需真机数据判断，不能用 host fake 声称网络收益。

窗口比较只增加编译期 `RADIO_FAST_WAV_INITIAL_BYTES`（4096/8192），初始分配、有限 GET、严格 framing 校验、完整 body 消费和 RIFF 解析全部使用同一个值。8 KiB 目标 PCM prefill、3 秒 timeout、HTTP Range、decoder mutex、caption clock 和 legacy fallback 不变。header 超出选定窗口，在第二个 GET 前明确失败并 fallback；从不写死 44-byte header。

## 主机回归

九组现有回归通过。新增 fast → fallback → legacy seek 后自然 EOF 仅 completed 一次，以及手动中断 fallback 不 completed。fast WAV 测试分别以 4096/8192 编译，验证不完整 body 不发第二 GET、真实 decode 的目标读指针/EOF、header 超窗口无 PCM/目标 GET，以及实际 dataStart=6000 时 8192 能解析、4096 安全拒绝。legacy API 与既有 seek/mutex/clock 回归保留。

## 4096 初始窗口：进行中的新真机数据

显式 fast=1 / initial=4096 固件编译、烧录校验通过；当前只统计烧录之后的新样本。startup 明确排除：其首声 7652 ms，其中 TLS ready 本身为 5262 ms，不能用这次启动代表预取换台速度。

最初 5 次实体换台均 prefetch-hit、fast 成功、TLS=1；随后第 6 次出现连接双失败，见下节，不能再将该版本描述为无失败。NEWS、MUSIC、CHAT 已覆盖，尚缺 ALIEN。startOffsetMs 包含 14607 和 11085，字幕从相应绝对时间开始；有 local static ready、dial stopped/static off 和 TFT PLAYING 日志。

| Kind | Offset (ms) | First PCM (ms) |
|---|---|---|
| news | 4220 | 3873 |
| music | 4074 | 3169 |
| music | 14607 | 3667 |
| chat | 11085 | 3049 |
| chat | 6509 | 5233 |

阶段性 prefetch median **3667 ms**，最慢成功 **5233 ms**；初始 response 阶段 median **868 ms**，相对 8192 的 1520.5 ms 降低约 **42.9%**。这是含 response header 的阶段，非独立 body timer，也尚不能证明总体首声/超时概率已改善：当前总首声 median 仍高于 3500 ms，样本仍未收齐，两轮观察均未遇到 initial-body timeout。

最后一条 CHAT 已自然结束：串口相对 662.800 秒 NO SIGNAL / audio playback completed，664.887 秒 completed request succeeded，仅一次。此记录属于 4096 新版本，不复用 011A 或本轮 8192 的 completed。

随后连接双失败暴露调台 latch 问题；当前先修复恢复能力，再继续 ALIEN / 自然 completed / 物理换台验收。该轮采集已停止以便烧录修复，现场日志保留在 `/tmp/radio-011b-4096.txt`，仓库中的 trace/JSON 为当前验收快照：[4096 trace](011b-4096-trace.txt)、[4096 数值](011b-4096-results.json)。

## 连接失败后无法再调台：现场发现与修复

用户反馈“现在转不到节目了”。持续日志保留了此前自然 completed，以及之后完整故障：第 6 次物理换台 prefetch 已过期，普通 tune 得到 MUSIC / startOffsetMs=14105。fast connect 在串口相对 1151.968 秒失败，明确 fallback；legacy connect 也失败，1170.510 秒进入 failPlayback。没有 TLS-connected、HTTP status 或 WAV initial body 记录，故这次不能归因于 4096 header 窗口或 signed URL 的 HTTP 状态。

此后多次 `encoder feedback` / local static / TUNING → NO SIGNAL，却没有 `dial travel threshold`、tune 请求或新 manifest。真实 `RadioTuneInput::request()` 的 selectionLatched 在阈值选台时设置，只有 accepted playback / finishTuningIdle 的 hold() 清除。011A 的“双失败 → failPlayback”分支绕过 finishTuningIdle，保留了锁定标志，后续所有旋转都无法产生下一次选择 revision。

最小修复在 failPlayback 的 controlsMux 下调用与 finishTuningIdle 相同的 hold(millis())，释放已失败选择的 latch；保留 4 秒 hold、大小角度阈值、手动动作才能再请求、原 history / completed / owner 语义，不添加自动重试。

controls 新回归通过真实物理 travel 产生 latch，执行 fast + legacy 双连接失败，核对不会 completed / 自动重试，然后通过 16 个真实输入边沿再次排队并成功接受节目。将这处修复去掉时，新测试可复现旧 latch 失败。九组回归已全部通过，硬件修复版已编译并烧录、写入校验通过。

修复版首次启动仍发生 fast / legacy 建连双失败，未输出 PCM；后续实体旋转重新产生了 `dial travel threshold`、`tune request queued` 和 CHAT manifest（offset=9723），用户确认已能选到节目，说明失败后重新选台能力已恢复。该次建连被诊断重启中断，不计为成功首声或网络失败样本。随后重新采集底层 TCP/TLS 错误，网络问题与 latch 修复分开记录，不能以恢复选台代替播放验收。

原始故障保留在 [4096 trace](011b-4096-trace.txt) 和 [4096 数值](011b-4096-results.json) 中：最初 5 次成功 + 1 次双失败，fast 成功率 83.3%，不能视作默认启用验收通过。电脑无 token 的 Storage 服务入口只读检查返回 HTTP 404，TLS 0.713 秒，说明主机当前能到达服务，不替代 ESP32 网络验证。修复后的新现场采集将使用独立日志 `/tmp/radio-011b-recovery.txt`，不抹去这次失败。

诊断重启后的 ALIEN 启动请求中，fast 和 legacy 都在 `ssl_client.cpp:157` 的 TCP `SO_ERROR` 检查返回 errno=113（原生文本 `Software caused connection abort`），随后 `NetworkClientSecure` 返回 connect failed=-1。失败发生在 TLS handshake / HTTP 请求之前，不是 Range、WAV header 或 token 的 HTTP 校验失败。采集器增加仅允许的原生网络错误行，仍不保存 Audio 的带完整 signed URL 错误。

电脑只读网络对比：路由器 DNS 返回 `104.18.38.10` / `172.64.149.246`，电脑 DNS 返回 `198.18.2.106`；电脑对 fake-IP 及真实公网地址均经 `utun8` / `198.18.0.1` 路由。电脑请求成功因而不能证明 ESP32 的普通 Wi-Fi 出网路径可用；代理路径差异是下一步网络排查线索，尚未据此断言 ISP、路由器或 DNS 是根因。未修改网络配置或增加音频代理。修复及网络故障快照见 [recovery trace](011b-recovery-trace.txt)，其中两条启动样本和被诊断重启中断的实体请求均不计入首声验收。

## 当前状态

4096 显式 fast 比较固件及最小恢复修复已编译并烧录，flash 2,412,511 bytes (76%) / RAM 70,332 bytes (21%)，写入校验通过，默认仍保持关闭。失败后的实体选台请求已恢复，音频连接仍需核对。烧录启动样本与诊断重启中断的样本明确排除实体首声统计。最终是否启用必须依据该版本的新物理样本、两次自然 completed 和用户对 static/TFT/听感的反馈。收口后暂停，不增加服务端代理、音频 body 预取、TLS cache、格式/UI/硬件功能或自动下一台。
