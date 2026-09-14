import { timingSafeEqual } from "node:crypto";

export class DeviceRequestGuardError extends Error {
  readonly status = 403;
}

function tokensMatch(expected: string, received: string) {
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return (
    expectedBytes.byteLength === receivedBytes.byteLength &&
    timingSafeEqual(expectedBytes, receivedBytes)
  );
}

/** 设备接口仅验证显式 Bearer token，不依赖浏览器请求头。 */
export function assertDeviceRequestWithToken(
  request: Request,
  deviceApiToken: string | undefined,
) {
  if (!deviceApiToken)
    throw new DeviceRequestGuardError("未配置 DEVICE_API_TOKEN，已拒绝设备请求。");

  const authorization = request.headers.get("authorization");
  const prefix = "Bearer ";
  if (!authorization?.startsWith(prefix))
    throw new DeviceRequestGuardError("设备请求必须使用 Bearer token。");
  if (!tokensMatch(deviceApiToken, authorization.slice(prefix.length)))
    throw new DeviceRequestGuardError("设备访问 token 无效。");
}

export function getDeviceRequestErrorStatus(error: unknown, fallback: number) {
  return error instanceof DeviceRequestGuardError ? error.status : fallback;
}
