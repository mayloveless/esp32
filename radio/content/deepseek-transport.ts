import type { GenerateScriptInput } from "../program/validation";
import { ScriptGenerationError } from "./script-validation.ts";

const maximumOutputCharacters = 6_000;
const requestTimeoutMs = 20_000;

export type DeepSeekRequest = {
  apiKey: string;
  baseUrl: string;
  model: string;
  input: GenerateScriptInput;
};

export type FetchImplementation = typeof fetch;

function buildMessages(input: GenerateScriptInput) {
  const topicInstruction = input.topic
    ? `本期主题是：${input.topic}`
    : "主题留空，请自行选择一个有趣、具体、可理解的宇宙主题。";
  const formatInstruction =
    input.format === "news"
      ? "新闻可以使用 1 到 12 个 segments；单段新闻也必须有具体虚构事件、背景与细节，不能冒充现实新闻。"
      : "聊天必须使用 2 到 12 个 segments，且至少有两位不同说话者，以对话推进一个具体话题。";
  return [
    {
      role: "system",
      content:
        "你是宇宙电台的中文脚本编辑。所有内容必须明确为虚构，且不能把编造内容包装成真实新闻。仅输出一个 JSON 对象，不要 Markdown。JSON 基础结构：{\"title\":\"标题\",\"format\":\"news 或 chat\",\"language\":\"中文\",\"fictional\":true,\"segments\":[{\"speaker\":\"播音员\",\"text\":\"正文\"}],\"sources\":[]}。news 可有 1 到 12 个 segments，单段示例为 [{\"speaker\":\"播音员\",\"text\":\"一整段新闻正文\"}]。chat 必须有 2 到 12 个 segments，且至少两位不同 speaker，例如 [{\"speaker\":\"星港主持人\",\"text\":\"提问\"},{\"speaker\":\"观测员\",\"text\":\"回应\"}]。没有真实检索来源时 sources 必须为 []。",
    },
    {
      role: "user",
      content: `${topicInstruction}\n节目形式：${input.format}\n语言：${input.language}\n风格：${input.style}\n${formatInstruction}\n正文约 30 到 90 秒，避免套话和无意义随机名词。`,
    },
  ];
}

function providerMessage(status: number) {
  return status >= 500
    ? "DeepSeek 服务暂时不可用。"
    : "DeepSeek 拒绝了本次稿件请求。";
}

export async function requestDeepSeekScript(
  request: DeepSeekRequest,
  fetchImplementation: FetchImplementation = fetch,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetchImplementation(`${request.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        messages: buildMessages(request.input),
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
        max_tokens: 900,
        temperature: 0.8,
      }),
      signal: controller.signal,
    });
    if (!response.ok)
      throw new ScriptGenerationError(providerMessage(response.status), "provider");
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length > maximumOutputCharacters)
      throw new ScriptGenerationError("DeepSeek 返回的稿件为空或超过长度限制。", "output");
    return content;
  } catch (error) {
    if (error instanceof ScriptGenerationError) throw error;
    if (error instanceof Error && error.name === "AbortError")
      throw new ScriptGenerationError("DeepSeek 请求超时。", "timeout");
    throw new ScriptGenerationError("无法连接 DeepSeek 服务。", "provider");
  } finally {
    clearTimeout(timeout);
  }
}
