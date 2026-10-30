import { test } from "node:test";
import assert from "node:assert/strict";
import { getJSON } from "../src/js/lib/net.js";

test("网络请求超时:浏览器的 AbortError 换成我们自己的「查询超时」,不把英文原话带到页面上", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (url, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new DOMException("signal is aborted without reason", "AbortError"))));
  try {
    await assert.rejects(getJSON("https://example.invalid/", 20), (e) => e.code === "timeout" && e.message === "查询超时");
  } finally {
    globalThis.fetch = real;
  }
});
