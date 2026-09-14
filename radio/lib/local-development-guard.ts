const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const writeMethods = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export class RequestGuardError extends Error {
  readonly status: 400 | 403;

  constructor(message: string, status: 400 | 403) {
    super(message);
    this.status = status;
  }
}

/** 保持管理接口仅限本机开发时访问，不用于设备接口。 */
export function assertLocalDevelopmentRequest(request: Request) {
  if (process.env.NODE_ENV === "production")
    throw new RequestGuardError("生产部署前必须为电台管理接口接入鉴权。", 403);

  const host = request.headers.get("host");
  if (!host) throw new RequestGuardError("缺少请求 Host。", 403);

  let hostUrl: URL;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    throw new RequestGuardError("请求 Host 无效。", 403);
  }
  if (!localHosts.has(hostUrl.hostname))
    throw new RequestGuardError("电台管理仅允许从本机开发主机访问。", 403);

  const origin = request.headers.get("origin");
  const expectedOrigin = hostUrl.origin;
  if (origin && origin !== expectedOrigin)
    throw new RequestGuardError("管理请求必须与本机页面同源。", 403);

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")
    throw new RequestGuardError("拒绝跨站管理请求。", 403);
  if (writeMethods.has(request.method) && origin !== expectedOrigin)
    throw new RequestGuardError("写入请求必须包含本机同源 Origin。", 403);
}
