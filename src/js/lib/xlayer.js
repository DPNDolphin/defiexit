// X Layer:Zerion 查不到,浏览器直接只读问 OKX 的公共节点。一次 eth_call(Multicall3 的 aggregate3)查完:
//   钱包里的原生 OKB 和 10 种主流代币;
//   OKX Boost「Plasma X Launch」活动时锁在 TokenLocker 里的币(OKB、USDT0、USDG);
//   DYORSwap USDT_Bridged / WOKB 池子的 LP(在钱包里的,按撤出时真实能拿回的数算)。
// 公共节点一次批量最多 10 条、事件一次只能扫 100 个块,所以只按已知合约直接查。
// 合约、函数选择器、返回格式 2026-10-30 在链上核对过:TokenLocker、DYORSwap 工厂和路由在 OKX 浏览器上验证过源码,
// 都不是代理合约;池子就是工厂 getPair 返回的地址。代币清单的小数位都在链上读过,DefiLlama 都有价格。
import { postJSON, getJSON } from "./net.js";

export const RPC = "https://rpc.xlayer.tech";
const MULTICALL = "0xca11bde05977b3631167028862be2a173976ca11";
const OKB = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"; // TokenLocker 里原生 OKB 的写法
export const TOKENS = [
  { sym: "WOKB", addr: "0xe538905cf8410324e03a5a23c1c177a474d59b2b", dec: 18 },
  { sym: "USDT0", addr: "0x779ded0c9e1022225f8e0630b35a9b54be713736", dec: 6 },
  { sym: "USDT_Bridged", addr: "0x1e4a5963abfd975d8c9021ce480b42188849d41d", dec: 6 }, // 旧版 USDT,OKX 在逐步淘汰
  { sym: "USDC", addr: "0xb6ceceab302e2e4948951ee7843fc24e92933061", dec: 6 },          // Circle 原生
  { sym: "USDG", addr: "0x4ae46a509f6b1d9056937ba4500cb143933d2dc8", dec: 6 },
  { sym: "WETH", addr: "0x5a77f1443d16ee5761d310e38b62f77f726bc71c", dec: 18 },
  { sym: "WBTC", addr: "0xea034fb02eb1808c2cc3adbc15f447b93cbe08e1", dec: 8 },
  { sym: "xBTC", addr: "0xb7c00000bcdeef966b20b3d884b98e64d2b06b4f", dec: 8 },
  { sym: "xETH", addr: "0xe7b000003a45145decf8a28fc755ad5ec5ea025a", dec: 18 },
  { sym: "xSOL", addr: "0x505000008de8748dbd4422ff4687a4fc9beba15b", dec: 9 },
];
const tok = Object.fromEntries(TOKENS.map((t) => [t.sym, t]));
// OKX Boost 的锁仓合约(TokenLocker,没有管理员,过期多久都能取)。key 是活动编号:"lp:175" 后面用空格(不是 0)补满 32 字节
export const BOOST = {
  locker: "0xda63e89dd0632db71c89c031de11542c0795fd2b",
  key: "0x" + [..."lp:175".padEnd(32, " ")].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join(""),
  tokens: [{ sym: "OKB", addr: OKB, dec: 18, px: "coingecko:okb" }, { ...tok.USDT0, px: `xlayer:${tok.USDT0.addr}` }, { ...tok.USDG, px: `xlayer:${tok.USDG.addr}` }],
};
// DYORSwap(PancakeSwap V2 的分叉):USDT_Bridged / WOKB 池子
export const DYOR = {
  factory: "0x2ccadb1e437aa9cdc741574bda154686b1f04c09",
  router: "0x1e690f24f704672e44255013c2cb22fc04c46036",
  pair: "0x35c185563dfd328256a80aafc23822200719cd25",
};
const SEL = {
  getEthBalance: "0x4d2301cc", balanceOf: "0x70a08231", getLockInfo: "0x05ed942d",
  getReserves: "0x0902f1ac", totalSupply: "0x18160ddd", kLast: "0x7464fc3d", feeTo: "0x017e7e58", aggregate3: "0x82ad56cb",
  allowance: "0xdd62ed3e", nonces: "0x7ecebe00",
};

const bad = () => Object.assign(new Error("bad data"), { code: "network" });
const pad = (h) => h.padStart(64, "0");
const u = (n) => pad(BigInt(n).toString(16));
const arg = (a) => pad(a.slice(2).toLowerCase());

