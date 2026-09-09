import "server-only";
import { createClient } from "@supabase/supabase-js";

const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

export function getSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Supabase server credentials are not configured.");
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function assertLocalDevelopmentRequest(request: Request) {
  if (process.env.NODE_ENV === "production") throw new Error("Radio management routes require production authentication before deployment.");
  if (!localHosts.has(new URL(request.url).hostname)) throw new Error("Radio management is available only from the local development host.");
}
