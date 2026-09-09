import { assertLocalDevelopmentRequest } from "../../../../lib/supabase-server";
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
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    assertLocalDevelopmentRequest(request);
    const program = await updateProgram(
      (await params).id,
      parseUpdateProgram(await request.json()),
    );
    return program
      ? Response.json({ program })
      : Response.json({ error: "节目不存在。" }, { status: 404 });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "无法更新节目。",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    assertLocalDevelopmentRequest(request);
    return (await deleteProgram((await params).id))
      ? new Response(null, { status: 204 })
      : Response.json({ error: "节目不存在。" }, { status: 404 });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "无法删除节目。",
      },
      { status: 500 },
    );
  }
}