// aggregate3((address target, bool allowFailure, bytes callData)[]):每条都允许失败,失败的那条当查不到
export function encodeAggregate3(calls) {
  const tuples = calls.map(([to, data]) => {
    const body = data.slice(2), len = body.length / 2;
    return arg(to) + u(1) + u(0x60) + u(len) + body.padEnd(Math.ceil(len / 32) * 64, "0");
  });
  let off = calls.length * 32;
  const heads = tuples.map((x) => { const h = u(off); off += x.length / 2; return h; });
  return SEL.aggregate3 + u(0x20) + u(calls.length) + heads.join("") + tuples.join("");
}

// 回来的是 (bool success, bytes returnData)[];格式不对就整体报「没查成」
export function decodeAggregate3(hex, n) {
  if (typeof hex !== "string" || !/^0x([0-9a-f]{64})+$/i.test(hex)) throw bad();
  const h = hex.slice(2), size = h.length / 2;
  const num = (pos) => {
    if (pos < 0 || pos + 32 > size) throw bad();
    return Number(BigInt("0x" + h.slice(pos * 2, pos * 2 + 64)));
  };
  const base = num(0) + 32;
  if (num(base - 32) !== n) throw bad();
  return Array.from({ length: n }, (_, i) => {
    const t = base + num(base + i * 32), bo = t + num(t + 32), len = num(bo);
    if (bo + 32 + len > size) throw bad();
    return num(t) === 1 ? "0x" + h.slice((bo + 32) * 2, (bo + 32 + len) * 2) : null;
  });
}

const word = (hex, i = 0) => (hex && hex.length >= 2 + 64 * (i + 1) ? BigInt("0x" + hex.slice(2 + 64 * i, 2 + 64 * (i + 1))) : 0n);
const amount = (raw, dec) => Number(raw) / 10 ** dec;
// 整数平方根(和池子合约里的 Math.sqrt 一样向下取整)
function isqrt(n) {
  if (n < 2n) return n;
  let x = n, y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}

// 撤出 LP 时真实能拿回多少:池子先给协议补铸手续费 LP(PancakeSwap 的算法,协议拿手续费增长的 8/25),总量变大、份额变小
export function lpOut({ lp, r0, r1, supply, kLast, feeOn, bal0, bal1 }) {
  let total = supply;
  if (feeOn && kLast > 0n) {
    const rootK = isqrt(r0 * r1), rootKLast = isqrt(kLast);
    if (rootK > rootKLast) total += (supply * (rootK - rootKLast) * 8n) / (rootK * 17n + rootKLast * 8n);
  }
  return total > 0n ? [(bal0 * lp) / total, (bal1 * lp) / total] : [0n, 0n];
}

export async function prices(keys) {
  if (!keys.length) return new Map();
  try {
    const j = await getJSON("https://coins.llama.fi/prices/current/" + keys.map(encodeURIComponent).join(","), 12000);
    return new Map(Object.entries(j?.coins || {}).map(([k, v]) => [k.toLowerCase(), typeof v?.price === "number" ? v.price : null]));
  } catch {
    return new Map(); // 价格查不到不算出错,只是不报美元
  }
}

