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
  });
  const r = await detect(ADDR);
  assert.equal(r.status, "found");
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
