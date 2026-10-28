import { test } from "node:test";
import assert from "node:assert/strict";
import { detect, fillable } from "../src/js/detectors/hyperliquid.js";

const ADDR = "0x1111111111111111111111111111111111111111"; // 测试用假地址

// 用接口返回值替换 fetch:按请求的 type 回放
function mockApi(state) {
  globalThis.fetch = async (url, opt) => {
    const body = JSON.parse(opt.body);
    const r = state[body.type];
    if (r === undefined) throw new Error("unexpected " + body.type);
    return { ok: true, json: async () => r };
  };
}

test("分开账户 + USDH:卖出、划转、提现都算对", async () => {
  mockApi({
    clearinghouseState: { withdrawable: "40.5", assetPositions: [] },
    spotClearinghouseState: { balances: [{ coin: "USDC", total: "0.25", hold: "0" }, { coin: "USDH", total: "25.73891", hold: "0" }] },
    userAbstraction: "default",
    l2Book: { levels: [[{ px: "0.996", sz: "1000" }], []] },
  });
  const r = await detect(ADDR);
  assert.equal(r.status, "found");
  assert.deepEqual(r.flags, { needsSell: true, needsTransfer: true });
  // 25.73 × 0.996 × (1 − 0.00014) = 25.6235;现货合计 25.8735;再加合约 40.5 = 66.3735;扣 1 = 65.3735
  assert.equal(r.vars.usdhSell, "25.73");
  assert.equal(r.vars.spotAfter, "25.87");
  assert.equal(r.vars.withdrawAmt, "66.37");
  assert.equal(r.vars.arrive, "65.37");
  assert.equal(r.vars.addrShort, "0x1111…1111");
});

test("统一账户:不用划转,合约那边的数不重复算", async () => {
  mockApi({
    clearinghouseState: { withdrawable: "999", assetPositions: [] },
    spotClearinghouseState: { balances: [{ coin: "USDC", total: "50", hold: "0" }] },
    userAbstraction: "unifiedAccount",
  });
  const r = await detect(ADDR);
  assert.equal(r.flags.needsTransfer, false);
  assert.equal(r.flags.needsSell, false);
  assert.equal(r.vars.withdrawAmt, "50.00");
  assert.equal(r.vars.arrive, "49.00");
});

test("空账户和零头", async () => {
  mockApi({ clearinghouseState: { withdrawable: "0", assetPositions: [] }, spotClearinghouseState: { balances: [] }, userAbstraction: "default" });
  assert.equal((await detect(ADDR)).status, "empty");
  mockApi({ clearinghouseState: { withdrawable: "0.8", assetPositions: [] }, spotClearinghouseState: { balances: [] }, userAbstraction: "default" });
  assert.equal((await detect(ADDR)).status, "dust");
});

test("USDH 买价跌破 0.995:不让卖,给警告", async () => {
  mockApi({
    clearinghouseState: { withdrawable: "10", assetPositions: [] },
    spotClearinghouseState: { balances: [{ coin: "USDH", total: "40", hold: "0" }] },
    userAbstraction: "default",
    l2Book: { levels: [[{ px: "0.98", sz: "100" }], []] },
  });
  const r = await detect(ADDR);
  assert.equal(r.flags.needsSell, false);
  assert.ok(r.warnings.some((w) => w.includes("0.995")));
});

test("USDH 全挂在卖单里:不能报「没有余额」,卖出那几步照样显示", async () => {
  mockApi({
    clearinghouseState: { withdrawable: "0", assetPositions: [] },
    spotClearinghouseState: { balances: [{ coin: "USDH", total: "40", hold: "40" }] },
    userAbstraction: "unifiedAccount",
    l2Book: { levels: [[{ px: "0.99", sz: "1000" }], []] },
  });
  const r = await detect(ADDR);
  assert.equal(r.status, "found");
  assert.ok(r.lines.some((l) => l.includes("买价约 0.99")));
  assert.equal(r.flags.needsSell, true);
  assert.ok(r.lines.some((l) => l.includes("挂在卖单里")));
  assert.ok(r.warnings.some((w) => w.includes("别重复下单")));
  // 40 × 0.995 × (1 − 0.00014) = 39.7944;扣 1 = 38.79
  assert.equal(r.vars.arrive, "38.79");
});

