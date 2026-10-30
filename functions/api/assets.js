// 全部资产(Cloudflare Pages Function,路径 /api/assets):页面发来一个地址 → 交给 Zerion 查它在各条链上的
// 钱包余额和存在项目里的仓位(存款、质押、锁仓、待领奖励、借款)→ 只回页面要显示的几样:链、项目、类型、币、数量、美元价值。
// 密钥只在服务端(Pages 机密 ZERION_API_KEY),浏览器拿不到;没配密钥就回 off,页面不显示这一块。
// 不存地址、不记地址:日志只记结果类型和条数。Zerion 看得到这个地址(页面上写了),看不到访客 IP。
// Zerion 把「DeFi 仓位」算进免费额度里 25% 的子额度,用完回 429:这里回 busy,页面说「稍后再查」。

export const ZERION = { url: "https://api.zerion.io/v1/wallets/", timeoutMs: 12000 };
const MIN_USD = 0.01; // 不到 1 美分的不单列,只算个数
const MAX_TOKENS = 8; // 每条链最多列 8 种币,其余只说「还有几种小额币」

// Zerion 的链编号 → 显示名;没列的把编号整理一下直接用
const CHAINS = {
  ethereum: "Ethereum", "binance-smart-chain": "BNB Chain", arbitrum: "Arbitrum", base: "Base", polygon: "Polygon",
  optimism: "OP", avalanche: "Avalanche", okbchain: "X Layer", "zksync-era": "zkSync Era", linea: "Linea", scroll: "Scroll",
  blast: "Blast", mantle: "Mantle", xdai: "Gnosis", celo: "Celo", fantom: "Fantom", sonic: "Sonic", unichain: "Unichain",
  world: "World Chain", zora: "Zora", monad: "Monad", robinhood: "Robinhood Chain", plasma: "Plasma", hyperevm: "HyperEVM",
  berachain: "Berachain", ink: "Ink", soneium: "Soneium", megaeth: "MegaETH", abstract: "Abstract", solana: "Solana",
  "x-layer": "X Layer", xlayer: "X Layer", merlin: "Merlin", degen: "Degen", "manta-pacific": "Manta Pacific",
  "polygon-zkevm": "Polygon zkEVM", "metis-andromeda": "Metis", "gravity-alpha": "Gravity", swellchain: "Swellchain",
  apechain: "ApeChain", ape: "ApeChain", bob: "BOB", zero: "ZERO", rari: "RARI Chain", sei: "Sei", kaia: "Kaia",
};
export const chainName = (id) => CHAINS[id] || String(id || "?").replace(/[-_]+/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
};
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const text = (s, n = 60) => String(s ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, n);
const slug = (s) => (/^[a-z0-9][a-z0-9-]{0,39}$/.test(s) ? s : "");

// 这个币在这条链上的合约地址:原生币(付手续费的 ETH、BNB、OKB…)Zerion 给 null;查不到就当不知道
function where(fi, cid) {
  const im = (Array.isArray(fi?.implementations) ? fi.implementations : []).find((i) => i?.chain_id === cid);
  if (!im) return { addr: null, native: false };
  if (im.address === null) return { addr: null, native: true };
  return { addr: /^0x[0-9a-fA-F]{40}$/.test(im.address) ? im.address.toLowerCase() : null, native: false };
}

