import {
  assertLocalDevelopmentRequest,
  getRequestErrorStatus,
  readJsonBody,
} from "../../../../lib/supabase-server";
import {
  deleteProgram,
  getProgram,
  updateProgram,
} from "../../../../program/service";
import { parseUpdateProgram } from "../../../../program/validation";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    assertLocalDevelopmentRequest(request);
    const program = await getProgram((await params).id);
    return program
      ? Response.json({ program })
      : Response.json({ error: "节目不存在。" }, { status: 404 });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "无法读取节目详情。",
      },
      { status: getRequestErrorStatus(error, 500) },
    );
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    assertLocalDevelopmentRequest(request);
    const program = await updateProgram(
      (await params).id,
      parseUpdateProgram(await readJsonBody(request)),
    );
    return program
      ? Response.json({ program })
      : Response.json({ error: "节目不存在。" }, { status: 404 });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "无法更新节目。",
      },
      { status: getRequestErrorStatus(error, 400) },
    );
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    assertLocalDevelopmentRequest(request);
    const result = await deleteProgram((await params).id);
    return result.deleted
      ? Response.json({ cleanupWarning: result.cleanupWarning })
      : Response.json({ error: "节目不存在。" }, { status: 404 });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "无法删除节目。",
      },
      { status: getRequestErrorStatus(error, 500) },
    );
  }
}
