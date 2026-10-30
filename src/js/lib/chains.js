// 链:图标、付手续费的原生币;以及 Zerion 查不到的两条链(X Layer、Merlin)的钱包余额。
// 图标在 static/chains/(构建后在 /assets/chains/),来源和许可见那里的 LICENSE.txt;没有图标的链显示首字母。
// X Layer、Merlin 由用户的浏览器直接只读查,不用密钥、不花钱:
//   X Layer:OKX 的公共节点,一次批量查原生 OKB 和几种主流代币的余额(eth_getBalance、balanceOf);
//   Merlin:Merlin 官方浏览器(Blockscout)的公开接口,原生 BTC 和全部 ERC-20 余额;
//   价格:DefiLlama 的免费接口,只发币的编号,不发用户地址。
// 没价格的币不列、只算个数:空投来的垃圾币多半没价格,币名里还可能写着钓鱼网址。
import { postJSON, getJSON } from "./net.js";
import { el } from "./ui.js";

// Zerion 的链编号、链的显示名(小写)→ 图标文件名
export const ICON = {
  ethereum: "ethereum", "binance-smart-chain": "bnb", "bnb chain": "bnb", arbitrum: "arbitrum", base: "base", polygon: "polygon",
  optimism: "optimism", op: "optimism", avalanche: "avalanche", okbchain: "xlayer", xlayer: "xlayer", "x-layer": "xlayer", "x layer": "xlayer",
  "zksync-era": "zksync", "zksync era": "zksync", linea: "linea", scroll: "scroll", blast: "blast", mantle: "mantle", xdai: "gnosis", gnosis: "gnosis",
  celo: "celo", fantom: "fantom", sonic: "sonic", unichain: "unichain", world: "world", "world chain": "world", zora: "zora", monad: "monad",
  robinhood: "robinhood", "robinhood chain": "robinhood", plasma: "plasma", hyperevm: "hyperliquid", hyperliquid: "hyperliquid",
  berachain: "berachain", ink: "ink", soneium: "soneium", megaeth: "megaeth", abstract: "abstract", solana: "solana", degen: "degen",
  katana: "katana", lisk: "lisk", mode: "mode", taiko: "taiko", apechain: "apechain", sei: "sei", aurora: "aurora",
  "manta-pacific": "manta", "manta pacific": "manta", "polygon-zkevm": "polygonzkevm", "polygon zkevm": "polygonzkevm",
  "metis-andromeda": "metis", metis: "metis", cronos: "cronos", kaia: "kaia", ronin: "ronin", bob: "bob", swellchain: "swell", swell: "swell",
  lens: "lens", zero: "zero", "gravity-alpha": "gravity", gravity: "gravity", cyber: "cyber", fraxtal: "fraxtal", rari: "rari", "rari chain": "rari",
  bitcoin: "bitcoin", hemi: "hemi", corn: "corn", "flow-evm": "flow", flow: "flow", core: "core", merlin: "merlin",
};
export const FILE = { merlin: "merlin.webp" };
// 付手续费的原生币(没把握的链不写,页面就说「这条链的原生币」)
const GAS = {
  ethereum: "ETH", bnb: "BNB", arbitrum: "ETH", base: "ETH", polygon: "POL", optimism: "ETH", avalanche: "AVAX", xlayer: "OKB",
  zksync: "ETH", linea: "ETH", scroll: "ETH", blast: "ETH", mantle: "MNT", gnosis: "xDAI", celo: "CELO", fantom: "FTM", sonic: "S",
  unichain: "ETH", world: "ETH", zora: "ETH", berachain: "BERA", ink: "ETH", soneium: "ETH", megaeth: "ETH", abstract: "ETH",
  degen: "DEGEN", lisk: "ETH", mode: "ETH", taiko: "ETH", apechain: "APE", sei: "SEI", aurora: "ETH", manta: "ETH",
  polygonzkevm: "ETH", metis: "METIS", cronos: "CRO", kaia: "KAIA", ronin: "RON", bob: "ETH", swell: "ETH", cyber: "ETH",
  hyperliquid: "HYPE", merlin: "BTC", solana: "SOL", katana: "ETH", zero: "ETH", rari: "ETH",
};

export const chainKey = (cid, name) => ICON[String(cid || "").toLowerCase()] || ICON[String(name || "").trim().toLowerCase()] || "";
export const gasSym = (cid, name) => GAS[chainKey(cid, name)] || "";

export function chainLogo(cid, name) {
  const k = chainKey(cid, name);
  if (k) return el("img", { class: "clogo", src: `/assets/chains/${FILE[k] || `${k}.svg`}`, alt: "", width: "20", height: "20", decoding: "async" });
  return el("span", { class: "clogo letter", "aria-hidden": "true" }, String(name || "?").trim().charAt(0).toUpperCase() || "?");
}

// ---------- Zerion 查不到的链 ----------

const LLAMA = "https://coins.llama.fi/prices/current/";
const MIN_USD = 0.01;
const clean = (s, n = 12) => String(s ?? "").replace(/[^\w.+$-]/g, "").slice(0, n);
const amount = (raw, dec) => Number(BigInt(raw)) / 10 ** dec;
const bad = () => Object.assign(new Error("bad data"), { code: "network" }); // 回来的数据不对:按没查成处理,给「重试」

