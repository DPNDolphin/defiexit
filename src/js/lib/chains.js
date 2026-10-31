// 链:图标、付手续费的原生币;以及 Zerion 查不到的两条链(X Layer、Merlin)。
// 图标在 static/chains/(构建后在 /assets/chains/),来源和许可见那里的 LICENSE.txt;没有图标的链显示首字母。
// X Layer、Merlin 由用户的浏览器直接只读查,不用密钥、不花钱:
//   X Layer:OKX 的公共节点,钱包余额加两类我们核对过的项目仓位(见 xlayer.js);
//   Merlin:Merlin 官方浏览器(Blockscout)的公开接口,原生 BTC 和全部 ERC-20 余额;
//   价格:DefiLlama 的免费接口,只发币的编号,不发用户地址。
// 没价格的币不列、只算个数:空投来的垃圾币多半没价格,币名里还可能写着钓鱼网址。
import { getJSON } from "./net.js";
import { el } from "./ui.js";
import { query as xlayerQuery } from "./xlayer.js";

// Zerion 的链编号、链的显示名(小写)→ 图标文件名
export const ICON = {
  ethereum: "ethereum", "binance-smart-chain": "bnb", "bnb chain": "bnb", arbitrum: "arbitrum", base: "base", polygon: "polygon",
  optimism: "optimism", op: "optimism", avalanche: "avalanche", okbchain: "xlayer", xlayer: "xlayer", "x-layer": "xlayer", "x layer": "xlayer",
  "zksync-era": "zksync", "zksync era": "zksync", linea: "linea", scroll: "scroll", blast: "blast", mantle: "mantle", xdai: "gnosis", gnosis: "gnosis",
  celo: "celo", fantom: "fantom", sonic: "sonic", unichain: "unichain", world: "world", "world chain": "world", zora: "zora", monad: "monad",
  robinhood: "robinhood", "robinhood chain": "robinhood", plasma: "plasma", hyperevm: "hyperliquid", hyperliquid: "hyperliquid",
  berachain: "berachain", ink: "ink", soneium: "soneium", megaeth: "megaeth", abstract: "abstract", solana: "solana", degen: "degen",
  katana: "katana", lisk: "lisk", mode: "mode", taiko: "taiko", apechain: "apechain", ape: "apechain", sei: "sei", aurora: "aurora", tempo: "tempo",
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

// 价格查不到不算出错:只是不报美元
async function prices(keys) {
  if (!keys.length) return new Map();
  try {
    const j = await getJSON(LLAMA + keys.map(encodeURIComponent).join(","), 12000);
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
  if (!list.length) return { wallet: null, defi: [] };
  const px = await prices(list.map((x) => x.px));
  return { wallet: group("Merlin", "merlin", list.map(({ px: k, ...x }) => ({ ...x, usd: px.get(k) == null ? null : x.qty * px.get(k) })), toks?.next_page_params ? 1 : 0), defi: [] };
}

async function xlayer(a) {
  const r = await xlayerQuery(a);
  return { wallet: group("X Layer", "xlayer", r.wallet, 0), defi: r.defi };
}

// 每条链查完都回 { wallet: 一组钱包余额或 null, defi: [项目仓位…] }
export const EXTRA = [
  { cid: "xlayer", chain: "X Layer", query: xlayer },
  { cid: "merlin", chain: "Merlin", query: merlin },
];

// Zerion 查到的项目 + 我们自己查到的。Zerion 把一个项目在一条链上的仓位合成一笔,我们只查核对过的那个仓位,所以要在那一笔里认出我们这个仓位:
//   Zerion 给了池子地址的,比池子地址;没给的,按 Zerion 的分组(同一个池子的条目 group 一样),整组的币要和我们的正好对上;
//   分组也没有,就是整笔的币要正好对上。币:有合约地址比合约,没有比币名。
// 认出来了:用我们的(带专门取法,数量也是撤出时真实能拿回的;美元价我们这边没查到就用 Zerion 的),这一笔剩下的条目单列,一样不丢,钱也不重复算。
// 认不出来:两边都列。宁可多列一张卡,也不能把别的池子删掉
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const sameApp = (g, x) => chainKey(g.cid, g.chain) === chainKey(x.cid, x.chain) && (norm(g.app).includes(norm(x.app)) || norm(x.app).includes(norm(g.app)));
const sameCoin = (a, b) => (a.addr && b.addr ? a.addr === b.addr : a.sym === b.sym);
const sumUsd = (items) => items.reduce((s, x) => s + (x.usd || 0), 0);
const sameCoins = (list, items) => list.length === items.length && items.every((x) => list.some((y) => sameCoin(x, y))) && list.every((y) => items.some((x) => sameCoin(x, y)));
function findPosition(g, x) {
  const byPool = g.items.filter((y) => x.pool && y.pool === x.pool);
  if (byPool.length) return byPool;
  const groups = new Map();
  for (const y of g.items) groups.set(y.group || "", [...(groups.get(y.group || "") || []), y]);
  return [...groups.values()].find((list) => sameCoins(list, x.items)) || null;
}
export function mergeDefi(z, more) {
  const rest = [...more], out = [];
  for (const g of z) {
    const i = rest.findIndex((x) => sameApp(g, x) && findPosition(g, x));
    if (i < 0) {
      out.push(g);
      continue;
    }
    const [x] = rest.splice(i, 1), mine = findPosition(g, x), left = g.items.filter((y) => !mine.includes(y));
    out.push({ ...x, usd: x.usd || sumUsd(mine) });
    if (left.length) out.push({ ...g, items: left, usd: sumUsd(left) });
  }
  return [...out, ...rest].sort((a, b) => b.usd - a.usd);
}
