import { assertLocalDevelopmentRequest } from "../../../../../lib/supabase-server";
import { uploadProgramAudio } from "../../../../../program/service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    assertLocalDevelopmentRequest(request);
    const audio = (await request.formData()).get("audio");
    if (!(audio instanceof File)) return Response.json({ error: "audio must be a file." }, { status: 400 });
    const program = await uploadProgramAudio((await params).id, audio);
    return program ? Response.json({ program }) : Response.json({ error: "Program not found." }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to upload audio." }, { status: 400 });
  }
}
