import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { ICON, FILE, chainKey, gasSym, mergeDefi, EXTRA } from "../src/js/lib/chains.js";

// 只用来测格式的假地址;下面的接口回复全是编的(这些测试不连网)
const A = "0x" + "4".repeat(40);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const query = (cid) => EXTRA.find((c) => c.cid === cid).query;

async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url: String(url), init });
    return fake(String(url), init);
  };
  try {
    return await fn(seen);
  } finally {
    globalThis.fetch = real;
  }
}

test("链图标:Zerion 的链编号和显示名都认得;每个图标文件都在,没有图标的链给空(页面显示首字母)", () => {
  assert.equal(chainKey("arbitrum", "Arbitrum"), "arbitrum");
  assert.equal(chainKey("binance-smart-chain"), "bnb");
  assert.equal(chainKey(undefined, "X Layer"), "xlayer");
  assert.equal(chainKey("okbchain"), "xlayer");
  assert.equal(chainKey("merlin"), "merlin");
  assert.equal(chainKey("hyperliquid"), "hyperliquid");
  assert.equal(chainKey("ape", "ApeChain"), "apechain");
  assert.equal(chainKey("some-new-chain", "Some New Chain"), "");
  const files = new Set(readdirSync("static/chains"));
  for (const k of new Set(Object.values(ICON))) assert.ok(files.has(FILE[k] || `${k}.svg`), `缺图标 ${k}`);
  assert.ok(files.has("LICENSE.txt"), "图标的来源和许可");
  assert.equal(gasSym("linea"), "ETH");
  assert.equal(gasSym(undefined, "X Layer"), "OKB");
  assert.equal(gasSym("merlin"), "BTC");
  assert.equal(gasSym("some-new-chain"), "", "没把握的链不写");
});

test("链图标:SVG 里只有画图的东西——没有脚本、事件、外链", () => {
  for (const f of readdirSync("static/chains").filter((n) => n.endsWith(".svg"))) {
    const s = readFileSync(`static/chains/${f}`, "utf8");
    assert.ok(s.startsWith("<svg"), f);
    assert.ok(!/<script|<foreignObject|<image|\son\w+\s*=|javascript:|href="(?!#)|url\((?!#)/i.test(s), f);
  }
});

test("X Layer:清单里回 { wallet, defi };钱包余额按同样的规矩分组(细节在 xlayer.test.mjs)", async () => {
  const empty = await withFetch(() => json({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "x" } }), () => query("xlayer")(A).catch((e) => e));
  assert.equal(empty.code, "network");
});

test("Merlin:Blockscout 公开接口;地址从没出现过(404)就是 null;没价格的币不列只算个数,币名里的怪字符去掉", async () => {
  assert.deepEqual(await withFetch(() => json({ message: "Not found" }, 404), () => query("merlin")(A)), { wallet: null, defi: [] });
  const tokA = "0x" + "a".repeat(40), tokB = "0x" + "b".repeat(40);
  const g = await withFetch((url) => {
    if (url.endsWith(`/addresses/${A}`)) return json({ coin_balance: "50000000000000" });
    if (url.includes(`/addresses/${A}/tokens`)) return json({ items: [
      { token: { address: tokA, symbol: "MERL", decimals: "18" }, value: "2000000000000000000" },
      { token: { address: tokB, symbol: "Visit fake-site.com <b>", decimals: "18" }, value: "1000000000000000000000" },
    ], next_page_params: null });
    return json({ coins: { "coingecko:bitcoin": { price: 80000 }, [`merlin:${tokA}`]: { price: 0.5 } } });
  }, (seen) => query("merlin")(A).then((out) => {
    assert.ok(seen.slice(0, 2).every((s) => s.url.startsWith("https://scan.merlinchain.io/api/v2/addresses/")));
    assert.deepEqual(out.defi, []);
    return out.wallet;
  }));
  assert.deepEqual(g.tokens.map((x) => [x.sym, x.qty, x.usd]), [["BTC", 0.00005, 4], ["MERL", 2, 1]]);
  assert.equal(g.unpriced, 1, "没价格的那种只算个数");
  assert.ok(!JSON.stringify(g).includes("fake"), "没价格的币名字都不带出来");
  assert.deepEqual(g.gas, { sym: "BTC", qty: 0.00005, usd: 4 });
});

