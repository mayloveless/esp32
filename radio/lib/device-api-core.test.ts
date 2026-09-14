import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDeviceRequestWithToken,
  DeviceRequestGuardError,
} from "./device-api-core.ts";

const token = "device-test-token";

function deviceRequest(authorization?: string, origin?: string) {
  return new Request("http://192.168.1.20:3000/api/device/receiver/tune", {
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    method: "POST",
  });
}

test("未配置设备 token 时拒绝请求", () => {
  assert.throws(
    () => assertDeviceRequestWithToken(deviceRequest(`Bearer ${token}`), undefined),
    DeviceRequestGuardError,
  );
});

test("设备请求必须携带正确的 Bearer token", () => {
  assert.throws(
    () => assertDeviceRequestWithToken(deviceRequest(), token),
    DeviceRequestGuardError,
  );
  assert.throws(
    () => assertDeviceRequestWithToken(deviceRequest("Bearer incorrect"), token),
    DeviceRequestGuardError,
  );
  assert.doesNotThrow(() =>
    assertDeviceRequestWithToken(deviceRequest(`Bearer ${token}`), token),
  );
});

test("设备 guard 不依赖浏览器 Origin", () => {
  assert.doesNotThrow(() =>
    assertDeviceRequestWithToken(
      deviceRequest(`Bearer ${token}`, "http://untrusted-browser.example"),
      token,
    ),
  );
});
