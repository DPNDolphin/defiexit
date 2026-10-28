// WOOFi 检测器:只读 Arbitrum 公共节点(eth_call),算出质押的 WOO、没领的奖励、ETH 金库里已结算待取的钱。
// diagnose() 再查最近 4 小时转到用户钱包的记录(eth_getLogs),判断用户实际做到了哪一步、钱到没到。
// 合约、函数和事件都在 2026-10-28 对着 Sourcify 上的已验证源码和 woofi.com 前端代码核对过;
// 官网实际发出的三笔交易(发给谁、带什么数据)也用只读假钱包在官网上逐笔看过。
// 给用户看的话都在 woofi.text.js(中英两套),这里只管算。
import { postJSON, shortAddr, floorTo, fmt } from "../lib/net.js";
import { TEXT } from "./woofi.text.js";

const RPC = "https://arb1.arbitrum.io/rpc";
export const C = {
  manager: "0xa9e245c1fa7e17263cc7c896488a3da8072924fb",     // WooStakingManager:质押余额、待领奖励;官网的 Claim 发给它
  local: "0x2cfa72e7f58dc82b990529450ffa83791db7d8e2",       // WooStakingLocal:官网的 Unstake 发给它,WOO 从这里转回用户
  compounder: "0x63a015b5e305edca94b9b0c27461547b3f4ea1e3",  // WooStakingCompounder:开没开自动复投
  vault: "0xba452bcc4bc52af2fe1190e7e1dbe267ad1c2d08",       // ETH 金库(WooSuperChargerVault,份额币 weETH)
  withdrawMgr: "0xe77adf3936f70a2ed44f26ced01d26c1430ead6a", // ETH 金库取款合约:结算好的钱放在这里;官网的 WITHDRAW 发给它
  wooUsd: "0x5e2b5c5c07cca3437c4d724225bb42c7e55d1597",      // Chainlink WOO/USD(8 位小数)
  ethUsd: "0x639fe6ab55c921f74e7fac1ee960c0b6293ba612",      // Chainlink ETH/USD(8 位小数)
  arbUsd: "0xb2a824043730fe05f3da2efafa1cbbe83fa548d6",      // Chainlink ARB/USD(8 位小数)
};
const WOO = "0xcafcd85d8ca7ad1e1c6f82f651fa15e33aefd07b";
// 奖励币(pendingRewards 返回的币种)和发奖励的合约。两种 USDC 按 1 美元算,ARB 用喂价;
// 币种分开显示(USDC.e 是桥接版,到账也是 USDC.e,不能改名成 USDC)。不认识的币只报「另有 N 种」
const REWARD = {
  "0xaf88d065e77c8cc2239327c5edb3a432268e5831": { sym: "USDC", dec: 6, px: "one", from: "0xa6000b7d3634534266a2ecc4d478f5cdc1e65bd3" },
  "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8": { sym: "USDC.e", dec: 6, px: "one", from: "0x666e11ece9e03640d5df20f0bd0518e2c839d04c" },
  "0x912ce59144191c1204e64559fe8253a0e49e6548": { sym: "ARB", dec: 18, px: "arb", from: "0x401ff5f78b52edb57ab019c8988e0be933aaabcb" },
};
const MIN_REWARD = 0.01; // 每种奖励币不到 0.01 个就算零头(只提一句)
// 显示给用户核对的合约地址,用官方大小写(和指南核对卡上写的一样)
const SHOWN = {
  [C.local]: "0x2CFa…d8e2",
  [C.withdrawMgr]: "0xE77A…Ad6a",
  "0xa6000b7d3634534266a2ecc4d478f5cdc1e65bd3": "0xa600…5bD3",
  "0x666e11ece9e03640d5df20f0bd0518e2c839d04c": "0x666e…d04C",
  "0x401ff5f78b52edb57ab019c8988e0be933aaabcb": "0x401f…ABCb",
};
const shown = (a) => SHOWN[a] || shortAddr(a);
// 函数选择器:按函数签名算出(keccak256),和 4byte 以及官网实际发出的交易数据核对过
const SEL = {
  wooBalance: "0x78657429",              // wooBalance(address)
  pendingRewards: "0x31d7a262",          // pendingRewards(address) → (uint256 xp, address[] 币, uint256[] 数量)
  contains: "0x5dbe47e8",                // contains(address):在自动复投名单里
  withdrawAmount: "0x4f420151",          // withdrawAmount(address):结算好、等着取的 WETH(取出时给原生 ETH)
  balanceOf: "0x70a08231",               // balanceOf(address):钱包里的金库份额
  stakedShares: "0x0eb0c8f3",            // stakedShares(address):质押着的金库份额
  requestedWithdrawShares: "0x882c127e", // requestedWithdrawShares(address):申请了、还没结算的份额
  getPricePerFullShare: "0x77c7b8fc",    // 每份额值多少 ETH(18 位小数)
  latestRoundData: "0xfeaf968c",         // Chainlink:(roundId, answer, startedAt, updatedAt, answeredInRound)
};
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"; // ERC-20 Transfer
const WITHDRAWN = "0x884edad9ce6fa2440d8a54cc123490eb96d2768479d49ff9c7366125a9424364"; // 取款合约的 Withdraw(address,uint256)
const MIN_GAS = 0.0002;       // 官网前端的门槛:Arbitrum 上 ETH 少于这个数,按钮显示 INSUFFICIENT GAS
const STALE = 2 * 86400;      // 喂价两天没更新就不用它报美元
const LOG_SPAN = 30000;       // 公共节点一次 eth_getLogs 最多查 3 万个区块(约 2 小时)
const LOG_WINDOWS = 2;        // 查两段,约 4 小时