test("项目仓位合并:在 Zerion 那一笔里认出我们这个仓位。认出来用我们的;剩下的单列;认不出来两边都列,别的池子不能被删掉", () => {
  const A = "0x" + "a".repeat(40), B = "0x" + "b".repeat(40), C = "0x" + "c".repeat(40), D = "0x" + "d".repeat(40), PAIR = "0x" + "e".repeat(40);
  const coin = (sym, addr, usd, group = "", pool = null) => ({ sym, addr, usd, group, pool, qty: 1 });
  const pool = [coin("USDT_Bridged", A, 9.5), coin("WOKB", B, 9.5)]; // 我们查到的,币名和 Zerion 写的不一样
  const zer = (app, items, cid = "okbchain", chain = "X Layer") => ({ app, chain, cid, items, usd: items.reduce((s, x) => s + x.usd, 0) });
  const ours = (app, items, usd, how) => ({ app, chain: "X Layer", cid: "xlayer", how, pool: PAIR, items, usd });
  const mine = () => ours("DYORSwap", pool, 19, "dyorswap");
  const total = (list) => list.reduce((s, g) => s + g.usd, 0);
  const brief = (list) => list.map((g) => [g.usd, g.how]);

  // 分组对上:Zerion 的链编号(okbchain)、项目名写法、币名都和我们不一样,也要认出来,取法要留下,数用我们的
  const same = mergeDefi([zer("DYOR Swap", [coin("USDT", A, 10, "g1"), coin("WOKB", B, 10, "g1")])], [mine()]);
  assert.deepEqual(brief(same), [[19, "dyorswap"]]);

  // 我们这边美元价没查到:取法照留,金额用 Zerion 的
  const noPrice = mergeDefi([zer("DYORSwap", [coin("USDT", A, 10, "g1"), coin("WOKB", B, 10, "g1")])], [ours("DYORSwap", pool, 0, "dyorswap")]);
  assert.deepEqual(brief(noPrice), [[20, "dyorswap"]]);

  // 另一个池子,条目数还一样:不能拿我们的顶掉
  const other = mergeDefi([zer("DYORSwap", [coin("XYZ", C, 15.5, "g2"), coin("WOKB", B, 15.5, "g2")])], [mine()]);
  assert.deepEqual(brief(other), [[31, undefined], [19, "dyorswap"]]);

  // Zerion 把两个池子合成一笔:认出我们这组,另一组单列,一样不丢,钱也不重复算
  const both = mergeDefi([zer("DYORSwap", [coin("USDT", A, 10, "g1"), coin("WOKB", B, 10, "g1"), coin("XYZ", C, 15, "g2"), coin("WOKB", B, 15, "g2")])], [mine()]);
  assert.deepEqual(brief(both), [[30, undefined], [19, "dyorswap"]]);
  assert.deepEqual(both[0].items.map((x) => x.sym), ["XYZ", "WOKB"]);

  // 两个不相干的池子碰巧含着这两种币:不是我们这个池子,一条都不能删
  const twoPools = mergeDefi([zer("DYORSwap", [coin("USDT", A, 100, "g1"), coin("ABC", C, 100, "g1"), coin("WOKB", B, 100, "g2"), coin("XYZ", D, 100, "g2")])], [mine()]);
  assert.deepEqual(brief(twoPools), [[400, undefined], [19, "dyorswap"]]);
  assert.equal(twoPools[0].items.length, 4);

  // Zerion 给了池子地址:直接比池子地址
  const byPool = mergeDefi([zer("DYORSwap", [coin("USDT", A, 10, "g1", PAIR), coin("WOKB", B, 10, "g1", PAIR), coin("ABC", C, 5, "g2", "0x" + "1".repeat(40))])], [mine()]);
  assert.deepEqual(brief(byPool), [[19, "dyorswap"], [5, undefined]]);

  // 没有池子地址、也没有分组:整笔的币正好对上才算同一笔;对不上就两边都列
  const bare = mergeDefi([zer("DYORSwap", [coin("USDT", A, 10), coin("WOKB", B, 10)])], [mine()]);
  assert.deepEqual(brief(bare), [[19, "dyorswap"]]);
  const bareMore = mergeDefi([zer("DYORSwap", [coin("USDT", A, 10), coin("WOKB", B, 10), coin("XYZ", C, 5)])], [mine()]);
  assert.deepEqual(brief(bareMore), [[25, undefined], [19, "dyorswap"]]);
  assert.equal(total(bareMore), 44, "认不出来宁可多列一张,不删东西");

  // 没有合约地址的(原生 OKB、我们的 OKX Boost)比币名
  const boost = mergeDefi([zer("OKX Boost", [coin("OKB", null, 55)])], [{ ...ours("OKX Boost", [{ sym: "OKB", qty: 0.5, usd: 55 }], 55, "okx-boost"), pool: undefined }]);
  assert.deepEqual(brief(boost), [[55, "okx-boost"]]);

  // 同名项目在别的链上、或者只有一边查到:不合并,都列,大的在前
  const list = mergeDefi([zer("DYORSwap", [coin("USDT", A, 10, "g1"), coin("WOKB", B, 10, "g1")], "base", "Base"), zer("OKX DEX", [coin("XYZ", C, 31)])], [mine(), ours("OKX Boost", [{ sym: "OKB", qty: 1, usd: 40 }], 40, "okx-boost")]);
  assert.deepEqual(list.map((g) => [g.app, g.chain]), [["OKX Boost", "X Layer"], ["OKX DEX", "X Layer"], ["DYORSwap", "Base"], ["DYORSwap", "X Layer"]]);
});
