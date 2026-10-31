import { test } from "node:test";
import assert from "node:assert/strict";
import { detect, diagnose } from "../src/js/detectors/dyorswap.js";
import { detectors, diagnosers } from "../src/js/detectors/index.js";
import { RPC, DYOR } from "../src/js/lib/xlayer.js";

// 只用来测格式的假地址;下面的节点回复全是编的(这些测试不连网)
const addr = (c) => "0x" + c.repeat(40);
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
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
async function withFetch(fake, fn) {
  const real = globalThis.fetch, seen = [];
  globalThis.fetch = async (url, init = {}) => { seen.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null }); return fake(String(url), init.body ? JSON.parse(init.body) : null); };
  try {
    return await fn(seen);
  } finally {
    globalThis.fetch = real;
  }
}
// 编的池子:1000 USDT、10 WOKB,LP 总量 10^12。grow 是 √k 比上次结算涨了多少(1.05 就是涨 5%),涨了才要补铸手续费 LP
const R0 = 1000n * 10n ** 6n, R1 = 10n * 10n ** 18n, SUPPLY = 10n ** 12n;
const USDT = "0x1e4a5963abfd975d8c9021ce480b42188849d41d";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", BURN = "0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496";
const topic = (a) => "0x" + a.slice(2).padStart(64, "0");
// 编一笔撤出的回执:发给路由,池子 Burn,路由解包 WOKB,USDT 打给 to
const WOKB = "0xe538905cf8410324e03a5a23c1c177a474d59b2b", WITHDRAWAL = "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65";
const receipt = (to, usdt, okb, { status = "0x1", sentTo = DYOR.router, unwrap = true, burn = true } = {}) => ({ status, to: sentTo, logs: [
  { address: DYOR.pair, topics: [TRANSFER, topic(to), topic(DYOR.pair)], data: w(1) },
  ...(burn ? [{ address: DYOR.pair, topics: [BURN, topic(DYOR.router), topic(DYOR.router)], data: w(usdt, okb) }] : []),
  ...(unwrap ? [{ address: WOKB, topics: [WITHDRAWAL, topic(DYOR.router)], data: w(okb) }] : []),
  { address: USDT, topics: [TRANSFER, topic(DYOR.router), topic(to)], data: w(usdt) },
] });
// tx 是最近的撤出回执;limited 是批量查事件被限速
function node({ gas = 10n ** 15n, lp = 10n ** 10n, nonce = 0n, allowance = 0n, grow = 1, px = true, cut = null, tx = null, limited = false }) {
  const kLast = (R0 * R1 * 10n ** 8n) / BigInt(Math.round(grow * grow * 10 ** 8));
  return (url, q) => {
    if (url !== RPC) return json({ coins: px ? { "coingecko:okb": { price: 100 } } : {} });
    if (Array.isArray(q)) return json(q.map((x) => (limited ? { jsonrpc: "2.0", id: x.id, error: { code: -32016, message: "over rate limit" } } : { jsonrpc: "2.0", id: x.id, result: x.id === 1 && tx ? [{ transactionHash: "0xaa" }] : [] })));
    if (q.method === "eth_blockNumber") return json({ jsonrpc: "2.0", id: 1, result: "0x1000" });
    if (q.method === "eth_getTransactionReceipt") return json({ jsonrpc: "2.0", id: 1, result: tx });
    const out = [w(gas), w(lp), w(nonce), w(allowance), w(R0, R1, 1), w(SUPPLY), w(kLast), w(1), w(R0), w(R1)];
    if (cut !== null) out[cut.i] = cut.to;
    return json({ jsonrpc: "2.0", id: 1, result: results(out) });
  };
}

test("DYORSwap:登记进检测器表;配方里不写 zerion(Zerion 查到的可能是别的池子)", async () => {
  assert.equal(detectors.dyorswap, detect);
  assert.equal(diagnosers.dyorswap, diagnose);
  const r = JSON.parse((await import("node:fs")).readFileSync("recipes/dyorswap/recipe.json", "utf8"));
  assert.equal(r.zerion, undefined);
  assert.equal(r.tested, false, "钱包弹窗还没实测");
  assert.deepEqual(r.steps.map((s) => s.id), ["open", "pool", "slippage", "enable", "remove", "arrive"], "先改滑点,再签名、撤出");
});

