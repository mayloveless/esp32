import {
  assertLocalDevelopmentRequest,
  getRequestErrorStatus,
  readJsonBody,
} from "../../../../lib/supabase-server";
import {
  parseTuneRequest,
} from "../../../../receiver/manifest";
import { createReceiverTuneResult } from "../../../../receiver/manifest-builder";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertLocalDevelopmentRequest(request);
    const { excludeProgramIds } = parseTuneRequest(await readJsonBody(request));
    return Response.json(await createReceiverTuneResult(excludeProgramIds));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "无法调台。" },
      { status: getRequestErrorStatus(error, 400) },
    );
  }
}
