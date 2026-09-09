import { assertLocalDevelopmentRequest } from "../../../lib/supabase-server";
import { createProgram, listPrograms } from "../../../program/service";
import { parseCreateProgram } from "../../../program/validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try { assertLocalDevelopmentRequest(request); return Response.json({ programs: await listPrograms() }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to list programs." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try { assertLocalDevelopmentRequest(request); return Response.json({ program: await createProgram(parseCreateProgram(await request.json())) }, { status: 201 }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to create program." }, { status: 400 }); }
}
