import assert from "node:assert/strict";
import { test } from "node:test";
import { DeviceAudioCache, parseDeviceAudioRange, signDeviceAudioUrl, verifyDeviceAudioUrl } from "./device-audio-core.ts";
const filename = "3ad72e1d-f9fa-43d5-bf48-efb17dfb2151.0123456789abcdef.wav";
const key = "test-only-secret", now = 1_700_000_000_000;

test("audio URL binds the exact object, expiry and signing key", () => {
  const url = new URL(signDeviceAudioUrl("http://192.168.31.182:3000", filename, key, now).signedUrl);
  assert(verifyDeviceAudioUrl(filename, url, key, now));
  assert(!verifyDeviceAudioUrl(filename, url, "wrong", now));
  assert(!verifyDeviceAudioUrl(filename.replace("0123", "4567"), url, key, now));
  assert(!verifyDeviceAudioUrl(filename, url, key, now + 900_000));
  assert(!verifyDeviceAudioUrl(filename, url, key, now - 1_000));
  url.searchParams.append("expires", url.searchParams.get("expires")!);
  assert(!verifyDeviceAudioUrl(filename, url, key, now));
  assert.throws(() => signDeviceAudioUrl("http://user:pass@localhost", filename, key, now));
  assert.throws(() => signDeviceAudioUrl("http://localhost", "../private.wav", key, now));
});

test("finite initial and seek Range have exact bounds", () => {
  const size = 6_627_412;
  assert.deepEqual(parseDeviceAudioRange("bytes=0-8191", size), { start: 0, end: 8191, partial: true });
  assert.deepEqual(parseDeviceAudioRange("bytes=576044-", size), { start: 576044, end: size-1, partial: true });
  assert.deepEqual(parseDeviceAudioRange("bytes=-128", size), { start: size-128, end: size-1, partial: true });
  assert.deepEqual(parseDeviceAudioRange(null, size), { start: 0, end: size-1, partial: false });
  for (const bad of ["bytes=6627412-", "bytes=20-10", "bytes=0-1,4-5", "bytes=-0", "bytes=-", "bytes=9007199254740992-", "items=0-10"])
    assert.equal(parseDeviceAudioRange(bad, size), null, bad);
});

test("cache deduplicates, retries failed loads and evicts by bounded LRU", async () => {
  const cache = new DeviceAudioCache(10); let calls=0;
  const loader = () => { calls++; return Promise.resolve(new Uint8Array([1,2,3,4,5,6])); };
  const [a,b] = await Promise.all([cache.load("a", loader), cache.load("a", loader)]);
  assert.equal(calls,1); assert.equal(a,b);
  await cache.load("b",async()=>new Uint8Array([7,8,9,10])); cache.get("a");
  await cache.load("c",async()=>new Uint8Array([11,12,13,14]));
  assert.equal(cache.get("b"),undefined); assert.equal(cache.get("a"),a);
  await assert.rejects(cache.load("bad",async()=>{throw new Error("offline");}));
  assert.equal((await cache.load("bad",async()=>new Uint8Array([15])))[0],15);
  await assert.rejects(cache.load("too-big",async()=>new Uint8Array(11)));
});