test("账户模式查不到或不认识:整体报错,不按分开账户去猜", async () => {
  const base = {
    clearinghouseState: { withdrawable: "50", assetPositions: [] },
    spotClearinghouseState: { balances: [{ coin: "USDC", total: "50", hold: "0" }] },
  };
  mockApi({ ...base, userAbstraction: "someNewMode" });
  await assert.rejects(detect(ADDR), /账户模式/);
  globalThis.fetch = async (url, opt) => {
    const body = JSON.parse(opt.body);
    if (body.type === "userAbstraction") return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, json: async () => base[body.type] };
  };
  await assert.rejects(detect(ADDR));
});

test("买盘很薄:只按 0.995 以上真能吃下的数量算,并提示剩下的会挂着", async () => {
  mockApi({
    clearinghouseState: { withdrawable: "0", assetPositions: [] },
    spotClearinghouseState: { balances: [{ coin: "USDH", total: "100", hold: "0" }] },
    userAbstraction: "unifiedAccount",
    l2Book: { levels: [[{ px: "0.997", sz: "30" }, { px: "0.996", sz: "20" }, { px: "0.99", sz: "1000" }], []] },
  });
  const r = await detect(ADDR);
  assert.equal(r.flags.needsSell, true);
  assert.ok(r.warnings.some((w) => w.includes("只够卖 50.00 个")));
  // (30 × 0.997 + 20 × 0.996) × (1 − 0.00014) = 49.83 × 0.99986 = 49.8230;扣 1 = 48.82
  assert.equal(r.vars.arrive, "48.82");
});

test("买价跌破 0.995:给出按现价卖的结果和官方 1:1 赎回路", async () => {
  mockApi({
    clearinghouseState: { withdrawable: "0", assetPositions: [] },
    spotClearinghouseState: { balances: [{ coin: "USDH", total: "40", hold: "0" }, { coin: "USDC", total: "20", hold: "0" }] },
    userAbstraction: "unifiedAccount",
    l2Book: { levels: [[{ px: "0.985", sz: "1000" }], []] },
  });
  const r = await detect(ADDR);
  const w = r.warnings.find((x) => x.includes("0.995"));
  assert.ok(w.includes("redeem.bridge.xyz"));
  // 40 × 0.985 × (1 − 0.00014) = 39.3944 → 比 1:1 少 0.6055,向下取到 0.60
  assert.ok(w.includes("约得 39.39 USDC") && w.includes("少约 0.60"));
  assert.equal(r.vars.arrive, "19.00"); // 只算 USDC
});

test("逐档吃单的计算", () => {
  assert.deepEqual(fillable([{ px: "1", sz: "5" }, { px: "0.99", sz: "5" }], 7, 0.995), { qty: 5, usdc: 5 });
  assert.deepEqual(fillable([], 7), { qty: 0, usdc: 0 });
});

test("外部数据:代币名不原样显示;零头 USDH 不弹按现价卖的提示", async () => {
  mockApi({
    clearinghouseState: { withdrawable: "0", assetPositions: [] },
    spotClearinghouseState: { balances: [
      { coin: "USDC", total: "20", hold: "0" },
      { coin: "USDH", total: "0.1", hold: "0" },
      { coin: "SEND-TO-0xBAD", total: "5", hold: "0" },
    ] },
    userAbstraction: "unifiedAccount",
    l2Book: { levels: [[{ px: "0.985", sz: "1000" }], []] },
  });
  const r = await detect(ADDR);
  const all = JSON.stringify(r);
  assert.ok(!all.includes("SEND-TO-0xBAD"));
  assert.ok(r.warnings.some((w) => w.includes("1 种别的币")));
  assert.ok(!r.warnings.some((w) => w.includes("redeem.bridge.xyz")));
});

