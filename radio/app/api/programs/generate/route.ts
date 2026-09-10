import {
  assertLocalDevelopmentRequest,
  getRequestErrorStatus,
  readJsonBody,
} from "../../../../lib/supabase-server";
import {
  generateBroadcastScript,
  getDeepSeekSettings,
  ScriptGenerationError,
} from "../../../../content/script";
import {
  GenerationInProgressError,
  withGenerationLock,
} from "../../../../content/generation-lock";
import {
  createGeneratingProgram,
  updateProgram,
} from "../../../../program/service";
import { parseGenerateScript } from "../../../../program/validation";

export const runtime = "nodejs";

function errorStatus(error: unknown) {
  if (error instanceof GenerationInProgressError) return 409;
  if (error instanceof ScriptGenerationError) return 503;
  return getRequestErrorStatus(error, 400);
}

export async function POST(request: Request) {
  try {
    assertLocalDevelopmentRequest(request);
    const input = parseGenerateScript(await readJsonBody(request));
    return await withGenerationLock(async () => {
      const settings = getDeepSeekSettings();
      const created = await createGeneratingProgram({
        ...input,
        model: settings.model,
      });
      try {
        const { script, model } = await generateBroadcastScript(input);
        const program = await updateProgram(created.id, {
          status: "queued",
          title: script.title,
          content: script,
          recipe: { ...created.recipe, text_model: model },
          error: null,
        });
        return Response.json({ program });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "稿件生成发生未知错误。";
        const program = await updateProgram(created.id, {
          status: "failed",
          error: message,
        });
        return Response.json(
          { error: message, program },
          { status: errorStatus(error) },
        );
      }
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "无法开始稿件生成。",
      },
      { status: errorStatus(error) },
    );
  }
}