test("DYORSwap 检测:有 LP → found,按撤出时能拿回的数报;价格请求不带地址;请求里查了 LP 和路由的授权", async () => {
  const A = addr("6");
  const res = await withFetch(node({}), async (seen) => {
    const out = await detect(A);
    const data = seen[0].body.params[0].data;
    assert.ok(data.includes(DYOR.pair.slice(2)));
    assert.ok(data.includes(DYOR.router.slice(2)), "查 USDT 给路由的授权");
    assert.equal(seen.length, 2, "节点一次、价格一次");
    assert.ok(!seen[1].url.toLowerCase().includes(A.slice(2)));
    return out;
  });
  assert.equal(res.status, "found");
  assert.deepEqual(res.rows.map((x) => x.value), ["10 USDT", "0.1 OKB"]);
  assert.equal(res.rows[1].hint, "约 $10.00");
  assert.equal(res.rows[0].hint, "美元价暂时查不到", "编的价格里只有 OKB");
  assert.deepEqual(res.total, { label: "能取回约", value: "$10.00 + 10 USDT" });
  assert.deepEqual(res.warnings, []);
  assert.deepEqual(res.vars, { addrShort: "0x6666…6666", got: "10 USDT 和 0.1 OKB" });
  const en = await withFetch(node({}), () => detect(A, "en"));
  assert.equal(en.vars.got, "10 USDT + 0.1 OKB");
});

test("DYORSwap 检测:没有 LP → empty,不填要到账的数;手续费不够要提醒", async () => {
  const none = await withFetch(node({ lp: 0n }), () => detect(addr("7")));
  assert.equal(none.status, "empty");
  assert.deepEqual(none.rows, []);
  assert.equal(none.vars.got, undefined);
  const low = await withFetch(node({ gas: 0n }), () => detect(addr("8")));
  assert.equal(low.status, "found");
  assert.ok(low.warnings.some((x) => x.includes("手续费")));
});

test("DYORSwap 滑点:真实到账少约 0.5% 时 1% 够用,不提醒;差得接近 1% 就超出核对过的范围了,让用户先停下,不另给一个数", async () => {
  const fine = await withFetch(node({ grow: 1.018 }), () => detect(addr("9")));
  assert.deepEqual(fine.warnings, [], "这时指南里的 1% 够用");
  const big = await withFetch(node({ grow: 1.05 }), () => detect(addr("a")));
  assert.equal(big.warnings.length, 1);
  assert.match(big.warnings[0], /少 1\.\d+%,这份指南里的 1% 滑点可能不够/);
  assert.ok(!/设到/.test(big.warnings[0]), "第 3 步和核对卡写的都是 1%,这里不能另说一个数");
  assert.equal(big.hold, true, "从结果页点进来也要停在概况页,看得到这条提醒");
  assert.equal(fine.hold, false);
  const enBig = await withFetch(node({ grow: 1.05 }), () => detect(addr("a"), "en"));
  assert.match(enBig.warnings[0], /may not be enough/);
});

test("DYORSwap:节点回来的东西不全,一律报没查成,不当成没有 LP", async () => {
  await assert.rejects(withFetch(node({ cut: { i: 1, to: null } }), () => detect(addr("b"))), (e) => e.code === "network");
  await assert.rejects(withFetch(node({ cut: { i: 4, to: w(R0) } }), () => detect(addr("b"))), (e) => e.code === "network", "getReserves 只回了一格");
  await assert.rejects(withFetch(node({ lp: 0n, cut: { i: 3, to: null } }), () => diagnose(addr("b"))), (e) => e.code === "network");
});

test("DYORSwap 诊断:LP 还在,链上看不出做到哪了:不指到某一步,也不说「钱没动」;超出核对过的范围、手续费不够要说", async () => {
  const d = await withFetch(node({}), () => diagnose(addr("c")));
  assert.equal(d.step, null);
  assert.deepEqual(d.findings.map((x) => x.code), ["in-pool"]);
  assert.ok(!d.findings[0].text.includes("钱没动"));
  assert.equal(d.arrival, null);
  const d2 = await withFetch(node({ gas: 0n, grow: 1.05 }), () => diagnose(addr("c")));
  assert.deepEqual(d2.findings.map((x) => [x.code, x.level]), [["in-pool", "ok"], ["need-slip", "stop"], ["low-gas", "stop"]]);
});

