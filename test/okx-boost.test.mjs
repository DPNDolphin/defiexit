import { test } from "node:test";
import assert from "node:assert/strict";
import { detect, diagnose } from "../src/js/detectors/okx-boost.js";
import { detectors, diagnosers } from "../src/js/detectors/index.js";
import { RPC, BOOST } from "../src/js/lib/xlayer.js";

// 只用来测格式的假地址;下面的节点回复全是编的(这些测试不连网)
const addr = (c) => "0x" + c.repeat(40);
const u = (n) => BigInt(n).toString(16).padStart(64, "0");
const w = (...xs) => "0x" + xs.map(u).join("");
const OKB = 10n ** 17n; // 0.1 OKB
const DAY = 86400;
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
// 假节点:gas 是钱包里的原生 OKB(wei),locks 是三种币的 getLockInfo(数量、锁期、开始时间、是否锁着);logs 是解除质押事件
function node({ gas = 10n ** 15n, locks, logs = [] }) {
  return (url, q) => {
    if (url !== RPC) return json({ coins: { "coingecko:okb": { price: 100 } } });
    if (Array.isArray(q)) return json(q.map((x) => ({ jsonrpc: "2.0", id: x.id, result: x.id === 1 ? logs : [] })));
    if (q.method === "eth_blockNumber") return json({ jsonrpc: "2.0", id: 1, result: "0x1000" });
    return json({ jsonrpc: "2.0", id: 1, result: results([w(gas), ...locks]) });
  };
}
const none = w(0, 0, 0, 0);
const now = () => Math.floor(Date.now() / 1000);

test("OKX Boost:登记进检测器表,配方的 detector 名字对得上", () => {
  assert.equal(detectors["okx-boost"], detect);
  assert.equal(diagnosers["okx-boost"], diagnose);
});

test("OKX Boost 检测:锁着 0.5 OKB、早就到期 → found,按价格报美元,到期那一行;价格请求不带地址", async () => {
  const A = addr("6");
  const res = await withFetch(node({ locks: [w(5n * OKB, 2 * DAY, now() - 300 * DAY, 0), none, none] }), async (seen) => {
    const out = await detect(A);
    const q = seen[0].body;
    assert.equal(q.params[0].to, "0xca11bde05977b3631167028862be2a173976ca11");
    assert.ok(q.params[0].data.includes(BOOST.key.slice(2)), "锁仓的 key 用空格补齐");
    assert.ok(q.params[0].data.includes(BOOST.locker.slice(2)));
    assert.equal(seen.length, 2, "节点一次、价格一次");
    assert.ok(!seen[1].url.toLowerCase().includes(A.slice(2)));
    return out;
  });
  assert.equal(res.status, "found");
  assert.equal(res.usd, 50);
  assert.deepEqual(res.rows[0], { label: "锁着的 OKB", value: "0.5 OKB", hint: "约 $50.00" });
  assert.equal(res.rows[1].label, "到期");
  assert.equal(res.rows[1].hint, "已到期,现在就能取");
  assert.deepEqual(res.total, { label: "能取回约", value: "$50.00" });
  assert.deepEqual(res.warnings, []);
  assert.deepEqual(res.vars, { addrShort: "0x6666…6666", got: "0.5 OKB", sym: "OKB" });
});

test("OKX Boost 检测:手续费不够、还没到期都提醒;价格查不到照样算 found,合计里原样列出", async () => {
  const res = await withFetch((url, q) => (url === RPC ? node({ gas: 0n, locks: [none, w(200_000_000, 2 * DAY, now() - 3600, 1), none] })(url, q) : json({ coins: {} })),
    () => detect(addr("7")));
  assert.equal(res.status, "found");
  assert.equal(res.rows[0].value, "200 USDT0");
  assert.equal(res.rows[0].hint, "美元价暂时查不到");
  assert.equal(res.total.value, "$0.00 + 200 USDT0");
  assert.equal(res.rows[1].hint, "还没到期,到期前取不出来");
  assert.equal(res.warnings.length, 2);
  assert.ok(res.warnings[0].startsWith("还没到期"));
  assert.ok(res.warnings[1].includes("可能不够付手续费"));
});

test("OKX Boost 检测:什么都没锁 → empty,不填「你锁的币」;锁仓那条没查到就报错,不当成没锁", async () => {
  const res = await withFetch(node({ locks: [none, none, none] }), () => detect(addr("8")));
  assert.equal(res.status, "empty");
  assert.deepEqual(res.rows, []);
  assert.deepEqual(Object.keys(res.vars), ["addrShort"]);
  await assert.rejects(withFetch(node({ locks: [null, none, none] }), () => detect(addr("8"))), (e) => e.code === "network");
  // 节点回来的字段不全:只有数量没有锁期和开始时间,不能当成「已到期」或者「没锁过」
  await assert.rejects(withFetch(node({ locks: [w(5n * OKB), none, none] }), () => detect(addr("8"))), (e) => e.code === "network");
  await assert.rejects(withFetch(node({ locks: [w(0), none, none] }), () => diagnose(addr("8"))), (e) => e.code === "network");
});

