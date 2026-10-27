import { test } from "node:test";
import assert from "node:assert/strict";
import { detect } from "../src/js/detectors/hyperliquid.js";

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