test("DYORSwap 诊断:最近有撤出记录、LP 清零 → 到账,数来自链上回执;旧授权还在就提醒", async () => {
  const A = addr("d");
  const d = await withFetch(node({ lp: 0n, nonce: 1n, allowance: 5n, tx: receipt(A, 12_500_000n, 3n * 10n ** 16n) }), () => diagnose(A));
  assert.equal(d.step, "arrive");
  assert.deepEqual(d.findings.map((x) => x.code), ["arrived", "old-approval"]);
  assert.deepEqual(d.arrival.items.map((x) => [x.sym, x.amount]), [["USDT", "12.5"], ["OKB", "0.03"]]);
  assert.equal(d.arrival.state, "arrived");
});

test("DYORSwap 诊断:撤了一部分,不说「没撤」,也不说全到账", async () => {
  const A = addr("2");
  const d = await withFetch(node({ tx: receipt(A, 5_000_000n, 5n * 10n ** 16n) }), () => diagnose(A));
  assert.deepEqual(d.findings.map((x) => x.code), ["partial"]);
  assert.equal(d.step, null);
  assert.equal(d.arrival, null);
  assert.ok(d.findings[0].text.includes("5 USDT 和 0.05 OKB") && d.findings[0].text.includes("10 USDT 和 0.1 OKB"));
});

test("DYORSwap 诊断:LP 清零不等于撤出来了:转走了、回执失败、钱打给了别人,都不能报到账", async () => {
  const A = addr("3"), other = addr("4");
  // 把 LP 转给了别人:没有撤出记录,也没用过签名
  const moved = await withFetch(node({ lp: 0n }), () => diagnose(A));
  assert.deepEqual(moved.findings.map((x) => x.code), ["nothing"]);
  assert.equal(moved.arrival, null);
  // 交易失败了
  const failed = await withFetch(node({ lp: 0n, nonce: 1n, tx: receipt(A, 5n, 5n, { status: "0x0" }) }), () => diagnose(A));
  assert.deepEqual(failed.findings.map((x) => x.code), ["no-lp"]);
  assert.equal(failed.arrival, null);
  // 同一笔里 USDT 打给了别人
  const elsewhere = await withFetch(node({ lp: 0n, nonce: 1n, tx: receipt(other, 5n, 5n) }), () => diagnose(A));
  assert.deepEqual(elsewhere.findings.map((x) => x.code), ["no-lp"]);
  assert.equal(elsewhere.arrival, null);
  // 证据不全都不算:没解包(选了 Receive WOKB,到手的不是 OKB)、没有 Burn、不是发给路由的
  for (const opt of [{ unwrap: false }, { burn: false }, { sentTo: other }]) {
    const d = await withFetch(node({ lp: 0n, nonce: 1n, tx: receipt(A, 5n, 5n, opt) }), () => diagnose(A));
    assert.deepEqual(d.findings.map((x) => x.code), ["no-lp"], JSON.stringify(opt));
    assert.equal(d.arrival, null);
  }
  // 回来的数格式不对:不能当成 0 到账
  const tx = receipt(A, 5n, 5n);
  tx.logs.find((l) => l.topics[0] === WITHDRAWAL).data = undefined;
  const broken = await withFetch(node({ lp: 0n, nonce: 1n, tx }), () => diagnose(A));
  assert.deepEqual(broken.findings.map((x) => x.code), ["no-lp"]);
});

test("DYORSwap 诊断:只有 USDT 授权说明不了有过 LP(换币也要授权);查事件被限速时不编数", async () => {
  const onlyApproval = await withFetch(node({ lp: 0n, allowance: 5n }), () => diagnose(addr("5")));
  assert.equal(onlyApproval.step, null);
  assert.deepEqual(onlyApproval.findings.map((x) => x.code), ["nothing", "old-approval"]);
  const limited = await withFetch(node({ lp: 0n, nonce: 1n, limited: true }), () => diagnose(addr("5")));
  assert.equal(limited.step, "arrive");
  assert.deepEqual(limited.findings.map((x) => x.code), ["no-lp"]);
  assert.equal(limited.arrival, null);
});