// 价格查不到不算出错:只是不报美元
async function prices(keys) {
  if (!keys.length) return new Map();
  try {
    const j = await getJSON(LLAMA + keys.map(encodeURIComponent).join(","), 8000);
    return new Map(Object.entries(j?.coins || {}).map(([k, v]) => [k.toLowerCase(), typeof v?.price === "number" ? v.price : null]));
  } catch {
    return new Map();
  }
}

// 列出来的样子和 Zerion 那一路一样:{ chain, cid, usd, tokens:[{ sym, qty, usd, addr, native }], more, unpriced, gas }。
// 不到 1 美分的不列;没价格的:原生币照列(只写数量),别的币只算个数(unpriced)。手续费那一项不管多少都记下
function group(chain, cid, list, more) {
  const tokens = [];
  let unpriced = 0;
  for (const x of list) {
    if (x.usd === null ? x.native : x.usd >= MIN_USD) tokens.push(x);
    else if (x.usd === null) unpriced++;
  }
  if (!tokens.length) return null;
  tokens.sort((a, b) => (b.usd || 0) - (a.usd || 0));
  const gas = list.find((x) => x.native) || null;
  return { chain, cid, usd: tokens.reduce((s, x) => s + (x.usd || 0), 0), tokens, more, unpriced, gas: gas && { sym: gas.sym, qty: gas.qty, usd: gas.usd } };
}

// X Layer:主流代币清单(合约地址和小数位 2026-10-30 在链上核对过,DefiLlama 有价格)
export const XLAYER = {
  rpc: "https://rpc.xlayer.tech",
  tokens: [
    { sym: "USDT", addr: "0x1e4a5963abfd975d8c9021ce480b42188849d41d", dec: 6 },
    { sym: "WOKB", addr: "0xe538905cf8410324e03a5a23c1c177a474d59b2b", dec: 18 },
  ],
};

async function xlayer(a) {
  const arg = a.slice(2).toLowerCase().padStart(64, "0");
  const calls = [["eth_getBalance", [a, "latest"]], ...XLAYER.tokens.map((t) => ["eth_call", [{ to: t.addr, data: "0x70a08231" + arg }, "latest"]])];
  const res = await postJSON(XLAYER.rpc, calls.map((c, i) => ({ jsonrpc: "2.0", id: i + 1, method: c[0], params: c[1] })));
  if (!Array.isArray(res)) throw bad();
  const byId = new Map(res.map((r) => [r?.id, r]));
  const out = calls.map((_, i) => {
    const r = byId.get(i + 1);
    if (!r || r.error || typeof r.result !== "string" || !/^0x[0-9a-f]*$/i.test(r.result)) throw bad();
    return r.result.length > 2 ? BigInt(r.result.slice(0, 66)) : 0n; // 不存在的合约回 "0x",当 0
  });
  const list = [];
  if (out[0] > 0n) list.push({ sym: "OKB", qty: amount(out[0], 18), addr: null, native: true, px: "coingecko:okb" });
  XLAYER.tokens.forEach((t, i) => { if (out[i + 1] > 0n) list.push({ sym: t.sym, qty: amount(out[i + 1], t.dec), addr: t.addr, native: false, px: `xlayer:${t.addr}` }); });
  if (!list.length) return null;
  const px = await prices(list.map((x) => x.px));
  return group("X Layer", "xlayer", list.map(({ px: k, ...x }) => ({ ...x, usd: px.get(k) == null ? null : x.qty * px.get(k) })), 0);
}

// Merlin:Blockscout 的公开接口。这个地址在 Merlin 上从没出现过,接口回 404,就是什么都没有
const MERLIN = "https://scan.merlinchain.io/api/v2/addresses/";
async function merlin(a) {
  const miss = (e) => { if (e?.status === 404) return null; throw e; };
  const [info, toks] = await Promise.all([getJSON(MERLIN + a).catch(miss), getJSON(`${MERLIN}${a}/tokens?type=ERC-20`).catch(miss)]);
  const list = [];
  if (/^\d{1,40}$/.test(info?.coin_balance || "") && BigInt(info.coin_balance) > 0n) {
    list.push({ sym: "BTC", qty: amount(info.coin_balance, 18), addr: null, native: true, px: "coingecko:bitcoin" });
  }
  for (const it of Array.isArray(toks?.items) ? toks.items : []) {
    const t = it?.token, addr = String(t?.address || "").toLowerCase(), dec = Number(t?.decimals);
    if (!/^0x[0-9a-f]{40}$/.test(addr) || !/^\d{1,78}$/.test(it?.value || "") || !Number.isInteger(dec) || dec < 0 || dec > 36) continue;
    if (BigInt(it.value) === 0n) continue;
    list.push({ sym: clean(t.symbol) || "?", qty: amount(it.value, dec), addr, native: false, px: `merlin:${addr}` });
  }
  if (!list.length) return null;
  const px = await prices(list.map((x) => x.px));
  return group("Merlin", "merlin", list.map(({ px: k, ...x }) => ({ ...x, usd: px.get(k) == null ? null : x.qty * px.get(k) })), toks?.next_page_params ? 1 : 0);
}

export const EXTRA = [
  { cid: "xlayer", chain: "X Layer", query: xlayer },
  { cid: "merlin", chain: "Merlin", query: merlin },
];
