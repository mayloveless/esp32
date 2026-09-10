import {
  assertLocalDevelopmentRequest,
  getRequestErrorStatus,
} from "../../../../../lib/supabase-server";
import { uploadProgramAudio } from "../../../../../program/service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    assertLocalDevelopmentRequest(request);
    const audio = (await request.formData()).get("audio");
    if (!(audio instanceof File))
      return Response.json({ error: "audio 必须是文件。" }, { status: 400 });
    const result = await uploadProgramAudio((await params).id, audio);
    return result
      ? Response.json(result)
      : Response.json({ error: "节目不存在。" }, { status: 404 });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "无法上传音频。",
      },
      { status: getRequestErrorStatus(error, 400) },
    );
  }
}
