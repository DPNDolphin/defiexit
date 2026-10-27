import { test } from "node:test";
import assert from "node:assert/strict";
import { zh } from "../src/js/lib/zh.js";

test("挨着汉字的标点换成全角", () => {
  assert.equal(zh("你好,世界;再见:明天"), "你好，世界；再见：明天");
  assert.equal(zh("签名(Sign),不是转账"), "签名（Sign），不是转账");
  assert.equal(zh("提现手续费 1 USDC;USDH 卖出"), "提现手续费 1 USDC；USDH 卖出");
  assert.equal(zh("**路线**:USDH 已停发"), "**路线**：USDH 已停发");
  assert.equal(zh("有没有被遗忘的钱?"), "有没有被遗忘的钱？");
});

test("图片说明开头的 ! 标记不动", () => {
  assert.equal(zh("! 黄框是官方提示"), "! 黄框是官方提示");
});

test("技术写法不动", () => {
  for (const s of ["hyperliquidChain: Mainnet", "USDC:0x6d1e…e054", "比 1:1 少", "https://app.hyperliquid.xyz", "买单 1,707.26 个"]) {
    assert.equal(zh(s), s);
  }
});
