import {
  assertLocalDevelopmentRequest,
  getRequestErrorStatus,
  readJsonBody,
} from "../../../../lib/supabase-server";
import { parseInventoryBatchRequest } from "../../../../program/inventory-batch";
import {
  deleteProgram,
  restoreProgram,
  retireProgram,
} from "../../../../program/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertLocalDevelopmentRequest(request);
    const { action, programIds } = parseInventoryBatchRequest(
      await readJsonBody(request),
    );
    const results = await Promise.all(
      programIds.map(async (id) => {
        try {
          if (action === "delete") {
            const { cleanupWarning, deleted } = await deleteProgram(id);
            if (!deleted) throw new Error("节目不存在。");
            return { cleanupWarning, id, success: true as const };
          }
          if (action === "retire") {
            const result = await retireProgram(id);
            if (!result.program) throw new Error("节目不存在。");
            return { id, program: result.program, success: true as const };
          }
          const program = await restoreProgram(id);
          if (!program) throw new Error("节目不存在。");
          return { id, program, success: true as const };
        } catch (error) {
          return {
            error:
              error instanceof Error
                ? error.message
                : action === "delete"
                  ? "无法删除节目。"
                  : "无法更新节目播出状态。",
            id,
            success: false as const,
          };
        }
      }),
    );
    return Response.json({ action, results });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "无法批量处理节目。",
      },
      { status: getRequestErrorStatus(error, 400) },
    );
  }
}