const text = (lang) => TEXT[lang] || TEXT.zh;
const arg = (a) => a.slice(2).toLowerCase().padStart(64, "0");

// 一次请求发多条查询(JSON-RPC 批量),按 id 对回去;任何一条出错都整体报错,不拿半截数据去算
// (optional 里的几条除外:比如喂价,查不到就不报美元,不影响查余额)
async function batch(calls, T, optional = []) {
  const body = calls.map((c, i) => ({ jsonrpc: "2.0", id: i + 1, method: c[0], params: c[1] }));
  const res = await postJSON(RPC, body);
  if (!Array.isArray(res)) throw new Error(T.rpcError);
  const byId = new Map(res.map((r) => [r.id, r]));
  return calls.map((_, i) => {
    const r = byId.get(i + 1);
    const ok = r && !r.error && (typeof r.result === "string" || Array.isArray(r.result));
    if (ok) return r.result;
    if (optional.includes(i)) return null;
    throw new Error(T.rpcError);
  });
}
const ethCall = (to, data) => ["eth_call", [{ to, data }, "latest"]];

// 返回值按 32 字节一格切开
function words(hex, T) {
  if (typeof hex !== "string" || !/^0x([0-9a-f]{64})*$/i.test(hex)) throw new Error(T.badData);
  return (hex.slice(2).match(/.{64}/g) || []).map((w) => BigInt("0x" + w));
}
// pendingRewards 的两个动态数组:币地址和数量。长度对不上或者大得离谱,就当数据不对
export function decodeRewards(hex, T = TEXT.zh) {
  const w = words(hex, T);
  const arr = (slot) => {
    const at = Number(w[slot] ?? -1n) / 32;
    const n = Number(w[at] ?? -1n);
    if (!Number.isInteger(at) || at < 3 || n < 0 || n > 16 || at + n > w.length - 1) throw new Error(T.badData);
    return w.slice(at + 1, at + 1 + n);
  };
  const tokens = arr(1).map((x) => "0x" + x.toString(16).padStart(40, "0"));
  const amounts = arr(2);
  if (amounts.length !== tokens.length) throw new Error(T.badData);
  return tokens.map((token, i) => ({ token, raw: amounts[i] }));
}
// 大整数按小数位换成普通数字(只用来显示和算「约」多少,不参与链上数额)
export const units = (raw, dec) => Number(raw / 10n ** BigInt(Math.max(dec - 9, 0))) / 10 ** Math.min(dec, 9);

