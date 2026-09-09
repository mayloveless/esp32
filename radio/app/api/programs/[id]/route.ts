import { assertLocalDevelopmentRequest } from "../../../../lib/supabase-server";
import { deleteProgram, getProgram, updateProgram } from "../../../../program/service";
import { parseUpdateProgram } from "../../../../program/validation";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try { assertLocalDevelopmentRequest(request); const program = await getProgram((await params).id); return program ? Response.json({ program }) : Response.json({ error: "Program not found." }, { status: 404 }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to read program." }, { status: 500 }); }
}

export async function PATCH(request: Request, { params }: Context) {
  try { assertLocalDevelopmentRequest(request); const program = await updateProgram((await params).id, parseUpdateProgram(await request.json())); return program ? Response.json({ program }) : Response.json({ error: "Program not found." }, { status: 404 }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to update program." }, { status: 400 }); }
}

export async function DELETE(request: Request, { params }: Context) {
  try { assertLocalDevelopmentRequest(request); return (await deleteProgram((await params).id)) ? new Response(null, { status: 204 }) : Response.json({ error: "Program not found." }, { status: 404 }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to delete program." }, { status: 500 }); }
}