// → { wallet: [{ sym, qty, addr, native, px }], boost: [{ sym, qty, start, end, px }], dyor: { lp, usdt, wokb } | null }(都还没算美元)
export async function read(a) {
  const ua = arg(a);
  const calls = [
    [MULTICALL, SEL.getEthBalance + ua],
    ...TOKENS.map((t) => [t.addr, SEL.balanceOf + ua]),
    ...BOOST.tokens.map((t) => [BOOST.locker, SEL.getLockInfo + BOOST.key.slice(2) + ua + arg(t.addr)]),
    [DYOR.pair, SEL.balanceOf + ua], [DYOR.pair, SEL.getReserves], [DYOR.pair, SEL.totalSupply], [DYOR.pair, SEL.kLast],
    [DYOR.factory, SEL.feeTo], [tok.USDT_Bridged.addr, SEL.balanceOf + arg(DYOR.pair)], [tok.WOKB.addr, SEL.balanceOf + arg(DYOR.pair)],
  ];
  const res = await postJSON(RPC, { jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: MULTICALL, data: encodeAggregate3(calls) }, "latest"] });
  if (!res || res.error || typeof res.result !== "string") throw bad();
  const out = decodeAggregate3(res.result, calls.length);
  if (out[0] === null) throw bad(); // 原生余额都没查到:当这次没查成
  let i = 0;
  const wallet = [];
  const native = word(out[i++]);
  if (native > 0n) wallet.push({ sym: "OKB", qty: amount(native, 18), addr: null, native: true, px: "coingecko:okb" });
  for (const t of TOKENS) {
    const v = word(out[i++]);
    if (v > 0n) wallet.push({ sym: t.sym, qty: amount(v, t.dec), addr: t.addr, native: false, px: `xlayer:${t.addr}` });
  }
  const boost = [];
  for (const t of BOOST.tokens) {
    const r = out[i++];
    const amt = word(r, 0), lock = word(r, 1), start = word(r, 2);
    // unlock 以后合约只把数量清零,开始时间还留着:一定要看数量
    if (amt > 0n) boost.push({ sym: t.sym, qty: amount(amt, t.dec), start: Number(start), end: Number(start + lock), px: t.px });
  }
  const lp = word(out[i++]);
  const [rv, supply, kLast, feeTo, bal0, bal1] = out.slice(i, i + 6);
  let dyor = null;
  if (lp > 0n) {
    // 有 LP 就一定要算出真实能拿回的数:kLast、feeTo 缺了算出来的比真实的多,不能当真。少一条就整体报「没查成」,页面给重试
    if (![supply, kLast, feeTo, bal0, bal1].every((x) => x && x.length >= 2 + 64) || !rv || rv.length < 2 + 64 * 3) throw bad();
    const [o0, o1] = lpOut({ lp, r0: word(rv, 0), r1: word(rv, 1), supply: word(supply), kLast: word(kLast), feeOn: word(feeTo) !== 0n, bal0: word(bal0), bal1: word(bal1) });
    dyor = { lp: lp.toString(), usdt: amount(o0, tok.USDT_Bridged.dec), wokb: amount(o1, tok.WOKB.dec) };
  }
  return { wallet, boost, dyor };
}

// OKX Boost 指南的检测器用:只查这个地址在锁仓合约里的三种币,和钱包里付手续费的原生 OKB。
// → { gas, locks: [{ sym, px, qty, start, end }] };有一条没查到、或者回来的字段不全,就整体报错,不拿「查不到」当「没锁」
export async function readBoost(a) {
  const ua = arg(a);
  const calls = [[MULTICALL, SEL.getEthBalance + ua], ...BOOST.tokens.map((t) => [BOOST.locker, SEL.getLockInfo + BOOST.key.slice(2) + ua + arg(t.addr)])];
  const res = await postJSON(RPC, { jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: MULTICALL, data: encodeAggregate3(calls) }, "latest"] });
  if (!res || res.error || typeof res.result !== "string") throw bad();
  const out = decodeAggregate3(res.result, calls.length);
  // 余额 1 格;getLockInfo 回 4 格(数量、锁期、开始时间、是否锁着)。少一格都不算数:缺的格子会被当成 0,能把「锁着」看成「没锁过」
  if (out[0] === null || out[0].length < 2 + 64 || out.slice(1).some((x) => x === null || x.length < 2 + 64 * 4)) throw bad();
  const locks = BOOST.tokens.map((t, i) => {
    const r = out[i + 1];
    const lock = word(r, 1), start = word(r, 2);
    return { sym: t.sym, px: t.px, qty: amount(word(r, 0), t.dec), start: Number(start), end: Number(start + lock) };
  });
  return { gas: amount(word(out[0]), 18), locks };
}

