import "server-only";
import { createClient } from "@supabase/supabase-js";

const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const writeMethods = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export class RequestGuardError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403,
  ) {
    super(message);
  }
}

export function getSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("未配置 Supabase 服务端凭据。");
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function assertLocalDevelopmentRequest(request: Request) {
  if (process.env.NODE_ENV === "production")
    throw new RequestGuardError("生产部署前必须为电台管理接口接入鉴权。", 403);

  const host = request.headers.get("host");
  if (!host) {
    throw new RequestGuardError("缺少请求 Host。", 403);
  }
  let hostUrl: URL;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    throw new RequestGuardError("请求 Host 无效。", 403);
  }
  if (!localHosts.has(hostUrl.hostname)) {
    throw new RequestGuardError("电台管理仅允许从本机开发主机访问。", 403);
  }

  const origin = request.headers.get("origin");
  const expectedOrigin = hostUrl.origin;
  if (origin && origin !== expectedOrigin) {
    throw new RequestGuardError("管理请求必须与本机页面同源。", 403);
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new RequestGuardError("拒绝跨站管理请求。", 403);
  }
  if (writeMethods.has(request.method) && origin !== expectedOrigin) {
    throw new RequestGuardError("写入请求必须包含本机同源 Origin。", 403);
  }
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
