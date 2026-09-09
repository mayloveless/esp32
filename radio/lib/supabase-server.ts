import "server-only";
import { createClient } from "@supabase/supabase-js";

const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

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
    throw new Error("生产部署前必须为电台管理接口接入鉴权。");
  if (!localHosts.has(new URL(request.url).hostname))
    throw new Error("电台管理仅允许从本机开发主机访问。");
}
