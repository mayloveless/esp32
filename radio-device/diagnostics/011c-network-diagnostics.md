# 011C 网络诊断：暂缓，恢复 011B

2026-10-07；源码基线 `49ec18c0579534541f8355e0efa565b49d39aa20`，任务文档 `52315f0`。

**011C 未通过验收，按用户要求暂缓，可跳过继续独立功能开发。** 已将设备烧回之前连续 10 次成功验收的 011B / 8192 保存固件，烧录 hash 校验通过，用户随后确认“现在正常了”。本次提交移除未验收的运行探针；sketch 和 controls 测试恢复到仓库中的 011B 基线，保留后期失败释放调台锁的修复，不改 Wi-Fi、路由、DNS、服务器或音频库。

当前没有后续任务明确依赖 011C。跳过不代表 TCP 失败根因已解决，不满足 fast 默认启用的稳定性条件，源码仍保持 `RADIO_FAST_WAV_START=0`。以后涉及连续播放稳定性或默认启用 fast 时，再单独处理这一未解决项。设备保持目前用户确认可用的固件，不继续诊断烧录。

## 已发生的诊断

下面是历史试验记录，不是当前源码可开启的诊断功能。撤下的探针实现及测试已保存在本机私有临时目录，仓库保留安全测量证据。

诊断版显式 diagnostics=1 / fast=1 / initial=4096；flash 2,416,391 bytes、RAM 70,860 bytes，编译及烧录校验通过。真实 Audio 事件与独立 probe 分开记录；每条节目最多一次 probe，不下载音频，不发 HTTP/application payload。日志只保留 hostname、IP、Wi-Fi 状态与数值错误。原九组 host 回归和探针测试曾通过，不以 host fake 代替硬件验收。

| 样本 | 真实 Audio 结果 | 失败后的独立 DNS | Gateway/API TCP | Storage TCP 443 | TLS probe |
|---|---|---|---|---|---|
| 首次启动 | fast 成功，首 PCM；之后运行期失败 | 172.64.149.246 | 5/7 ms 成功 | 4002 ms 超时，errno=116 | TCP 失败，未执行 |
| 手动复位后启动 | fast/legacy 均 TCP errno=113 | 104.18.38.10 | 4/5 ms 成功 | 4002 ms 超时，errno=116 | 未执行 |
| 复位后手动换台 | fast/legacy 均 TCP errno=113 | 104.18.38.10 | 3/8 ms 成功 | 4002 ms 超时，errno=116 | 未执行 |

诊断版共 1 次真实成功并输出 PCM、4 次真实连接失败（两条节目各 fast/legacy 双失败）、3 次独立 TCP 超时。用户确认有手动复位，复位前被中断的请求排除，不认作异常重启。运行期失败不算初始连接失败。真实失败在原生 `ssl_client.cpp` TCP SO_ERROR 检查，尚未进入 TLS/HTTP；probe errno=116 是 4 秒 ETIMEDOUT，不能和真实连接的 errno=113 混为一谈。

成败时 Wi-Fi status=3，同一 BSSID `50:4F:3B:CC:FB:4E` / channel 9 / IP `192.168.31.48` / gateway、DNS `192.168.31.1`；RSSI -48 至 -42 dBm，失败时 LAN TCP 正常。独立 DNS 可能使用缓存，其结果不能追溯真实 Audio socket 的 peer IP。

电脑 DNS 为 fake-IP `198.18.2.106`，普通公网路由经 utun8；直接向路由器查 DNS 本次超时。将纯 TCP socket 绑定 en0 / 源 IP `192.168.31.182`，连接两个真实公网 IP:443，各 4 秒均超时。未修改代理、路由或 DNS。该短时对照不足以排除固件因素；此前直接归因网络的结论已撤回。

证据：[诊断版 trace](011c-network-trace.txt)、[电脑网络对照](011c-computer-network.json)、[计数与状态](011c-network-results.json)。

## 关闭探针对照与恢复

保留 fast=1 / initial=4096 / 相同库和 FQBN，仅关闭 diagnostics，编译、烧录校验通过，flash 2,412,535 bytes、RAM 70,332 bytes。首个节目 PCM=3534 ms，但约 130 秒时连续 30 秒播放位置不变，触发原有 stall 保护；flags 为 libraryError=0 / WiFi=3 / ready=1 / samples=1 / running=1。

第一次实体换台仍在 fast、legacy 两次 TCP 建连中返回 SO_ERROR=113，没有 TLS/HTTP/PCM；后续两条实体换台成功。共 3 次真实成功、2 次真实 connect 失败、2 次 playback failure（运行期 stall + 双连接失败）。说明额外探针不能单独解释全部失败。实际库每次 connect 前 stop 普通/secure client，SDK 在该 SO_ERROR 失败分支 close 并置 socket=-1，尚无证据支持此分支漏释放资源。证据：[关闭探针对照](011c-probe-off-trace.txt)。

用户要求先恢复可用版本，故直接烧回保存的 011B / 8192 固件。新恢复采集记录 3 次真实成功起播：MUSIC offset=10529、ALIEN offset=5439、MUSIC offset=14093；首 PCM 3285 / 3189 / 3487 ms，均 TLS=1、Range 206、fast 初始响应 8192 bytes、无 fallback，预取正常。用户明确确认正常。证据：[恢复 trace](011b-restoration-trace.txt)。这不是重新完成长期稳定性验收，也不与先前 10 次成功混算。

板上的保存固件来自 011B 的早期 8192 验收构建；仓库源码保留 `49ec18c` 后期失败释放调台锁修复。本次没有重新烧录该源码，二者不能声称二进制一致。诊断实现未进入正式运行源码，既有 8192 默认窗口和 fast 默认关闭策略保留。

## 七项结论

1. 已观察到初始 TCP 建连失败及独立运行期 stall，两者分开统计；不能统称 TLS 或 seek 失败。
2. 失败后的 probe 返回 172.64.149.246 或 104.18.38.10，真实 Audio peer IP 未被追溯记录。
3. 诊断版 probe 及当时电脑 en0 的短时 TCP 443 测试均超时；关闭 probe 的播放版本仍出现真实 TCP 失败。
4. 成功起播时 TLS 可以建立；失败发生在 TCP，未执行 TLS probe，不证明 handshake 是根因。
5. 未观察到与 AP 切换、Wi-Fi 掉线或 gateway 改变相关的证据，失败时 LAN TCP 正常。
6. 根因未定。011B 保存固件恢复后用户确认可用，但不是严格交错 A/B，不能据此宣称已定位固件或网络根因。
7. 暂缓 011C，保留可用 011B 与安全证据，继续独立开发。以后重新诊断先从可用基线加被动日志，再做受控对照；本次不提交探针，不默认开启 fast。
