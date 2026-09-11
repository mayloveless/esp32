import {
  assertLocalDevelopmentRequest,
  getRequestErrorStatus,
} from "../../../../lib/supabase-server";
import { parseManualMusicUpload } from "../../../../program/music-upload";
import { createManualMusicProgram } from "../../../../program/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertLocalDevelopmentRequest(request);
    const input = await parseManualMusicUpload(await request.formData());
    return Response.json(
      { ...(await createManualMusicProgram(input)) },
      { status: 201 },
    );
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "无法创建音乐节目。",
      },
      { status: getRequestErrorStatus(error, 400) },
    );
  }
}
