import { test } from "node:test";
import assert from "node:assert/strict";
import { detect, diagnose, decodeRewards, units, C } from "../src/js/detectors/woofi.js";

// 编的地址和数字(不是任何真实账户)
const USER = "0x7a1C3e5F9b2D4c6A8e0F1b3D5c7E9a1B3d5F9E4d";
const USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const USDCE = "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8";
const ARB = "0x912ce59144191c1204e64559fe8253a0e49e6548";
const WOO = "0xcafcd85d8ca7ad1e1c6f82f651fa15e33aefd07b";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const E18 = 10n ** 18n;

const word = (n) => BigInt(n).toString(16).padStart(64, "0");
const pad = (a) => "0x" + word(BigInt(a));
function rewardsHex(xp, list) {
  const n = list.length;
  return "0x" + word(xp) + word(0x60) + word(0x60 + 32 * (1 + n)) + word(n) + list.map(([t]) => word(BigInt(t))).join("") + word(n) + list.map(([, v]) => word(v)).join("");
}
const round = (answer, ageSec = 600) => "0x" + word(1) + word(answer) + word(0) + word(Math.floor(Date.now() / 1000) - ageSec) + word(1);

// 账户状态 → 假节点
function node(s) {
  return async (url, opts) => {
    assert.equal(url, "https://arb1.arbitrum.io/rpc");
    const body = JSON.parse(opts.body);
    const reply = body.map((q) => {
      const r = { jsonrpc: "2.0", id: q.id };
      if (q.method === "eth_blockNumber") r.result = "0x1000000";
      else if (q.method === "eth_getBalance") r.result = "0x" + (s.gas ?? 5n * 10n ** 14n).toString(16);
      else if (q.method === "eth_getLogs") {
        const f = q.params[0], b = (l) => parseInt(l.blockNumber, 16);
        r.result = (s.logs || []).filter((l) => (Array.isArray(f.address) ? f.address.includes(l.address) : f.address === l.address) && b(l) >= parseInt(f.fromBlock, 16) && b(l) <= parseInt(f.toBlock, 16));
      }
      else if (q.method === "eth_call") {
        const { to, data } = q.params[0];
        const sel = data.slice(0, 10);
        if (s.fail?.includes(to)) r.error = { code: -32000, message: "execution reverted" };
        else if (to === C.manager && sel === "0x78657429") r.result = "0x" + word(s.woo ?? 0n);
        else if (to === C.manager && sel === "0x31d7a262") r.result = rewardsHex(7n * E18, s.rewards ?? []);
        else if (to === C.compounder) r.result = "0x" + word(s.auto ? 1 : 0);
        else if (to === C.withdrawMgr) r.result = "0x" + word(s.avail ?? 0n);
        else if (to === C.vault && sel === "0x70a08231") r.result = "0x" + word(s.shares ?? 0n);
        else if (to === C.vault && sel === "0x0eb0c8f3") r.result = "0x" + word(s.staked ?? 0n);
        else if (to === C.vault && sel === "0x882c127e") r.result = "0x" + word(s.requested ?? 0n);
        else if (to === C.vault && sel === "0x77c7b8fc") r.result = "0x" + word(11n * E18 / 10n);
        else if (to === C.wooUsd) r.result = round(s.wooPx ?? 1_200_000n, s.priceAge);
        else if (to === C.ethUsd) r.result = round(s.ethPx ?? 250_000_000_000n, s.priceAge);
        else throw new Error(`没想到的查询 ${to} ${sel}`);
      }
      return r;
    });
    return { ok: true, status: 200, json: async () => reply };
  };
}
async function withNode(s, fn) {
  const old = globalThis.fetch;
  globalThis.fetch = node(s);
  try { return await fn(); } finally { globalThis.fetch = old; }
}

// 一个编的账户:质押 2500.5 WOO、奖励 3.21 USDC(外加一点 USDC.e、ARB 零头)、金库结算好的 0.0123 ETH
const FULL = {
  woo: 25005n * E18 / 10n,
  rewards: [[USDCE, 5n], [ARB, 6n], [USDC, 3_210_000n]],
  avail: 123n * E18 / 10000n,
};

test("奖励的两个动态数组:币和数量一一对上;长度不对就当数据不对", () => {
  const hex = rewardsHex(1n, [[USDC, 1_500_000n], [ARB, 2n * E18]]);
  assert.deepEqual(decodeRewards(hex), [{ token: USDC, raw: 1_500_000n }, { token: ARB, raw: 2n * E18 }]);
  const bad = "0x" + word(1) + word(0x60) + word(0x80) + word(99);
  assert.throws(() => decodeRewards(bad), /对不上/);
  assert.equal(units(1_500_000n, 6), 1.5);
  assert.equal(units(25005n * E18 / 10n, 18), 2500.5);
});

