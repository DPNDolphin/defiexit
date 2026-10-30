import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shape, handle, chainName } from "../functions/api/assets.js";

// 编的数据,格式照 Zerion 的回复;地址也是编的
const FIX = JSON.parse(readFileSync("test/fixtures/zerion-positions.json", "utf8"));
const A = "0x" + "3".repeat(40);
const ORIGIN = "https://defiexit.com";
const req = (body, { origin = ORIGIN, method = "POST", type = "application/json" } = {}) =>
  new Request(`${ORIGIN}/api/assets`, { method, headers: { Origin: origin, "Content-Type": type }, body: method === "POST" ? JSON.stringify(body) : undefined });
const ok = (json, status = 200) => async () => new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });

test("全部资产:钱包余额按链合起来;份额凭证、垃圾币不算;不到 1 美分的只算个数", () => {
  const out = shape(FIX);
  assert.equal(out.status, "ok");
  assert.deepEqual(out.wallet.map((g) => [g.chain, g.usd]), [["Ethereum", 1500], ["X Layer", 28], ["Base", 20], ["Linea", 12], ["BNB Chain", 6.5], ["Arbitrum", 5]]);
  assert.equal(out.dust, 2);
  assert.ok(!JSON.stringify(out).includes("aEthUSDC"), "份额凭证不该单列");
  assert.ok(!JSON.stringify(out).includes("SCAM"), "垃圾币不该出现");
  assert.equal(out.totals.wallet, 1571.5);
});

test("全部资产:「取回」要用的——链编号、币的合约地址、这条链上有没有原生币付手续费、仓位是哪一类", () => {
  const out = shape(FIX);
  const w = Object.fromEntries(out.wallet.map((g) => [g.chain, g]));
  assert.equal(w.Base.cid, "base");
  assert.deepEqual(w.Base.tokens[0], { sym: "USDC", qty: 20, usd: 20, addr: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", native: false });
  assert.equal(w.Base.gas, null, "Base 上没有 ETH");
  assert.equal(w.Base.tokens.length, 1, "没价格的同名币不列");
  assert.equal(out.unpriced, 1);
  assert.deepEqual(w.Ethereum.tokens[0], { sym: "ETH", qty: 0.5, usd: 1500, addr: null, native: true });
  assert.deepEqual(w.Ethereum.gas, { sym: "ETH", qty: 0.5, usd: 1500 });
  // 原生币不到 1 美分:不单列,但手续费那一项照样记下
  assert.deepEqual(w.Arbitrum.tokens.map((x) => x.sym), ["ARB"]);
  assert.deepEqual(w.Arbitrum.gas, { sym: "ETH", qty: 0.000001, usd: 0.003 });
  assert.equal(w.Linea.gas, null);
  assert.equal(w["X Layer"].cid, "okbchain");
  const d = Object.fromEntries(out.defi.map((g) => [g.app, g]));
  assert.equal(d.WOOFi.cid, "arbitrum");
  assert.deepEqual(d.WOOFi.items.map((x) => [x.type, x.mod]), [["staked", "staked"], ["reward", "rewards"]]);
  assert.deepEqual(d["Uniswap V3"].items.map((x) => x.mod), ["liquidity-pool", "liquidity-pool"]);
});

test("全部资产:存在项目里的按「项目 + 链」合起来;借款单算,不进合计;价格未知的照样列出", () => {
  const out = shape(FIX);
  assert.deepEqual(out.defi.map((g) => [g.app, g.chain, g.usd, g.debt]), [
    ["Aave V3", "Ethereum", 100, 30],
    ["Uniswap V3", "Base", 60, 0],
    ["WOOFi", "Arbitrum", 41.5, 0],
    ["ExampleSwap", "X Layer", 0, 0],
  ]);
  assert.deepEqual(out.defi[2].items.map((x) => [x.type, x.sym, x.qty]), [["staked", "WOO", 500], ["reward", "USDC", 1.5]]);
  assert.equal(out.defi[3].items[0].usd, null);
  assert.equal(out.totals.defi, 201.5);
  assert.ok(!JSON.stringify(out).includes("example.invalid"), "不把 Zerion 给的项目网址传给页面");
});

test("全部资产:什么都没有就是 empty;链名没在表里就把编号整理一下", () => {
  assert.equal(shape({ data: [] }).status, "empty");
  assert.equal(shape(null).status, "empty");
  assert.equal(chainName("some-new-chain"), "Some New Chain");
});

test("接口:只收本站页面发的 POST、合法地址;没配密钥回 off,也不去问 Zerion", async () => {
  let called = 0;
  const f = async () => { called++; return new Response("{}"); };
  assert.equal((await handle(req({ a: A }, { method: "GET" }), {}, f)).status, 405);
  assert.equal((await handle(req({ a: A }, { origin: "https://evil.example" }), { ZERION_API_KEY: "k" }, f)).status, 403);
  assert.equal((await handle(req({ a: A }, { type: "text/plain" }), { ZERION_API_KEY: "k" }, f)).status, 415);
  assert.equal((await handle(req({ a: "0x123" }), { ZERION_API_KEY: "k" }, f)).status, 400);
  const off = await handle(req({ a: A }), {}, f);
  assert.deepEqual(await off.json(), { status: "off" });
  assert.equal(called, 0);
});

test("接口:密钥按 Basic 方式只发给 Zerion;一次请求查全部(钱包 + 项目仓位);回复和日志里都没有密钥和地址", async () => {
  const seen = [];
  const logs = [];
  const log = console.log;
  console.log = (...x) => logs.push(x.join(" "));
  try {
    const r = await handle(req({ a: A }), { ZERION_API_KEY: "zk_test_key" }, async (u, o) => {
      seen.push({ u, o });
      return ok(FIX)();
    });
    const body = await r.text();
    assert.equal(r.status, 200);
    assert.equal(seen.length, 1);
    assert.ok(seen[0].u.startsWith(`https://api.zerion.io/v1/wallets/${A}/positions/?`));
    const q = new URL(seen[0].u).searchParams;
    assert.equal(q.get("filter[positions]"), "no_filter");
    assert.equal(q.get("filter[trash]"), "only_non_trash");
    assert.equal(seen[0].o.headers.Authorization, `Basic ${btoa("zk_test_key:")}`);
    assert.ok(!body.includes("zk_test_key"));
    assert.ok(logs.every((l) => !l.includes(A) && !l.includes("zk_test_key")), logs.join("\n"));
    assert.equal(JSON.parse(body).status, "ok");
  } finally {
    console.log = log;
  }
});

test("接口:Zerion 额度用完回 busy,密钥不对回 key,超时回 timeout", async () => {
  const env = { ZERION_API_KEY: "k", ZERION_TIMEOUT_MS: "50" };
  const log = console.log;
  console.log = () => {};
  try {
    let r = await handle(req({ a: A }), env, ok({ errors: [] }, 429));
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { status: "busy" });
    r = await handle(req({ a: A }), env, ok({ errors: [] }, 401));
    assert.deepEqual(await r.json(), { status: "error", why: "key" });
    r = await handle(req({ a: A }), env, (u, o) => new Promise((res, rej) => o.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))));
    assert.equal(r.status, 504);
    assert.deepEqual(await r.json(), { status: "error", why: "timeout" });
  } finally {
    console.log = log;
  }
});