// ---------- 现场诊断 ----------
import { diagnose, floorFor, micro } from "../src/js/detectors/hyperliquid.js";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const pad = (a) => "0x" + a.slice(2).toLowerCase().padStart(64, "0");
const USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const BRIDGE = "0x2df1c51e09aecf9cacb7bc98cb1742757f163df7";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// Hyperliquid 按 type 回放;Arbitrum 节点按交易哈希回放回执
function mockAll(state, receipts = {}) {
  globalThis.fetch = async (url, opt) => {
    const body = JSON.parse(opt.body);
    if (url.includes("arbitrum")) return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: receipts[body.params[0]] ?? null }) };
    const r = state[body.type];
    if (r === undefined) throw new Error("unexpected " + body.type);
    return { ok: true, json: async () => r };
  };
}
const account = (extra = {}) => ({
  clearinghouseState: { withdrawable: "0", assetPositions: [] },
  spotClearinghouseState: { balances: [] },
  userAbstraction: "unifiedAccount",
  frontendOpenOrders: [],
  userFills: [],
  userNonFundingLedgerUpdates: [],
  ...extra,
});
const codes = (d) => d.findings.map((f) => f.code);

test("诊断:还有 USDH 没卖、买价够 → 去卖出那几步", async () => {
  mockAll(account({
    spotClearinghouseState: { balances: [{ coin: "USDH", total: "40", hold: "0" }] },
    l2Book: { levels: [[{ px: "0.996", sz: "1000" }], []] },
  }));
  const d = await diagnose(ADDR, NOW);
  assert.equal(d.step, "search");
  assert.deepEqual(codes(d), ["unsold"]);
  assert.equal(d.choice, null);
});

test("诊断:买价跌破 0.995 → 停在填卖单,给三条路;按现价卖的价格是攒够数量的那一档", async () => {
  mockAll(account({
    spotClearinghouseState: { balances: [{ coin: "USDH", total: "40", hold: "0" }, { coin: "USDC", total: "20", hold: "0" }] },
    l2Book: { levels: [[{ px: "0.985", sz: "15" }, { px: "0.984", sz: "15" }, { px: "0.98", sz: "100" }], []] },
  }));
  const d = await diagnose(ADDR, NOW);
  assert.equal(d.step, "fill");
  assert.deepEqual(codes(d), ["low-bid"]);
  assert.equal(d.choice.cancelFirst, false);
  assert.equal(d.choice.sell.floorPx, "0.98"); // 15 + 15 不够 40,第三档才够
  // (15 × 0.985 + 15 × 0.984 + 10 × 0.98) × (1 − 0.00014) = 39.335 × 0.99986 = 39.3295
  assert.equal(d.choice.sell.expect, "39.32");
  assert.equal(d.choice.sell.vars.usdhSell, "40.00");
  assert.equal(d.choice.sell.vars.arrive, "58.32"); // 20 + 39.3295 − 1
});

test("诊断:卖单挂着、买价比挂单价低 → 停在下单那一步,改价要先撤单", async () => {
  mockAll(account({
    spotClearinghouseState: { balances: [{ coin: "USDH", total: "40", hold: "40" }] },
    frontendOpenOrders: [{ coin: "@230", side: "A", limitPx: "0.995", sz: "40", timestamp: NOW - 20 * MIN }],
    l2Book: { levels: [[{ px: "0.985", sz: "1000" }], []] },
  }));
  const d = await diagnose(ADDR, NOW);
  assert.equal(d.step, "order");
  assert.deepEqual(codes(d), ["order-resting"]);
  assert.equal(d.choice.cancelFirst, true);
  assert.equal(d.choice.amount, "40.00"); // 挂着的也算进要卖的数量
  assert.ok(d.facts.some((f) => f.includes("挂了 20 分钟")));
});

