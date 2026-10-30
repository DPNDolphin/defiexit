import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { ICON, FILE, chainKey, gasSym, EXTRA, XLAYER } from "../src/js/lib/chains.js";

// 只用来测格式的假地址;下面的接口回复全是编的(这些测试不连网)
const A = "0x" + "4".repeat(40);
const word = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
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

test("X Layer:一次批量问公共节点(原生 OKB + 清单里的代币);价格问 DefiLlama,只发币的编号不发地址", async () => {
  const g = await withFetch((url, init) => {
    if (url === XLAYER.rpc) {
      const calls = JSON.parse(init.body);
      return json(calls.map((c) => ({ jsonrpc: "2.0", id: c.id, result: c.method === "eth_getBalance" ? "0x1bc16d674ec80000" : c.params[0].to === XLAYER.tokens[0].addr ? word(2500000) : "0x" })));
    }
    return json({ coins: { "coingecko:okb": { price: 100 }, [`xlayer:${XLAYER.tokens[0].addr}`]: { price: 1 } } });
  }, async (seen) => {
    const out = await query("xlayer")(A);
    assert.equal(seen.length, 2);
    const calls = JSON.parse(seen[0].init.body);
    assert.equal(calls[0].method, "eth_getBalance");
    assert.equal(calls.length, 1 + XLAYER.tokens.length);
    assert.ok(calls.slice(1).every((c) => c.method === "eth_call" && c.params[0].data === "0x70a08231" + A.slice(2).padStart(64, "0")));
    assert.ok(seen[1].url.startsWith("https://coins.llama.fi/prices/current/"));
    assert.ok(!seen[1].url.toLowerCase().includes(A.slice(2)), "价格请求里不带用户地址");
    return out;
  });
  assert.equal(g.chain, "X Layer");
  assert.equal(g.cid, "xlayer");
  assert.deepEqual(g.tokens.map((x) => [x.sym, x.qty, x.usd, x.native]), [["OKB", 2, 200, true], ["USDT", 2.5, 2.5, false]]);
  assert.equal(g.usd, 202.5);
  assert.deepEqual(g.gas, { sym: "OKB", qty: 2, usd: 200 });
});

test("X Layer:什么都没有就是 null(页面不列);节点回的数据不对就报「没查成」;价格查不到照样列原生币", async () => {
  const empty = (url, init) => json(JSON.parse(init.body).map((c) => ({ jsonrpc: "2.0", id: c.id, result: c.method === "eth_getBalance" ? "0x0" : word(0) })));
  assert.equal(await withFetch(empty, () => query("xlayer")(A)), null);
  const broken = (url, init) => json(JSON.parse(init.body).map((c) => ({ jsonrpc: "2.0", id: c.id, error: { code: -32000, message: "x" } })));
  await assert.rejects(withFetch(broken, () => query("xlayer")(A)), (e) => e.code === "network");
  const noPrice = (url, init) => (url === XLAYER.rpc
    ? json(JSON.parse(init.body).map((c) => ({ jsonrpc: "2.0", id: c.id, result: c.method === "eth_getBalance" ? "0xde0b6b3a7640000" : word(0) })))
    : json({}, 500));
  const g = await withFetch(noPrice, () => query("xlayer")(A));
  assert.deepEqual(g.tokens.map((x) => [x.sym, x.qty, x.usd]), [["OKB", 1, null]]);
});

test("Merlin:Blockscout 公开接口;地址从没出现过(404)就是 null;没价格的币不列只算个数,币名里的怪字符去掉", async () => {
  assert.equal(await withFetch(() => json({ message: "Not found" }, 404), () => query("merlin")(A)), null);
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
    return out;
  }));
  assert.deepEqual(g.tokens.map((x) => [x.sym, x.qty, x.usd]), [["BTC", 0.00005, 4], ["MERL", 2, 1]]);
  assert.equal(g.more, 1, "没价格的那种只算个数");
  assert.ok(!JSON.stringify(g).includes("fake"), "没价格的币名字都不带出来");
  assert.deepEqual(g.gas, { sym: "BTC", qty: 0.00005, usd: 4 });
});

test("体检结果页:有取回弹层;链图标拷进了网站", () => {
  for (const f of ["dist/check/index.html", "dist/en/check/index.html"]) {
    const h = readFileSync(f, "utf8");
    assert.ok(h.includes('<dialog class="sheet" id="exitSheet" aria-labelledby="exitH">'), f);
    assert.match(h, /<li data-id="woofi"[^>]*data-chain="arbitrum"/);
  }
  assert.ok(existsSync("dist/assets/chains/xlayer.svg") && existsSync("dist/assets/chains/merlin.webp"));
});
