import {
  assertLocalDevelopmentRequest,
  getRequestErrorStatus,
  readJsonBody,
} from "../../../../../lib/supabase-server";
import {
  createProceduralMusicRecipe,
  parseProceduralMusicRequest,
} from "../../../../../music/recipe";
import { synthesizeProceduralMusic } from "../../../../../music/synth";
import { createProceduralMusicProgram } from "../../../../../program/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertLocalDevelopmentRequest(request);
    const style = parseProceduralMusicRequest(await readJsonBody(request));
    const recipe = createProceduralMusicRecipe(style, crypto.randomUUID());
    const asset = synthesizeProceduralMusic(recipe);
    return Response.json(
      { ...(await createProceduralMusicProgram(recipe, asset)) },
      { status: 201 },
    );
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "无法生成音乐节目。",
      },
      { status: getRequestErrorStatus(error, 400) },
    );
  }
}
