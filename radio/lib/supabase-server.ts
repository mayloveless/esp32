import "server-only";
import { createClient } from "@supabase/supabase-js";
import {
  assertLocalDevelopmentRequest,
  RequestGuardError,
} from "./local-development-guard.ts";

export { assertLocalDevelopmentRequest, RequestGuardError };

export function getSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("未配置 Supabase 服务端凭据。");
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function getRequestErrorStatus(error: unknown, fallback: number) {
  return error instanceof RequestGuardError ? error.status : fallback;
}

export async function readJsonBody(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new RequestGuardError("请求必须使用 application/json。", 400);
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 32 * 1024) {
    throw new RequestGuardError("请求体不能超过 32 KB。", 400);
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new RequestGuardError("请求 JSON 无效。", 400);
  }
}
