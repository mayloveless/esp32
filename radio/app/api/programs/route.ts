import {
  assertLocalDevelopmentRequest,
  getRequestErrorStatus,
  readJsonBody,
} from "../../../lib/supabase-server";
import { createProgram, listPrograms } from "../../../program/service";
import { parseCreateProgram } from "../../../program/validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    assertLocalDevelopmentRequest(request);
    return Response.json({ programs: await listPrograms() });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "无法读取节目列表。",
      },
      { status: getRequestErrorStatus(error, 500) },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertLocalDevelopmentRequest(request);
    return Response.json(
      {
        program: await createProgram(
          parseCreateProgram(await readJsonBody(request)),
        ),
      },
      { status: 201 },
    );
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "无法创建节目。",
      },
      { status: getRequestErrorStatus(error, 400) },
    );
  }
}