// DYORSwap 指南的检测器用:钱包里付手续费的原生 OKB,这个地址的 LP,撤出时真实能拿回多少、网页上估的是多少,
// permit 用过几次(撤出时用过就加 1),当初加流动性时给路由的 USDT 授权还剩多少。
// → { gas, lp, usdt, wokb, pageUsdt, pageWokb, nonce, allowance, px };有一条没查到、或者回来的字段不全,就整体报错,不拿「查不到」当「没有」
export async function readDyor(a) {
  const ua = arg(a), usdt = tok.USDT_Bridged, wokb = tok.WOKB;
  const calls = [
    [MULTICALL, SEL.getEthBalance + ua], [DYOR.pair, SEL.balanceOf + ua], [DYOR.pair, SEL.nonces + ua], [usdt.addr, SEL.allowance + ua + arg(DYOR.router)],
    [DYOR.pair, SEL.getReserves], [DYOR.pair, SEL.totalSupply], [DYOR.pair, SEL.kLast], [DYOR.factory, SEL.feeTo],
    [usdt.addr, SEL.balanceOf + arg(DYOR.pair)], [wokb.addr, SEL.balanceOf + arg(DYOR.pair)],
  ];
  const res = await postJSON(RPC, { jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: MULTICALL, data: encodeAggregate3(calls) }, "latest"] });
  if (!res || res.error || typeof res.result !== "string") throw bad();
  const out = decodeAggregate3(res.result, calls.length);
  // getReserves 回 3 格,别的都是 1 格。少一格都不算数:缺的格子会被当成 0,能把「有 LP」看成「没有」
  if (out.some((x, i) => x === null || x.length < 2 + 64 * (i === 4 ? 3 : 1))) throw bad();
  const [gas, lp, nonce, allowance, rv, supply, kLast, feeTo, bal0, bal1] = out;
  const pool = { lp: word(lp), r0: word(rv, 0), r1: word(rv, 1), supply: word(supply), kLast: word(kLast), feeOn: word(feeTo) !== 0n, bal0: word(bal0), bal1: word(bal1) };
  const [o0, o1] = lpOut(pool);
  const [p0, p1] = lpOut({ ...pool, feeOn: false }); // 网页估的时候没算撤出时要补铸的手续费 LP
  return {
    gas: amount(word(gas), 18), lp: word(lp), nonce: word(nonce), allowance: word(allowance),
    usdt: amount(o0, usdt.dec), wokb: amount(o1, wokb.dec), pageUsdt: amount(p0, usdt.dec), pageWokb: amount(p1, wokb.dec),
    px: { usdt: `xlayer:${usdt.addr}`, okb: "coingecko:okb" },
  };
}

// 最近约 6 分钟里这个地址的解除质押事件(TokensUnlocked):拿到刚取出的准确数。
// 公共节点一次只能扫 100 个块(1 秒一块),批量请求很快就被限速,所以只查 4 段;查不到、被限速都返回 null,不影响别的结论
const UNLOCKED = "0xb22d6ea8fb37b3c28402a761528066018f1d5ea56b967fff8fd1f83c7f0df8e0"; // TokensUnlocked(bytes32,address,address,uint128)
export async function boostUnlocked(a, windows = 4) {
  try {
    const head = await postJSON(RPC, { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] });
    const top = parseInt(head?.result, 16);
    if (!Number.isFinite(top)) return null;
    const hex = (n) => "0x" + Math.max(n, 0).toString(16);
    const body = Array.from({ length: windows }, (_, k) => ({
      jsonrpc: "2.0", id: k + 1, method: "eth_getLogs",
      params: [{ fromBlock: hex(top - (k + 1) * 100 + 1), toBlock: hex(top - k * 100), address: BOOST.locker, topics: [UNLOCKED, BOOST.key, "0x" + arg(a)] }],
    }));
    const res = await postJSON(RPC, body);
    if (!Array.isArray(res)) return null;
    const items = [];
    for (const r of res) {
      for (const l of Array.isArray(r?.result) ? r.result : []) {
        const t = BOOST.tokens.find((x) => "0x" + arg(x.addr) === String(l.topics?.[3]).toLowerCase());
        if (!t || !/^0x[0-9a-f]{1,64}$/i.test(l.data)) continue;
        items.push({ sym: t.sym, qty: amount(BigInt(l.data), t.dec), block: parseInt(l.blockNumber, 16) });
      }
    }
    return items;
  } catch {
    return null;
  }
}

