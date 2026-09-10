# 宇宙电台

这是 ESP32 仓库内用于验证“第一条节目是否有趣”的最小广播原型；它不修改 `drum/` 或 `drum-web/`。

## 当前阶段

已完成最小数据与音频资源接入，并实现了待 review 的 DeepSeek 稿件生成链路：后台从 `radio_programs` 读取真实节目，可查看详情、上传测试音频、取得私有音频的限时读取地址，并在删除节目时同步删除对应对象。稿件生成仅在用户点击后开始；默认禁用实际 DeepSeek 请求，尚未接入 TTS。

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

开发服务固定绑定 `127.0.0.1`。管理 API 会校验本机 Host、同源 Origin 与 Fetch Metadata；生产环境会拒绝管理 API，直到接入明确的鉴权方案。私有音频通过 15 分钟的服务端签名 URL 试听，播放器请求失败时会重新获取 URL。第三阶段才会接通文本生成和 TTS。

稿件生成配置以 `DEEPSEEK_*` 为准，默认模型为 `deepseek-v4-flash`、官方地址为 `https://api.deepseek.com`。`OPENAI_TEXT_MODEL` 仅作为旧模型名的兼容回退，DeepSeek 密钥不会回退或发送给其他供应商。只有在 review 后将 `DEEPSEEK_ENABLED=true` 并填入 `DEEPSEEK_API_KEY` 时，点击“生成稿件”才会发生实际收费调用。
