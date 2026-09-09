# 宇宙电台

这是 ESP32 仓库内用于验证“第一条节目是否有趣”的最小广播原型；它不修改 `drum/` 或 `drum-web/`。

## 当前阶段

已完成最小数据与音频资源接入：后台从 `radio_programs` 读取真实节目，可查看详情、上传测试音频、取得私有音频的限时读取地址，并在删除节目时同步删除对应对象。生成按钮仍处于禁用状态，不会调用 AI 或 TTS。

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

管理 API 仅接受本机开发主机请求；生产部署前会拒绝所有管理 API，直到接入明确的鉴权方案。第三阶段才会接通文本生成和 TTS。