// 最近约 6 分钟里这个地址撤出 DYORSwap LP 的记录:LP 转回池子的 Transfer 事件 → 那笔交易的回执。
// LP 可以转给别人,清零不等于撤出来了,到账只认这里:回执成功、发给路由,同一笔里池子有 Burn,USDT 确实打到这个地址,路由把 WOKB 解包了(Withdrawal)。
// 原生 OKB 转账不出事件,路由的 USDT 和 OKB 打给同一个收款人,所以看解包就够;选了 Receive WOKB 的没有解包,算没查到,不说到账了 OKB。
// 公共节点一次只能扫 100 个块,批量请求很快就被限速,所以只查 4 段;没查成返回 null,查了没有返回空数组。→ [{ usdt, okb }]
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"; // Transfer(address,address,uint256)
const BURN = "0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496"; // Burn(address,uint256,uint256,address)
const WITHDRAWAL = "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65"; // Withdrawal(address,uint256)
export async function dyorRemoved(a, windows = 4) {
  try {
    const head = await postJSON(RPC, { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] });
    const top = parseInt(head?.result, 16);
    if (!Number.isFinite(top)) return null;
    const hex = (n) => "0x" + Math.max(n, 0).toString(16);
    const me = "0x" + arg(a);
    const body = Array.from({ length: windows }, (_, k) => ({
      jsonrpc: "2.0", id: k + 1, method: "eth_getLogs",
      params: [{ fromBlock: hex(top - (k + 1) * 100 + 1), toBlock: hex(top - k * 100), address: DYOR.pair, topics: [TRANSFER, me, "0x" + arg(DYOR.pair)] }],
    }));
    const res = await postJSON(RPC, body);
    if (!Array.isArray(res)) return null;
    const hashes = [...new Set(res.flatMap((r) => (Array.isArray(r?.result) ? r.result : []).map((l) => l.transactionHash)))];
    if (!hashes.length) return res.every((r) => Array.isArray(r?.result)) ? [] : null;
    const out = [];
    for (const h of hashes) {
      const r = await postJSON(RPC, { jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [h] });
      const logs = r?.result?.logs;
      if (r?.result?.status !== "0x1" || String(r.result.to).toLowerCase() !== DYOR.router || !Array.isArray(logs)) continue;
      const from = (l, addr, topic) => String(l.address).toLowerCase() === addr && l.topics?.[0] === topic;
      const uint = (l) => /^0x[0-9a-f]{64}$/i.test(l?.data || "");
      const paid = logs.find((l) => from(l, tok.USDT_Bridged.addr, TRANSFER) && String(l.topics?.[2]).toLowerCase() === me);
      const unwrap = logs.find((l) => from(l, tok.WOKB.addr, WITHDRAWAL) && String(l.topics?.[1]).toLowerCase() === "0x" + arg(DYOR.router));
      if (!logs.some((l) => from(l, DYOR.pair, BURN)) || !uint(paid) || !uint(unwrap)) continue;
      out.push({ usdt: amount(BigInt(paid.data), tok.USDT_Bridged.dec), okb: amount(BigInt(unwrap.data), tok.WOKB.dec) });
    }
    return out;
  } catch {
    return null;
  }
}

// 页面要的样子:钱包余额一组(和 Zerion 那一路一样),项目仓位一张张卡(带 how,取回弹层按它出专门的取法)
export async function query(a) {
  const { wallet, boost, dyor } = await read(a);
  const keys = new Set([...wallet, ...boost].map((x) => x.px));
  if (dyor) keys.add(`xlayer:${tok.USDT_Bridged.addr}`).add("coingecko:okb");
  const px = await prices([...keys]);
  const price = (k) => (px.get(k) == null ? null : px.get(k));
  const val = (qty, k) => (price(k) === null ? null : qty * price(k));
  const defi = [];
  if (boost.length) {
    const items = boost.map((x) => ({ type: "locked", mod: "locked", sym: x.sym, qty: x.qty, usd: val(x.qty, x.px) }));
    const end = Math.max(...boost.map((x) => x.end));
    defi.push({ app: "OKX Boost", chain: "X Layer", cid: "xlayer", how: "okx-boost", end, ready: Date.now() / 1000 >= end, debt: 0, items, usd: items.reduce((s, x) => s + (x.usd || 0), 0) });
  }
  if (dyor) {
    const items = [
      { type: "deposit", mod: "liquidity-pool", sym: "USDT_Bridged", addr: tok.USDT_Bridged.addr, qty: dyor.usdt, usd: val(dyor.usdt, `xlayer:${tok.USDT_Bridged.addr}`) },
      { type: "deposit", mod: "liquidity-pool", sym: "WOKB", addr: tok.WOKB.addr, qty: dyor.wokb, usd: val(dyor.wokb, "coingecko:okb") },
    ];
    defi.push({ app: "DYORSwap", chain: "X Layer", cid: "xlayer", how: "dyorswap", pool: DYOR.pair, debt: 0, items, usd: items.reduce((s, x) => s + (x.usd || 0), 0) });
  }
  return { wallet: wallet.map(({ px: k, ...x }) => ({ ...x, usd: val(x.qty, k) })), defi };
}