// Zerion 的回复 → 页面要的样子。只认 displayable 的(份额凭证、垃圾币 Zerion 会标成 false)
// 页面拿去做「取回」:链编号(配图标)、币的合约地址(用户在钱包里「添加代币」用)、
// 这条链上有没有原生币付手续费(不到 1 美分也记下)、项目仓位是哪一类(存款、流动性、质押…)。
// Zerion 给的项目网址不传:没核对过,老项目的域名可能已经换了主人。
// 钱包里没价格的币(原生币除外)不列、只算个数:多半是空投来的仿冒币(和真币同名、整数个),列出来还给合约地址,等于帮骗子引路
export function shape(json) {
  const rows = Array.isArray(json?.data) ? json.data : [];
  const wallet = new Map(), defi = new Map(), gas = new Map();
  let dust = 0, unpriced = 0;
  for (const r of rows) {
    const a = r?.attributes;
    if (!a || a.flags?.displayable === false || a.flags?.is_trash) continue;
    const usd = num(a.value);
    const qty = num(a.quantity?.float);
    if (!qty) continue;
    const cid = slug(r.relationships?.chain?.data?.id);
    const chain = chainName(cid);
    const sym = text(a.fungible_info?.symbol, 20) || "?";
    const isWallet = a.position_type === "wallet" || !a.position_type;
    const w = isWallet ? where(a.fungible_info, cid) : null;
    if (w?.native) gas.set(chain, { sym, qty, usd });
    if (usd !== null && usd < MIN_USD) {
      dust++;
      continue;
    }
    if (isWallet) {
      if (usd === null && !w.native) {
        unpriced++;
        continue;
      }
      const g = wallet.get(chain) || { chain, cid, usd: 0, tokens: [] };
      g.usd += usd || 0;
      g.tokens.push({ sym, qty, usd, addr: w.addr, native: w.native });
      wallet.set(chain, g);
      continue;
    }
    const app = text(a.application_metadata?.name || a.protocol, 40) || "?";
    const k = `${app}\u0000${chain}`;
    const g = defi.get(k) || { app, chain, cid, usd: 0, debt: 0, items: [] };
    if (a.position_type === "loan") g.debt += usd || 0;
    else g.usd += usd || 0;
    g.items.push({ type: text(a.position_type, 16), mod: slug(String(a.protocol_module || "").replace(/_/g, "-")), sym, qty, usd });
    defi.set(k, g);
  }
  const byUsd = (x, y) => (y.usd || 0) - (x.usd || 0);
  const walletList = [...wallet.values()].sort(byUsd).map((g) => {
    const tokens = g.tokens.sort(byUsd);
    return { chain: g.chain, cid: g.cid, usd: g.usd, tokens: tokens.slice(0, MAX_TOKENS), more: Math.max(0, tokens.length - MAX_TOKENS), gas: gas.get(g.chain) || null };
  });
  const defiList = [...defi.values()].sort(byUsd).map((g) => ({ ...g, items: g.items.sort(byUsd) }));
  return {
    status: walletList.length || defiList.length ? "ok" : "empty",
    totals: { wallet: walletList.reduce((s, g) => s + g.usd, 0), defi: defiList.reduce((s, g) => s + g.usd, 0) },
    wallet: walletList,
    defi: defiList,
    dust,
    unpriced,
  };
}

export async function handle(request, env, f = fetch) {
  if (request.method !== "POST") return reply({ status: "bad" }, 405);
  const url = new URL(request.url);
  // 只给本站页面用:浏览器发 POST 一定带 Origin
  if (request.headers.get("Origin") !== url.origin) return reply({ status: "bad" }, 403);
  if (!/^application\/json\b/i.test(request.headers.get("Content-Type") || "")) return reply({ status: "bad" }, 415);
  const body = await request.text();
  if (body.length > 512) return reply({ status: "bad" }, 413);
  let a = "";
  try {
    a = String(JSON.parse(body)?.a || "");
  } catch { /* 下面按地址不对处理 */ }
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return reply({ status: "bad" }, 400);
  if (!env.ZERION_API_KEY) return reply({ status: "off" });

  const q = new URLSearchParams({ "filter[positions]": "no_filter", "filter[trash]": "only_non_trash", currency: "usd", sort: "value" });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Number(env.ZERION_TIMEOUT_MS) || ZERION.timeoutMs);
  let r;
  try {
    r = await f(`${ZERION.url}${a}/positions/?${q}`, {
      headers: { Accept: "application/json", Authorization: `Basic ${btoa(`${env.ZERION_API_KEY}:`)}` },
      signal: ctl.signal,
    });
  } catch (e) {
    const why = e?.name === "AbortError" ? "timeout" : "network";
    console.log(JSON.stringify({ assets: why }));
    return reply({ status: "error", why }, 504);
  } finally {
    clearTimeout(timer);
  }
  if (r.status === 429) {
    console.log(JSON.stringify({ assets: "busy" }));
    return reply({ status: "busy" }, 503);
  }
  if (!r.ok) {
    console.log(JSON.stringify({ assets: "upstream", code: r.status }));
    return reply({ status: "error", why: r.status === 401 || r.status === 403 ? "key" : "upstream" }, 502);
  }
  let out;
  try {
    out = shape(await r.json());
  } catch {
    console.log(JSON.stringify({ assets: "parse" }));
    return reply({ status: "error", why: "parse" }, 502);
  }
  console.log(JSON.stringify({ assets: out.status, wallet: out.wallet.length, defi: out.defi.length }));
  return reply(out);
}

export const onRequest = ({ request, env }) => handle(request, env);