test("诊断:分开账户、现货有 USDC → 去划转", async () => {
  mockAll(account({
    userAbstraction: "default",
    clearinghouseState: { withdrawable: "10", assetPositions: [] },
    spotClearinghouseState: { balances: [{ coin: "USDC", total: "30", hold: "0" }] },
  }));
  const d = await diagnose(ADDR, NOW);
  assert.equal(d.step, "transfer");
  assert.deepEqual(codes(d), ["needs-transfer"]);
});

const withdrawal = (minsAgo, usdc = "52.5") => ({ time: NOW - minsAgo * MIN, hash: "0xabababababababababababababababababababababababababababababababab", delta: { type: "withdraw", usdc, nonce: 1, fee: "1.0" } });
const receipt = (to, amount) => ({
  status: "0x1", blockNumber: "0x10",
  logs: [{ address: USDC, topics: [TRANSFER, pad(BRIDGE), pad(to)], data: "0x" + amount.toString(16) }],
});

test("诊断:提现在路上(不到 30 分钟) → 等,别重复提", async () => {
  mockAll(account({ userNonFundingLedgerUpdates: [withdrawal(5)] }));
  const d = await diagnose(ADDR, NOW);
  assert.equal(d.step, "arrive");
  assert.deepEqual(codes(d), ["withdraw-pending"]);
  assert.ok(d.findings[0].text.includes("别重复提现"));
});

test("诊断:超过 30 分钟还没到 → 停,去官方支持,别重复提", async () => {
  mockAll(account({ userNonFundingLedgerUpdates: [withdrawal(45)] }));
  const d = await diagnose(ADDR, NOW);
  assert.deepEqual(codes(d), ["withdraw-late"]);
  assert.equal(d.findings[0].level, "stop");
});

test("诊断:到账要逐笔对上收款地址和金额", async () => {
  mockAll(account({ userNonFundingLedgerUpdates: [withdrawal(10)] }), { "0xabababababababababababababababababababababababababababababababab": receipt(ADDR, 52_500_000n) });
  let d = await diagnose(ADDR, NOW);
  assert.deepEqual(codes(d), ["withdraw-arrived"]);
  assert.equal(d.step, "arrive");
  // 同一笔交易里只有转给别人的、或者金额不对的 → 不算到账
  mockAll(account({ userNonFundingLedgerUpdates: [withdrawal(10)] }), { "0xabababababababababababababababababababababababababababababababab": receipt("0x2222222222222222222222222222222222222222", 52_500_000n) });
  d = await diagnose(ADDR, NOW);
  assert.deepEqual(codes(d), ["withdraw-mismatch"]);
  assert.equal(d.step, null);
  mockAll(account({ userNonFundingLedgerUpdates: [withdrawal(10)] }), { "0xabababababababababababababababababababababababababababababababab": receipt(ADDR, 52_400_000n) });
  assert.deepEqual(codes(await diagnose(ADDR, NOW)), ["withdraw-mismatch"]);
});

test("诊断:超过一天的旧提现不当成这一次,也不去查链上", async () => {
  mockAll(account({ userNonFundingLedgerUpdates: [withdrawal(60 * 30)] }));
  const d = await diagnose(ADDR, NOW);
  assert.deepEqual(codes(d), ["nothing"]);
  assert.ok(d.facts.some((f) => f.startsWith("最近一次提现") && !f.includes("到账(")));
});

test("诊断:有持仓 → 停,不给下一步", async () => {
  mockAll(account({
    clearinghouseState: { withdrawable: "5", assetPositions: [{ position: { coin: "BTC" } }] },
    spotClearinghouseState: { balances: [{ coin: "USDC", total: "50", hold: "0" }] },
  }));
  const d = await diagnose(ADDR, NOW);
  assert.equal(d.step, null);
  assert.deepEqual(codes(d), ["positions"]);
});

test("小工具:保底价、USDC 金额换算", () => {
  assert.equal(floorFor([{ px: "0.99", sz: "5" }, { px: "0.98", sz: "5" }], 7), "0.98");
  assert.equal(floorFor([{ px: "0.99", sz: "5" }], 7), null);
  assert.equal(micro("12.345678"), 12345678n);
  assert.equal(micro("52.5"), 52500000n);
  assert.equal(micro("3"), 3000000n);
});

