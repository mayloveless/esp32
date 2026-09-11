import assert from "node:assert/strict";
import test from "node:test";
import {
  requestDeepSeekScript,
  type DeepSeekRequest,
} from "./deepseek-transport.ts";
import { ScriptGenerationError } from "./script-validation.ts";

const request: DeepSeekRequest = {
  apiKey: "test-key",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  input: {
    format: "news",
    language: "中文",
    style: "冷静",
    topic: null,
  },
};

test("供应商错误不会被伪装成生成成功", async () => {
  await assert.rejects(
    requestDeepSeekScript(request, async () => new Response("", { status: 503 })),
    (error: unknown) =>
      error instanceof ScriptGenerationError && error.kind === "provider",
  );
});

test("超时会返回可诊断错误", async () => {
  await assert.rejects(
    requestDeepSeekScript(request, async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }),
    (error: unknown) =>
      error instanceof ScriptGenerationError && error.kind === "timeout",
  );
});

test("提示词要求正文仅包含可直接朗读的内容", async () => {
  let body: unknown;
  await requestDeepSeekScript(request, async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ message: { content: "{}" } }] });
  });
  const messages = (body as { messages: Array<{ content: string }> }).messages;
  assert.match(messages[0].content, /不要使用圆括号、方括号/);
  assert.match(messages[0].content, /可直接朗读/);
});