// Chainlink 报价:查不到、格式不对、负数、零、两天没更新、时间在未来的,都不用
export function price(hex, T = TEXT.zh, now = Date.now() / 1000) {
  if (hex === null) return null;
  try {
    const w = words(hex, T);
    if (w.length < 5) return null;
    const answer = w[1], updatedAt = Number(w[3]);
    if (answer >> 255n || answer === 0n || now - updatedAt > STALE || updatedAt > now + 300) return null;
    return Number(answer) / 1e8;
  } catch {
    return null;
  }
}

async function load(user, T) {
  const [woo, pend, comp, avail, shares, staked, requested, pps, wooPx, ethPx, arbPx, gas] = await batch([
    ethCall(C.manager, SEL.wooBalance + arg(user)),
    ethCall(C.manager, SEL.pendingRewards + arg(user)),
    ethCall(C.compounder, SEL.contains + arg(user)),
    ethCall(C.withdrawMgr, SEL.withdrawAmount + arg(user)),
    ethCall(C.vault, SEL.balanceOf + arg(user)),
    ethCall(C.vault, SEL.stakedShares + arg(user)),
    ethCall(C.vault, SEL.requestedWithdrawShares + arg(user)),
    ethCall(C.vault, SEL.getPricePerFullShare),
    ethCall(C.wooUsd, SEL.latestRoundData),
    ethCall(C.ethUsd, SEL.latestRoundData),
    ethCall(C.arbUsd, SEL.latestRoundData),
    ["eth_getBalance", [user, "latest"]],
  ], T, [8, 9, 10]);
  const one = (hex) => words(hex, T)[0] ?? 0n;
  const px = { one: 1, arb: price(arbPx, T) };
  const rewards = [];
  let others = 0, dustToo = false;
  for (const r of decodeRewards(pend, T)) {
    const k = REWARD[r.token];
    if (!k) { if (r.raw > 0n) others++; continue; }
    const x = units(r.raw, k.dec);
    if (x >= MIN_REWARD) rewards.push({ sym: k.sym, amount: x, px: px[k.px] });
    else if (r.raw > 0n) dustToo = true;
  }
  return {
    woo: units(one(woo), 18),
    rewards, others, dustToo,
    auto: one(comp) !== 0n,
    avail: units(one(avail), 18),
    shareEth: units((one(shares) + one(staked)) * one(pps) / 10n ** 18n, 18),
    requested: one(requested) > 0n,
    wooPx: price(wooPx, T),
    ethPx: price(ethPx, T),
    gas: units(BigInt(gas), 18),
  };
}

const money = (x) => floorTo(x, 2).toFixed(2);
// 奖励币分开写:「2.23 USDC + 12.00 USDC.e」
const rewardText = (a) => a.rewards.map((r) => `${fmt(r.amount, 2)} ${r.sym}`).join(" + ");
const hasRewards = (a) => a.rewards.length > 0 || a.others > 0;
const hasWoo = (a) => a.woo >= 0.0001;
const todoOf = (a) => hasWoo(a) || hasRewards(a) || a.avail > 0;
// 金库里还有这份指南没写的钱:没申请取出的份额,或者申请了、还在等结算的
const leftoverOf = (a) => a.shareEth >= 0.000001 || a.requested;

// 能带着取的这几样,有喂价的折成美元;查不到喂价的不估价、原样列出来(「估不了价」不能当成「不值得取」)
function value(a) {
  let usd = 0;
  const unpriced = [];
  for (const r of a.rewards) {
    if (r.px) usd += r.amount * r.px;
    else unpriced.push(`${fmt(r.amount, 2)} ${r.sym}`);
  }
  if (hasWoo(a)) {
    if (a.wooPx) usd += a.woo * a.wooPx;
    else unpriced.push(`${fmt(a.woo, 4)} WOO`);
  }
  if (a.avail > 0) {
    if (a.ethPx) usd += a.avail * a.ethPx;
    else unpriced.push(`${fmt(a.avail, 6)} ETH`);
  }
  return { usd, unpriced };
}

