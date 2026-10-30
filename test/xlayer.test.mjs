import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeAggregate3, decodeAggregate3, lpOut, query, RPC, TOKENS, BOOST, DYOR } from "../src/js/lib/xlayer.js";

// 只用来测格式的假地址;下面的节点回复全是编的(这些测试不连网)
const A = "0x" + "5".repeat(40);
const u = (n) => BigInt(n).toString(16).padStart(64, "0");
const w = (...xs) => "0x" + xs.map(u).join("");
// 编一份 aggregate3 的回复:(bool success, bytes returnData)[]
function results(list) {
  const tuples = list.map((r) => {
    const body = (r || "0x").slice(2), len = body.length / 2;
    return u(r ? 1 : 0) + u(0x40) + u(len) + body.padEnd(Math.ceil(len / 32) * 64, "0");
  });
  let off = list.length * 32;
  const heads = tuples.map((x) => { const h = u(off); off += x.length / 2; return h; });
  return "0x" + u(0x20) + u(list.length) + heads.join("") + tuples.join("");
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
async function withFetch(fake, fn) {
  const real = globalThis.fetch, seen = [];
  globalThis.fetch = async (url, init = {}) => { seen.push({ url: String(url), init }); return fake(String(url), init); };
  try {
    return await fn(seen);
  } finally {
    globalThis.fetch = real;
  }
}

test("Multicall3:aggregate3 的编码按 ABI 规则排;回复拆得开,失败的那条是 null;格式不对就报「没查成」", () => {
  const data = encodeAggregate3([["0x" + "a".repeat(40), "0x70a08231" + u(1)], ["0x" + "b".repeat(40), "0x18160ddd"]]);
  assert.ok(data.startsWith("0x82ad56cb" + u(0x20) + u(2) + u(64)), "数组:长度 2,第一条从 64 字节开始");
  // 第一条:地址、允许失败、数据偏移 0x60、长度 36、数据补满 64 字节
  assert.ok(data.includes(u("0x" + "a".repeat(40)) + u(1) + u(0x60) + u(36) + "70a08231" + u(1) + "0".repeat(56)));
  assert.equal((data.length - 10) % 64, 0);
  assert.deepEqual(decodeAggregate3(results([w(7), null, "0x"]), 3), [w(7), null, "0x"]);
  assert.throws(() => decodeAggregate3(results([w(7)]), 2), (e) => e.code === "network");
  assert.throws(() => decodeAggregate3("0x1234", 1), (e) => e.code === "network");
});

test("DYORSwap 撤出能拿回多少:池子先给协议补铸手续费 LP(PancakeSwap 的 8/25),没有手续费增长时就是按份额算", () => {
  // 编的数:池子里 300 USDT、2.5 WOKB,手上的 LP 占 4%
  const p = { lp: 400_000_000_000n, r0: 300_000_000n, r1: 2_500_000_000_000_000_000n, supply: 10_000_000_000_000n, bal0: 300_000_000n, bal1: 2_500_000_000_000_000_000n };
  // 期望值用 Python 的 math.isqrt 另算的
  assert.deepEqual(lpOut({ ...p, kLast: (p.r0 * p.r1 * 98n) / 100n, feeOn: true }), [11961406n, 99678383797163933n]);
  assert.deepEqual(lpOut({ ...p, kLast: p.r0 * p.r1, feeOn: true }), [12_000_000n, 100_000_000_000_000_000n]);
  assert.deepEqual(lpOut({ ...p, kLast: 1n, feeOn: false }), [12_000_000n, 100_000_000_000_000_000n], "协议费没开");
});

test("X Layer:一次 eth_call 发给 Multicall3,查钱包、OKX Boost 锁仓、DYORSwap 的 LP;价格问 DefiLlama,不带地址", async () => {
  const now = Math.floor(Date.now() / 1000);
  const r = await withFetch((url, init) => {
    if (url === RPC) {
      const q = JSON.parse(init.body);
      assert.equal(q.method, "eth_call");
      assert.equal(q.params[0].to, "0xca11bde05977b3631167028862be2a173976ca11");
      assert.ok(q.params[0].data.startsWith("0x82ad56cb"));
      assert.ok(q.params[0].data.includes(BOOST.key.slice(2)), "锁仓的 key 用空格补齐");
      const out = [w(2n * 10n ** 17n), ...TOKENS.map((t) => (t.sym === "USDT0" ? w(5_000_000) : w(0)))];
      out.push(w(5n * 10n ** 17n, 172800, now - 200000, 0), w(0, 0, 0, 0), w(0, 0, 0, 0)); // OKB 锁了 0.5,早就到期
      const r0 = 300_000_000n, r1 = 2_500_000_000_000_000_000n;
      out.push(w(400_000_000_000n), w(r0, r1, now), w(10_000_000_000_000n), w(r0 * r1), w("0x" + "2".repeat(40)), w(r0), w(r1));
      return json({ jsonrpc: "2.0", id: 1, result: results(out) });
    }
    return json({ coins: { "coingecko:okb": { price: 100 }, [`xlayer:${TOKENS[1].addr}`]: { price: 1 }, [`xlayer:${TOKENS[2].addr}`]: { price: 1 } } });
  }, async (seen) => {
    const out = await query(A);
    assert.equal(seen.length, 2, "节点一次、价格一次");
    assert.ok(!seen[1].url.toLowerCase().includes(A.slice(2)));
    return out;
  });
  assert.deepEqual(r.wallet.map((x) => [x.sym, x.qty, x.usd, x.native]), [["OKB", 0.2, 20, true], ["USDT0", 5, 5, false]]);
  const boost = r.defi.find((g) => g.how === "okx-boost");
  assert.deepEqual(boost.items.map((x) => [x.type, x.sym, x.qty, x.usd]), [["locked", "OKB", 0.5, 50]]);
  assert.equal(boost.ready, true);
  const dyor = r.defi.find((g) => g.how === "dyorswap");
  // kLast 等于现在的 r0×r1:没有手续费增长,按份额算(和上面那条测试的第二种情况一样)
  assert.deepEqual(dyor.items.map((x) => [x.sym, x.qty]), [["USDT_Bridged", 12], ["WOKB", 0.1]]);
  assert.equal(dyor.chain, "X Layer");
});

test("X Layer:没到期的锁仓 ready=false;什么都没有就空着;节点回错就报「没查成」", async () => {
  const now = Math.floor(Date.now() / 1000);
  const n = 1 + TOKENS.length + BOOST.tokens.length + 7;
  const fake = (locks) => (url) => (url === RPC
    ? json({ jsonrpc: "2.0", id: 1, result: results([w(0), ...TOKENS.map(() => w(0)), ...locks, w(0), w(0, 0, 0), w(0), w(0), w(0), w(0), w(0)]) })
    : json({ coins: {} }));
  const r = await withFetch(fake([w(0, 0, 0, 0), w(200_000_000, 172800, now - 100, 1), w(0, 0, 0, 0)]), () => query(A));
  assert.equal(r.defi.length, 1);
  assert.equal(r.defi[0].ready, false);
  assert.deepEqual(r.defi[0].items.map((x) => [x.sym, x.qty, x.usd]), [["USDT0", 200, null]], "价格查不到就不报美元");
  const empty = await withFetch(fake([w(0, 0, 0, 0), w(0, 0, 0, 0), w(0, 0, 0, 0)]), () => query(A));
  assert.deepEqual(empty, { wallet: [], defi: [] });
  assert.equal(n, 21);
  await assert.rejects(withFetch(() => json({ jsonrpc: "2.0", id: 1, error: { code: -32016, message: "over rate limit" } }), () => query(A)), (e) => e.code === "network");
  assert.ok(DYOR.pair && DYOR.router);
});
