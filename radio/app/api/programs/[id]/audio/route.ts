import { assertLocalDevelopmentRequest } from "../../../../../lib/supabase-server";
import { uploadProgramAudio } from "../../../../../program/service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    assertLocalDevelopmentRequest(request);
    const audio = (await request.formData()).get("audio");
    if (!(audio instanceof File))
      return Response.json({ error: "audio 必须是文件。" }, { status: 400 });
    const program = await uploadProgramAudio((await params).id, audio);
    return program
      ? Response.json({ program })
      : Response.json({ error: "节目不存在。" }, { status: 404 });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "无法上传音频。",
      },
      { status: 400 },
    );
  }
}
