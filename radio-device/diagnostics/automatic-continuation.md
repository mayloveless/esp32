# 自然结束自动续播（2026-10-07）

用户已确认本机缓存取流后原有“播一帧停一下”的断续感消失，要求补上自然播完续播。此改动仅增加设备播放控制，不改音量、I2S、库补丁或服务端节目生命周期。

自然 EOF 通过原有成功播放保护后，只上报一次 completed；2xx 后优先消费有效预取，没有则请求下一条一次。自动接入从 0 秒，手动调台维持 startOffsetMs。旋钮动作优先，失败/无库存/断网/上报失败不会自动重试。旧任务“不自动 tune 下一条”的限制由本次用户请求覆盖。

播放、控制（legacy / fast 两条路径）、字幕、显示模型、实际 fast WAV 库函数共五组主机回归通过，diff whitespace 检查通过。控制检查新增连续两次自然续播，以及在 completed/HTTP/音频 connect 中发生旋钮动作的竞争保护；播放失败后没有 completed 或自动续播。ESP32 编译、烧录与真机验证正在进行，未确认硬件结果之前不标记整体验收通过。

ESP32-S3 编译通过：Flash 2,413,515 bytes / 76%，静态 RAM 70,340 bytes / 21%；沿用 fast=1 / initial=8192。固件 binary SHA-256 `f22d0861a1141aa4ed838757bdf75768d7a5037c0e669c502ab1d8106101dc26`，编译参数和镜像私有保存在 `/tmp/radio-autocontinue-build`。已安装 Audio.cpp 保持原 fastWavStart 指纹 `88d15ab107147de5034fb2e41a474995c27ab938496f2c749267db9d56f2886a`，音量 15；未恢复破音候选 I2S 补丁。

烧录写入 hash 校验通过，持续串口采集见 [真机记录](automatic-continuation-trace.txt)。已记录 3 次连续自然续播，每次均为 completed 成功 → 有效预取命中 → startOffsetMs=0 → initial/目标 Range 206 → 实际网络 PCM；没有依靠旋钮触发。

| 上一条 EOF（采集秒） | completed 成功 | 下一条首 PCM | 衔接秒数 | 下一条类型 |
|---|---|---|---|---|
| 144.048 | 145.494 | 145.808 | 1.760 | music |
| 189.758 | 191.463 | 191.726 | 1.968 | news |
| 221.877 | 223.414 | 223.676 | 1.799 | music |

NEWS 续播首条字幕匹配 playbackMs=0，后续页按真实播放时间推进；MUSIC 无字幕。此前多次手动换台仍走非零 offset 与 static，未误 completed。当前记录没有播放失败或 fatal；日志只证明控制/Range/PCM 事件，扬声器听感与偶发爆音仍以用户硬件反馈为准。续播仍包含同步 completed 请求和建连，因此本轮约有 1.8–2.0 秒衔接。
