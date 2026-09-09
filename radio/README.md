# 宇宙电台

这是 ESP32 仓库内用于验证“第一条节目是否有趣”的最小广播原型；它不修改 `drum/` 或 `drum-web/`。

## 当前阶段

目前只完成项目初始化与空状态实验台：可选择新闻或聊天、填写语言和风格，并看到内容预览、播放器和节目列表。没有调用 AI、TTS 或 Supabase，也没有伪造节目或音频。

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

第二阶段才会接入既有 Supabase 项目与迁移；第三阶段才会接通文本生成和 TTS。
