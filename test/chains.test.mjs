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

test("项目仓位合并:同一笔用我们查到的(有专门取法);Zerion 还有别的仓位就留 Zerion 的;两边各有的都列", () => {
  const ours = (app, n, usd, how) => ({ app, chain: "X Layer", cid: "xlayer", how, items: Array(n).fill({}), usd });
  const zer = (app, n, usd, cid = "okbchain", chain = "X Layer") => ({ app, chain, cid, items: Array(n).fill({}), usd });

  // Zerion 的链编号(okbchain)、项目名写法和我们不一样,也要认出是同一笔:这时一定要留下取法
  const same = mergeDefi([zer("DYOR Swap", 2, 20)], [ours("DYORSwap", 2, 19, "dyorswap")]);
  assert.equal(same.length, 1);
  assert.equal(same[0].how, "dyorswap");
  assert.equal(same[0].usd, 19, "撤出时真实能拿回的数");

  // 我们这边美元价没查到:取法照留,金额用 Zerion 的
  const noPrice = mergeDefi([zer("DYORSwap", 2, 20)], [ours("DYORSwap", 2, 0, "dyorswap")]);
  assert.equal(noPrice[0].how, "dyorswap");
  assert.equal(noPrice[0].usd, 20);

  // Zerion 这笔多出别的池子:我们只核对过其中一个,不能顶掉,别的池子不能从清单上消失
  const more = mergeDefi([zer("DYORSwap", 4, 50)], [ours("DYORSwap", 2, 19, "dyorswap")]);
  assert.equal(more.length, 1);
  assert.equal(more[0].usd, 50);
  assert.equal(more[0].how, undefined);

  // 同名项目在别的链上、或者只有一边查到:不合并,都列,大的在前
  const both = mergeDefi([zer("DYORSwap", 2, 5, "base", "Base"), zer("OKX DEX", 2, 30)], [ours("DYORSwap", 2, 19, "dyorswap"), ours("OKX Boost", 1, 40, "okx-boost")]);
  assert.deepEqual(both.map((g) => [g.app, g.chain]), [["OKX Boost", "X Layer"], ["OKX DEX", "X Layer"], ["DYORSwap", "X Layer"], ["DYORSwap", "Base"]]);
});