function rows(a, T) {
  const out = [];
  if (hasWoo(a)) out.push({ label: T.row.woo, value: `${fmt(a.woo, 4)} WOO`, hint: a.wooPx ? T.row.about(money(a.woo * a.wooPx)) : null });
  if (a.rewards.length) out.push({ label: T.row.rewards, value: rewardText(a), hint: a.dustToo ? T.row.dustToo : null });
  if (a.avail > 0) out.push({ label: T.row.vault, value: `${fmt(a.avail, 6)} ETH`, hint: a.ethPx ? T.row.about(money(a.avail * a.ethPx)) : null });
  if (a.shareEth >= 0.000001) out.push({ label: T.row.shares, value: `${fmt(a.shareEth, 6)} ETH`, hint: T.row.notCovered });
  return out;
}

function lines(a, T) {
  const out = [];
  if (hasWoo(a)) out.push(T.line.woo(fmt(a.woo, 4)));
  if (a.rewards.length) out.push(T.line.rewards(rewardText(a)));
  if (a.avail > 0) out.push(T.line.vault(fmt(a.avail, 6)));
  if (a.shareEth >= 0.000001) out.push(T.line.shares(fmt(a.shareEth, 6)));
  if (a.requested) out.push(T.line.requested);
  out.push(T.line.auto(a.auto), T.line.gas(fmt(a.gas, 6)));
  return out;
}

export async function detect(address, lang = "zh") {
  const T = text(lang);
  const a = await load(address, T);
  const todo = todoOf(a), leftover = leftoverOf(a);
  const { usd, unpriced } = value(a);
  const warnings = [];
  if (a.auto) warnings.push(T.warn.autoCompound);
  if (todo && a.gas < MIN_GAS) warnings.push(T.warn.lowGas(fmt(a.gas, 6)));
  if (a.shareEth >= 0.000001) warnings.push(T.warn.shares(fmt(a.shareEth, 6)));
  if (a.requested) warnings.push(T.warn.requested);
  if (unpriced.length) warnings.push(T.warn.noPrice);
  if (a.others) warnings.push(T.warn.others(a.others));

  // 每笔手续费一般 1 美分多:估得出价、又不到 5 美分的,才算零头;估不了价的照样列出来让用户自己看
  const found = usd >= 0.05 || unpriced.length > 0 || a.others > 0;
  const status = found ? "found" : todo || leftover ? "dust" : "empty";
  // 只剩指南还没写的金库钱:不叫「零头」,按实际情况说(没申请的份额,还是在等结算)
  const only = status === "dust" && !todo ? (a.shareEth >= 0.000001 ? "shares" : "requested") : null;
  return {
    status,
    usd,
    rows: rows(a, T),
    total: { label: T.total, value: `$${money(usd)}${unpriced.map((x) => ` + ${x}`).join("")}` },
    lines: lines(a, T),
    warnings,
    note: status !== "dust" ? null : only ? T.note[only] : T.note.dust,
    badge: only ? T.badge[only] : null,
    // 开着自动复投时领奖励必然失败(!COMPOUND):不安排这一步,警告里说明
    flags: { needsClaim: hasRewards(a) && !a.auto, needsUnstake: hasWoo(a), needsVault: a.avail > 0 },
    vars: {
      addrShort: shortAddr(address),
      woo: fmt(a.woo, 4),
      rewards: a.rewards.length ? rewardText(a) : "0 USDC",
      eth: fmt(a.avail, 6),
    },
  };
}