test("OKX Boost 诊断:还锁着 → 去「解除质押」;取完回来,用这一页之前查到的数核对到账,不再去扫事件", async () => {
  const A = addr("9"), start = now() - 300 * DAY;
  const d1 = await withFetch(node({ locks: [w(5n * OKB, 2 * DAY, start, 0), none, none] }), () => diagnose(A));
  assert.equal(d1.step, "unstake");
  assert.equal(d1.findings[0].code, "can-unstake");
  assert.equal(d1.arrival, null);
  // 解除质押以后:数量清零,锁期和开始时间还在
  const d2 = await withFetch(node({ locks: [w(0, 2 * DAY, start, 0), none, none] }), async (seen) => {
    const d = await diagnose(A);
    assert.ok(!seen.some((s) => Array.isArray(s.body)), "这一页查到过,不用扫事件");
    return d;
  });
  assert.equal(d2.step, "arrive");
  assert.equal(d2.findings[0].code, "arrived");
  assert.deepEqual(d2.arrival.items.map((x) => [x.sym, x.amount]), [["OKB", "0.5"]]);
  assert.ok(d2.arrival.items[0].text.includes("0xDA63…FD2b"));
});

test("OKX Boost 诊断:新打开的页面,取完了查最近的解除质押事件;没查到就只说「已经取出来了」,不报数", async () => {
  const start = now() - 300 * DAY;
  const log = { topics: ["0xb22d6ea8fb37b3c28402a761528066018f1d5ea56b967fff8fd1f83c7f0df8e0", BOOST.key, "0x" + u(addr("a")), "0x" + "0".repeat(24) + "e".repeat(40)], data: w(5n * OKB), blockNumber: "0xfff" };
  const d1 = await withFetch(node({ locks: [w(0, 2 * DAY, start, 0), none, none], logs: [log] }), async (seen) => {
    const d = await diagnose(addr("a"));
    const batch = seen.find((s) => Array.isArray(s.body)).body;
    assert.equal(batch.length, 4, "公共节点限速:只扫 4 段");
    assert.ok(batch.every((x) => x.method === "eth_getLogs" && parseInt(x.params[0].toBlock, 16) - parseInt(x.params[0].fromBlock, 16) === 99), "每段 100 个块");
    assert.equal(batch[0].params[0].topics[2], "0x" + u(addr("a")));
    return d;
  });
  assert.equal(d1.findings[0].code, "arrived");
  assert.deepEqual(d1.arrival.items.map((x) => [x.sym, x.amount]), [["OKB", "0.5"]]);
  const d2 = await withFetch(node({ locks: [w(0, 2 * DAY, start, 0), none, none] }), () => diagnose(addr("b")));
  assert.equal(d2.step, "arrive");
  assert.equal(d2.findings[0].code, "withdrawn");
  assert.equal(d2.arrival, null, "不知道数就不显示「已到账」大页");
  // 事件全被限速:照样只说「已经取出来了」,不说是什么时候取的
  const limited = (url, q) => (Array.isArray(q) ? json(q.map((x) => ({ jsonrpc: "2.0", id: x.id, error: { code: -32016, message: "over rate limit" } }))) : node({ locks: [w(0, 2 * DAY, start, 0), none, none] })(url, q));
  const d4 = await withFetch(limited, () => diagnose(addr("f")));
  assert.equal(d4.findings[0].code, "withdrawn");
  assert.ok(!d4.findings[0].text.includes("刚刚"), "查不全时不说取的时间");
  const d3 = await withFetch(node({ locks: [none, none, none] }), () => diagnose(addr("c")));
  assert.equal(d3.step, null);
  assert.equal(d3.findings[0].code, "nothing");
});

test("OKX Boost:英文版没有中文", async () => {
  const start = now() - 300 * DAY;
  const r = await withFetch(node({ gas: 0n, locks: [w(5n * OKB, 2 * DAY, start, 0), none, none] }), () => detect(addr("d"), "en"));
  const d = await withFetch(node({ locks: [w(0, 2 * DAY, start, 0), none, none] }), () => diagnose(addr("e"), Date.now(), "en"));
  assert.ok(!/[　-〿一-鿿＀-￯]/.test(JSON.stringify([r, d])));
  assert.equal(r.rows[0].label, "Locked OKB");
});
