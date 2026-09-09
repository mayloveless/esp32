import { assertLocalDevelopmentRequest } from "../../../../../lib/supabase-server";
import {
  createProgramAudioUrl,
  getProgram,
} from "../../../../../program/service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    assertLocalDevelopmentRequest(request);
    const program = await getProgram((await params).id);
    if (!program)
      return Response.json({ error: "节目不存在。" }, { status: 404 });
    return Response.json({ signedUrl: await createProgramAudioUrl(program) });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "无法创建音频试听地址。",
      },
      { status: 500 },
    );
  }
}