// 最近约 4 小时转到用户钱包的 WOOFi 记录:WOO(质押合约转出)、奖励币(奖励合约转出)、ETH(取款合约的 Withdraw 事件)
export async function received(user, T = TEXT.zh) {
  const [head] = await batch([["eth_blockNumber", []]], T);
  const top = parseInt(head, 16);
  if (!Number.isFinite(top)) throw new Error(T.badData);
  const hex = (n) => "0x" + Math.max(n, 0).toString(16);
  const me = "0x" + arg(user);
  const froms = [C.local, ...Object.values(REWARD).map((r) => r.from)].map((x) => "0x" + arg(x));
  const calls = [];
  for (let k = 0; k < LOG_WINDOWS; k++) {
    const to = top - k * LOG_SPAN, from = to - LOG_SPAN + 1;
    calls.push(["eth_getLogs", [{ fromBlock: hex(from), toBlock: hex(to), address: [WOO, ...Object.keys(REWARD)], topics: [TRANSFER, froms, me] }]]);
    calls.push(["eth_getLogs", [{ fromBlock: hex(from), toBlock: hex(to), address: C.withdrawMgr, topics: [WITHDRAWN, me] }]]);
  }
  const logs = (await batch(calls, T)).flat();
  const items = [], seen = new Set();
  for (const l of logs) {
    // 两段区块不重叠,正常不会重复;节点要是多给了,按交易和序号去掉
    const key = `${l.transactionHash}:${l.logIndex}:${l.address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const addr = String(l.address).toLowerCase(), block = parseInt(l.blockNumber, 16);
    const raw = BigInt(/^0x[0-9a-f]{1,64}$/i.test(l.data) ? l.data : "0x0");
    if (raw === 0n) continue;
    if (addr === C.withdrawMgr) items.push({ kind: "eth", sym: "ETH", amount: fmt(units(raw, 18), 6), from: C.withdrawMgr, block });
    else if (addr === WOO) items.push({ kind: "woo", sym: "WOO", amount: fmt(units(raw, 18), 4), from: C.local, block });
    else if (REWARD[addr]) {
      const k = REWARD[addr];
      const x = units(raw, k.dec);
      if (x >= MIN_REWARD) items.push({ kind: "reward", sym: k.sym, amount: fmt(x, 2), from: "0x" + String(l.topics[1]).slice(26), block });
    }
  }
  const order = { woo: 0, reward: 1, eth: 2 };
  return items.sort((x, y) => order[x.kind] - order[y.kind] || x.block - y.block);
}

// 现场诊断:按指南的顺序,找第一件还没做完的事;能取的都取完了、金库里也没剩,再看最近有没有到账记录
export async function diagnose(address, now = Date.now(), lang = "zh") {
  const T = text(lang);
  const [a, got] = await Promise.all([load(address, T), received(address, T).catch(() => null)]);
  const facts = lines(a, T);
  const findings = [];
  const say = (code, level, msg) => findings.push({ code, level, head: T.head[code], text: msg });
  const todo = todoOf(a), leftover = leftoverOf(a);
  let step = null;

  if (todo && a.gas < MIN_GAS) say("low-gas", "stop", T.say.lowGas(fmt(a.gas, 6)));
  if (a.auto) say("auto-compound", "stop", T.say.autoCompound);
  if (hasRewards(a) && !a.auto) {
    step = "claim";
    say("can-claim", "ok", T.say.claim(a.rewards.length ? rewardText(a) : T.say.otherRewards(a.others)));
  } else if (hasWoo(a)) {
    step = "unstake";
    say("can-unstake", "ok", T.say.unstake(fmt(a.woo, 4)));
  } else if (a.avail > 0) {
    step = "vault";
    say("can-collect", "ok", T.say.collect(fmt(a.avail, 6)));
  }
  if (a.shareEth >= 0.000001) say("vault-shares", "info", T.say.shares(fmt(a.shareEth, 6)));
  if (a.requested) say("vault-requested", "wait", T.say.requested);

  const arr = (got || []).map((x) => ({
    ...x,
    text: x.kind === "woo" ? T.arr.woo(x.amount, shown(x.from), x.block)
      : x.kind === "eth" ? T.arr.eth(x.amount, shown(x.from), x.block)
      : T.arr.reward(x.amount, x.sym, shown(x.from), x.block),
  }));
  let arrival = null;
  if (!todo && !leftover && arr.length) {
    step = "arrive";
    // 绿色只给「已经完成」的事:能取的都取完了、金库里也没剩,而且链上查到了转进钱包的记录
    say("arrived", "done", T.say.arrived(T.arr.list(arr)));
    arrival = { state: "arrived", items: arr };
  } else if (!todo && arr.length) {
    // 已经到了几笔,但金库里还有钱没取完:只说到了哪几笔,不宣布「已经出来了」
    say("partial", "info", T.say.partial(T.arr.list(arr)));
  } else if (!todo && !leftover) {
    say(got ? "clear" : "nothing", "info", got ? T.say.clear : T.say.nothing);
  }
  if (!findings.length) say("nothing", "info", T.say.nothing);
  return { at: now, step, facts, findings, choice: null, arrival };
}
