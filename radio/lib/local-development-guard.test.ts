import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLocalDevelopmentRequest,
  RequestGuardError,
} from "./local-development-guard.ts";

function managementRequest(host: string, origin = `http://${host}`) {
  return new Request(`http://${host}/api/programs`, {
    headers: {
      Host: host,
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
    },
    method: "POST",
  });
}

test("管理 API 仍只接受 localhost 同源写请求", () => {
  assert.doesNotThrow(() => assertLocalDevelopmentRequest(managementRequest("127.0.0.1:3000")));
  assert.throws(
    () => assertLocalDevelopmentRequest(managementRequest("192.168.1.20:3000")),
    RequestGuardError,
  );
  assert.throws(
    () =>
      assertLocalDevelopmentRequest(
        managementRequest("127.0.0.1:3000", "http://untrusted-browser.example"),
      ),
    RequestGuardError,
  );
});
