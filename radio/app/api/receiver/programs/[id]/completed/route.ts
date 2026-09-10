import {
  assertLocalDevelopmentRequest,
  getRequestErrorStatus,
} from "../../../../../../lib/supabase-server";
import { retireProgram } from "../../../../../../program/service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    assertLocalDevelopmentRequest(request);
    const result = await retireProgram((await params).id);
    if (!result.program)
      return Response.json({ error: "节目不存在。" }, { status: 404 });
    return Response.json({
      completed: true,
      retired: result.changed,
      program: result.program,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "无法完成节目下线。" },
      { status: getRequestErrorStatus(error, 400) },
    );
  }
}
