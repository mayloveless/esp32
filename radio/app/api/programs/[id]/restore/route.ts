import {
  assertLocalDevelopmentRequest,
  getRequestErrorStatus,
} from "../../../../../lib/supabase-server";
import { restoreProgram } from "../../../../../program/service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    assertLocalDevelopmentRequest(request);
    const program = await restoreProgram((await params).id);
    return program
      ? Response.json({ program })
      : Response.json({ error: "节目不存在。" }, { status: 404 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "无法恢复节目。" },
      { status: getRequestErrorStatus(error, 400) },
    );
  }
}
