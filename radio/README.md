# 宇宙电台

这是 ESP32 仓库内用于验证“第一条节目是否有趣”的最小广播原型；它不修改 `drum/` 或 `drum-web/`。

## 当前阶段

已完成最小数据与音频资源接入，并实现了待 review 的 DeepSeek 稿件与硅基流动 TTS 链路：后台从 `radio_programs` 读取真实节目，可查看详情、上传测试音频、取得私有音频的限时读取地址，并在删除节目时同步删除对应对象。稿件和语音生成均只会由用户点击触发，默认禁用实际供应商请求。

## 本地运行

```bash
cd radio
pnpm install
pnpm dev
```

检查命令：

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## 环境变量

复制 `.env.example` 为 `.env.local` 后，只在本机填写服务端凭据。`SUPABASE_SERVICE_ROLE_KEY` 和任何 AI 密钥绝不能使用 `NEXT_PUBLIC_` 前缀或提交到 Git。

开发服务固定绑定 `127.0.0.1`。管理 API 会校验本机 Host、同源 Origin 与 Fetch Metadata；生产环境会拒绝管理 API，直到接入明确的鉴权方案。私有音频通过 15 分钟的服务端签名 URL 试听，播放器请求失败时会重新获取 URL。

需要让同一可信局域网中的设备调台时，显式运行 `pnpm dev:device`。设备只能调用 `/api/device/receiver/*`，并且必须在 `Authorization: Bearer <DEVICE_API_TOKEN>` 中提供本机配置的 token；管理接口仍只允许从 `127.0.0.1` 访问，设备也不会获得 Supabase 服务端凭据。

稿件生成配置以 `DEEPSEEK_*` 为准，默认模型为 `deepseek-v4-flash`、官方地址为 `https://api.deepseek.com`。`OPENAI_TEXT_MODEL` 仅作为旧模型名的兼容回退，DeepSeek 密钥不会回退或发送给其他供应商。只有在 review 后将 `DEEPSEEK_ENABLED=true` 并填入 `DEEPSEEK_API_KEY` 时，点击“生成稿件”才会发生实际收费调用。

语音合成当前只支持 `TTS_PROVIDER=siliconflow`、`FunAudioLLM/CosyVoice2-0.5B` 与内置中文音色。`TTS_VOICE_PRIMARY` 与 `TTS_VOICE_SECONDARY` 必须配置为不同的 CosyVoice2 内置音色；聊天节目会按说话者稳定分配两种音色。多段节目会以 WAV 32kHz 合并后写入私有 `radio-audio` bucket，并保存实际时长、字幕和音色映射；单段兼容路径仍支持 MP3。只有在 review 后将 `TTS_ENABLED=true` 并填入 `TTS_API_KEY` 时，点击“合成语音”才会发生实际收费调用；失败会保留已保存稿件以便再次合成，不会重新生成文本。

### 可选的本机设备音频缓存

若 ESP32 直连云端取流持续不足，可在开发机选择 `RADIO_DEVICE_AUDIO_TRANSPORT=local-cache`，并设置 `RADIO_DEVICE_AUDIO_ORIGIN=http://开发机局域网IP:3000`。默认仍为 `cloud`。只有设备 tune 会使用这一模式，浏览器 Receiver、Renderer 输出格式和节目库存不变。

开发机先完整读取已有音频，再给设备签发 `/api/device/audio/<文件名>` 的 15 分钟 HMAC 地址。该地址不包含 Device API 或 Supabase 密钥；未签名、签名错误或过期请求拒绝。响应保持原 WAV/MP3 字节、Content-Length 和 206 Content-Range，支持有限初始 Range 及后续 seek。cache 按源 object 路径版本区分，最大 64MiB、单条 32MiB，最多两个并行读取，pending 去重和 LRU 淘汰；不上传副本或修改 DB。仍只适用于已有 HTTP Device API 的可信局域网开发环境。

首次读取会增加等待，后台 manifest 预取会同时准备下一条音频。缓存只驻留开发机内存，服务重启/淘汰后旧地址可能返回 404；重新实体调台会得到新地址。开发机需保持服务运行。关闭该模式恢复云端 URL，不需要修改设备 token、I2S 或 Renderer。本机真机对照中用户确认原有断续感消失，仍有偶发爆音待定位；相关串口记录及验证限制见 [连续播放诊断](../radio-device/diagnostics/playback-flow.md)。