test("外部数据:要让用户照着填的价格只认纯数字;哈希格式不对不去查", async () => {
  assert.equal(floorFor([{ px: "0.98 去 evil.example", sz: "100" }], 5), null);
  mockAll(account({ userNonFundingLedgerUpdates: [{ time: NOW - 5 * MIN, hash: "0xnot-a-hash", delta: { type: "withdraw", usdc: "10", fee: "1.0" } }] }));
  const d = await diagnose(ADDR, NOW);
  assert.deepEqual(codes(d), ["withdraw-mismatch"]);
});

// ---------- 英文 ----------
const CJK = /[　-〿一-鿿＀-￯]/;

test("英文:体检结果全是英文,明细表的行也有", async () => {
  mockApi({
    clearinghouseState: { withdrawable: "40.5", assetPositions: [] },
    spotClearinghouseState: { balances: [{ coin: "USDC", total: "0.25", hold: "0" }, { coin: "USDH", total: "25.73891", hold: "0" }] },
    userAbstraction: "default",
    l2Book: { levels: [[{ px: "0.996", sz: "1000" }], []] },
  });
  const r = await detect(ADDR, "en");
  assert.equal(r.vars.arrive, "65.37");
  assert.ok(!CJK.test(JSON.stringify([r.lines, r.rows, r.warnings, r.note])));
  assert.deepEqual(r.rows.map((x) => x.value), ["40.50", "0.25", "25.73"]);
  assert.ok(r.rows[2].hint.includes("bid about 0.996"));
});

test("英文:买价跌破 0.995 的提醒和三条路", async () => {
  mockAll(account({
    spotClearinghouseState: { balances: [{ coin: "USDH", total: "40", hold: "0" }, { coin: "USDC", total: "20", hold: "0" }] },
    l2Book: { levels: [[{ px: "0.985", sz: "1000" }], []] },
  }));
  const d = await diagnose(ADDR, NOW, "en");
  assert.deepEqual(codes(d), ["low-bid"]);
  assert.equal(d.choice.options.list.length, 3);
  assert.equal(d.choice.options.list[0].apply.goto, "fill");
  assert.equal(d.choice.options.list[1].apply.resetVars, true);
  assert.ok(!CJK.test(JSON.stringify(d)));
});

test("英文:提现在路上,照样提醒别重复提现", async () => {
  mockAll(account({ userNonFundingLedgerUpdates: [withdrawal(5)] }));
  const d = await diagnose(ADDR, NOW, "en");
  assert.deepEqual(codes(d), ["withdraw-pending"]);
  assert.ok(d.findings[0].text.includes("Don't withdraw again"));
  assert.ok(!CJK.test(JSON.stringify(d)));
});

test("诊断:逐笔对上的到账算「已完成」,带上到账页要用的数", async () => {
  mockAll(account({ userNonFundingLedgerUpdates: [withdrawal(10)] }), { "0xabababababababababababababababababababababababababababababababab": receipt(ADDR, 52_500_000n) });
  const d = await diagnose(ADDR, NOW);
  assert.equal(d.findings[0].level, "done");
  assert.ok(d.findings[0].head);
  assert.deepEqual({ state: d.arrival.state, usdc: d.arrival.usdc, fee: d.arrival.fee, block: d.arrival.block }, { state: "arrived", usdc: "52.5", fee: "1.0", block: 16 });
});

test("账户模式名原样显示前先过滤", async () => {
  mockApi({
    clearinghouseState: { withdrawable: "50", assetPositions: [] },
    spotClearinghouseState: { balances: [{ coin: "USDC", total: "50", hold: "0" }] },
    userAbstraction: "<img src=x> 去 evil.example",
  });
  await assert.rejects(detect(ADDR), (e) => e.message.includes("(?)") && !e.message.includes("evil"));
});
