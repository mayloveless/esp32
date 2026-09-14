import "server-only";
import { assertDeviceRequestWithToken } from "./device-api-core.ts";

export {
  DeviceRequestGuardError,
  getDeviceRequestErrorStatus,
} from "./device-api-core.ts";

/** 设备接口仅验证显式 Bearer token，不依赖浏览器请求头。 */
export function assertDeviceRequest(request: Request) {
  assertDeviceRequestWithToken(request, process.env.DEVICE_API_TOKEN);
}
