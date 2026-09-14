import {
  assertDeviceRequest,
  getDeviceRequestErrorStatus,
} from "../../../../../lib/device-api";
import { readJsonBody } from "../../../../../lib/supabase-server";
import { parseTuneRequest } from "../../../../../receiver/manifest";
import { createReceiverTuneResult } from "../../../../../receiver/manifest-builder";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertDeviceRequest(request);
    const { excludeProgramIds } = parseTuneRequest(await readJsonBody(request));
    return Response.json(await createReceiverTuneResult(excludeProgramIds), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "设备无法调台。" },
      { status: getDeviceRequestErrorStatus(error, 400) },
    );
  }
}
