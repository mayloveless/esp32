# Task 011C — ESP32 音频 TLS 连接失败诊断

> 状态（2026-10-07）：**暂缓，可跳过继续独立功能开发，未通过验收**。用户要求恢复可用版本，并确认已烧回的 011B / 8192 固件正常。011C 探针实现已从当前运行源码移除，保留诊断与恢复证据；后续功能从 011B 源码基线继续。
>
> 跳过不代表连接失败的根因已修复，也不满足 fast 默认启用的稳定性条件。继续保留 `RADIO_FAST_WAV_START=0` 默认；若后续任务明确依赖稳定连续播放或默认启用 fast，再单独处理该阻塞。当前仓库及远端任务没有明确依赖 011C 的后续任务。
>
> 记录：[011C 诊断与暂缓结论](../../../radio-device/diagnostics/011c-network-diagnostics.md)。以下为原任务要求，保留供将来重启诊断使用。

## 目标

011B 已证明 WAV fast path 本身可工作，但当前无法正式默认启用，因为 ESP32 偶发在音频 HTTPS 连接阶段直接失败：

ssl_client.cpp / TCP SO_ERROR
errno=113
Software caused connection abort

失败发生在 TLS / HTTP 之前。

本任务只定位 ESP32 → 音频 Storage host 的网络/TCP/TLS 路径稳定性。

当前基线：49ec18c0579534541f8355e0efa565b49d39aa20

不要继续修改 WAV fast path、Range、字幕或播放器架构。

## 1. 保持当前默认行为

继续保持 RADIO_FAST_WAV_START=0。
诊断时可显式编译 fast=1，但不要提交默认开启。

## 2. 只记录安全网络信息

在 audio connect 失败时，允许记录：Wi-Fi status、RSSI、channel、BSSID、gateway IP、DNS server IP、音频 URL 的 hostname、hostname 的 DNS 解析结果、TCP 443 connect 成功/失败及耗时、TLS connect 成功/失败阶段、errno / ESP-IDF error code。

禁止记录 signed URL path/query、token、DEVICE_API_TOKEN、Wi-Fi 密码。

## 3. 独立 probe

增加一个只在诊断构建启用的轻量 probe，例如 RADIO_NETWORK_DIAGNOSTICS。

当真实 audio connect 失败时，对同一个 Storage hostname 做一次独立诊断：
1. DNS resolve；
2. 记录得到的 IPv4；
3. 对解析 IP:443 做纯 TCP connect；
4. 如果 TCP 成功，再做最小 TLS connect；
5. 立即关闭。

不要 GET 音频内容，不要循环自动重试，每次节目最多触发一次 probe。

## 4. 对比 Wi-Fi 本身是否正常

失败时同时验证：ESP32 仍然 WL_CONNECTED、gateway 是否仍可达、Device API 所在局域网目标是否仍可建立 TCP、DNS 是否还能正常返回。

目标是区分：A Wi-Fi/AP 本身掉线；B 网关/局域网异常；C DNS 解析异常；D Storage 公网 IP TCP 不可达；E TCP 可达但 TLS handshake 失败。

不要因为某次失败主动切 AP 或重启设备。

## 5. DNS 对比

同一个 Storage hostname 连续失败时，记录 ESP32 实际解析出的 IPv4。

电脑可能经 VPN / fake-IP 路径访问互联网，电脑能打开不代表 ESP32 直连路径正常。不要拿电脑请求成功直接判定 Storage 正常。

## 6. 最小恢复策略

本任务主要是诊断，不做复杂网络恢复。

保留当前：fast 失败 → legacy fallback；legacy 失败 → failPlayback；用户重新转旋钮 → 再选台。

不得增加无限重试、自动换台、自动重启、服务端音频代理、VPN/proxy、自定义 DNS、自动切换热点。

## 7. 真机采集

至少收集 5 次成功音频连接；如果能复现，至少 2 次失败连接。

对每次失败分类为 DNS / TCP / TLS / HTTP。

如果连续 10 次都无法复现失败，也要记录成功数据和网络环境，不要制造故障。

## 8. 结论

最终只回答：
1. ESP32 失败发生在哪一层；
2. 失败时 DNS 得到什么 IP；
3. TCP 443 是否可达；
4. TLS 是否能建立；
5. 是否与 Wi-Fi/BSSID/gateway 状态相关；
6. 最可能的根因；
7. 下一步最小修复方案。

如果证据指向当前网络环境 / 路由器直连公网不稳定，停止，不要擅自实现代理。

如果证据明确指向代码中的 socket/TLS 生命周期问题，再提出最小代码修复，但先不要扩大改动。

完成后暂停。