test("检测:三样都有,按喂价算合计,三步都要做", async () => {
  const r = await withNode(FULL, () => detect(USER, "zh"));
  assert.equal(r.status, "found");
  assert.deepEqual(r.flags, { needsClaim: true, needsUnstake: true, needsVault: true });
  assert.deepEqual(r.vars, { addrShort: "0x7a1C…9E4d", woo: "2500.5000", usdc: "3.21", eth: "0.012300" });
  // 2500.5 × 0.012 + 3.21 + 0.0123 × 2500
  assert.equal(r.usd.toFixed(4), (2500.5 * 0.012 + 3.21 + 0.0123 * 2500).toFixed(4));
  assert.equal(r.total.value, "$63.96");
  assert.deepEqual(r.rows.map((x) => x.value), ["2500.5000 WOO", "3.21 USDC", "0.012300 ETH"]);
  assert.equal(r.rows[1].hint, "另有一点 USDC.e、ARB 零头");
  assert.deepEqual(r.warnings, []);
});

test("检测:什么都没有是 empty;只剩指南还没写的金库份额,不叫零头", async () => {
  assert.equal((await withNode({}, () => detect(USER, "zh"))).status, "empty");
  const r = await withNode({ shares: E18 / 100n }, () => detect(USER, "zh"));
  assert.equal(r.status, "dust");
  assert.equal(r.badge, "指南还没写");
  assert.match(r.warnings.join(), /Instant Withdraw/);
  assert.deepEqual(r.flags, { needsClaim: false, needsUnstake: false, needsVault: false });
});

test("检测:手续费的 ETH 不够 0.0002 要提醒;自动复投要提醒", async () => {
  const r = await withNode({ ...FULL, gas: 10n ** 13n, auto: true }, () => detect(USER, "zh"));
  assert.match(r.warnings.join("|"), /0\.000010 ETH.*0\.0002/);
  assert.match(r.warnings.join("|"), /自动复投/);
});

test("检测:喂价太旧或者查不到,不报美元,但余额照样查", async () => {
  const stale = await withNode({ ...FULL, priceAge: 3 * 86400 }, () => detect(USER, "zh"));
  assert.equal(stale.status, "found");
  assert.equal(stale.total.value, "$3.21 + 2500.5000 WOO");
  assert.equal(stale.rows[0].hint, null);
  assert.match(stale.warnings.join(), /美元价暂时查不到/);
  const failed = await withNode({ ...FULL, fail: [C.wooUsd, C.ethUsd] }, () => detect(USER, "en"));
  assert.equal(failed.status, "found");
  assert.equal(failed.total.value, "$3.21 + 2500.5000 WOO");
  // 余额那几条查不到就整体报错,不拿半截数据去算
  await assert.rejects(withNode({ ...FULL, fail: [C.manager] }, () => detect(USER, "zh")), /Arbitrum 节点/);
});

test("诊断:按指南的顺序找第一件没做完的事", async () => {
  assert.equal((await withNode(FULL, () => diagnose(USER, Date.now(), "zh"))).step, "claim");
  assert.equal((await withNode({ ...FULL, rewards: [] }, () => diagnose(USER, Date.now(), "zh"))).step, "unstake");
  const v = await withNode({ avail: FULL.avail }, () => diagnose(USER, Date.now(), "zh"));
  assert.equal(v.step, "vault");
  assert.equal(v.findings[0].code, "can-collect");
  // 开着自动复投:领不了奖励,先解押
  const a = await withNode({ ...FULL, auto: true }, () => diagnose(USER, Date.now(), "zh"));
  assert.equal(a.step, "unstake");
  assert.ok(a.findings.some((f) => f.code === "auto-compound" && f.level === "stop"));
});

test("诊断:都取完了,链上查到转进钱包的记录,才算已到账", async () => {
  const me = pad(USER);
  const logs = [
    { address: WOO, topics: [TRANSFER, pad(C.local), me], data: "0x" + word(FULL.woo), blockNumber: "0xfffff0", transactionHash: "0x" + "a1".repeat(32), logIndex: "0x1" },
    { address: USDC, topics: [TRANSFER, pad("0xa6000b7d3634534266a2ecc4d478f5cdc1e65bd3"), me], data: "0x" + word(3_210_000n), blockNumber: "0xfffff1", transactionHash: "0x" + "b2".repeat(32), logIndex: "0x2" },
    { address: C.withdrawMgr, topics: ["0x884edad9ce6fa2440d8a54cc123490eb96d2768479d49ff9c7366125a9424364", me], data: "0x" + word(FULL.avail), blockNumber: "0xfffff2", transactionHash: "0x" + "c3".repeat(32), logIndex: "0x0" },
  ];
  const d = await withNode({ logs }, () => diagnose(USER, Date.now(), "zh"));
  assert.equal(d.step, "arrive");
  assert.equal(d.arrival.state, "arrived");
  assert.deepEqual(d.arrival.items.map((x) => `${x.amount} ${x.sym}`), ["2500.5000 WOO", "3.21 USDC", "0.012300 ETH"]);
  // 合约地址按官方大小写显示,和核对卡上写的一样
  assert.match(d.arrival.items[0].text, /0x2CFa…d8e2/);
  assert.match(d.arrival.items[2].text, /0xE77A…Ad6a/);
  assert.ok(d.findings.some((f) => f.code === "arrived" && f.level === "done"));
  // 取完了但最近 4 小时没查到记录:不宣布到账,只说 WOOFi 里没钱了
  const e = await withNode({}, () => diagnose(USER, Date.now(), "zh"));
  assert.equal(e.arrival, null);
  assert.equal(e.step, null);
  assert.equal(e.findings[0].code, "clear");
});
