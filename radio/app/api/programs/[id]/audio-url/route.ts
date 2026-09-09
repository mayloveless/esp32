import { assertLocalDevelopmentRequest } from "../../../../../lib/supabase-server";
import { createProgramAudioUrl, getProgram } from "../../../../../program/service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    assertLocalDevelopmentRequest(request);
    const program = await getProgram((await params).id);
    if (!program) return Response.json({ error: "Program not found." }, { status: 404 });
    return Response.json({ signedUrl: await createProgramAudioUrl(program) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create audio URL." }, { status: 500 });
  }
}
