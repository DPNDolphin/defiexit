// 体检计数:数「有多少个不同的地址来体检过」,地址不出浏览器(服务端是 functions/api/hit.js,只存每天的总数)。
// 体检结果页三路都查完、至少一路查成了,调一次 countCheckup(地址):
//   1. 浏览器自己算地址的摘要(SHA-256 取前 16 位十六进制),只记在这个浏览器的本地存储里(dx-seen,最多记最近 500 个);
//   2. 这个浏览器没数过这个摘要:先记上,再给本站 /api/hit 发一个固定的 {"k":"checkup"}——不带地址、不带摘要、不带 cookie,没有任何编号;
//   3. 存不了(浏览器禁了本地存储、存满了)就不发:宁可少数,不重复数。换浏览器、清了浏览器数据再查同一个地址会再数一次,所以是约数。
// 管理员自己的浏览器不数(本地存储里记着 dx-owner):
//   - 登进运营台(defiexit.com/admin/,和主站是同一个网站,本地存储是同一份)时,admin/admin.js 自动记上;
//   - 钱包里的浏览器这种不登运营台的,打开一次 defiexit.com/#owner:site.js 记上,再把 #owner 从地址栏抹掉。
export const OWNER_KEY = "dx-owner", SEEN_KEY = "dx-seen", SEEN_MAX = 500, VISIT_KEY = "dx-visit", OFF_KEY = "dx-count-off";
export const HIT_BODY = '{"k":"checkup"}', VIEW_BODY = '{"k":"view"}', VISIT_BODY = '{"k":"visit"}';

// 浏览器禁了本地存储时,连读 localStorage 这个属性都会报错
const local = () => {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
};

// 地址 → 摘要(大小写不同算同一个地址)。只在浏览器里用来去重,不发出去
export async function seenKey(addr, subtle = globalThis.crypto?.subtle) {
  const b = new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode("dx-seen-v1:" + String(addr).toLowerCase())));
  return [...b.subarray(0, 8)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// 这个浏览器该不该为这个摘要数一次:管理员的、数过的、存不了的都不数;该数的先记上(记不上也不数)
export function markNew(store, key) {
  try {
    if (store.getItem(OWNER_KEY) === "1") return false;
    let list;
    try {
      list = JSON.parse(store.getItem(SEEN_KEY) || "[]");
    } catch {
      list = [];
    }
    if (!Array.isArray(list)) list = [];
    if (list.includes(key)) return false;
    store.setItem(SEEN_KEY, JSON.stringify([...list, key].slice(-SEEN_MAX)));
    return true;
  } catch {
    return false;
  }
}

// 发计数:只发固定的那一小段,不带 cookie 和来源页;不等结果,出错也不管(不挡页面)。
// 用 fetch 的 keepalive(马上离开页面也能发完),不用 sendBeacon:sendBeacon 发的是 no-cors 请求,本站的 Referrer-Policy 是 no-referrer,
// 浏览器会把 Origin 写成 null,过不了服务端的同源检查(和 /api/assets 一样的检查)
// full:服务器回 429(今天数满了)时调一下(打开页面的计数用它记下「今天别再发」)
export function ping(f = globalThis.fetch, body = HIT_BODY, full = null) {
  try {
    f("/api/hit", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" })
      .then((r) => { if (full && r && r.status === 429) full(); }).catch(() => {});
  } catch { /* 发不出去就算了 */ }
}

// 体检查完调一次:该数就发。回 true = 发了
export async function countCheckup(addr, { store = local(), subtle = globalThis.crypto?.subtle, send = ping } = {}) {
  if (!store || !subtle) return false;
  try {
    if (!markNew(store, await seenKey(addr, subtle))) return false;
  } catch {
    return false;
  }
  send();
  return true;
}

// 打开页面的计数(每一页都调,site.js 在页面显示完以后调一次):
//   - 每打开一页发一个固定的 {"k":"view"};
//   - 这个浏览器今天(北京时间)还没来过:先在本地存储记上今天(dx-visit,只有日期),再发一个 {"k":"visit"},数「今天来了几个浏览器」;
//     存不了本地存储就不数 visit(宁可少数),view 照发;
//   - 管理员自己的浏览器(dx-owner)两样都不数。不带地址、编号、来源页和 cookie,不等结果,出错也不管;
//   - 服务器回过 429(今天数满了):本地存储记下今天(dx-count-off),这个浏览器今天不再发(少占请求额度)。
// 同时开着几个标签页时 visit 可能多数一个(读写本地存储没有跨标签页的锁),本来就是约数。回发了几个(0、1、2)
export function countView({ store = local(), send = null, now = Date.now() } = {}) {
  const day = new Date(now + 8 * 3600e3).toISOString().slice(0, 10);
  try {
    if (store && (store.getItem(OWNER_KEY) === "1" || store.getItem(OFF_KEY) === day)) return 0;
  } catch { /* 读不了:当不是管理员 */ }
  // 只往后记:过了零点,昨天那次晚到的 429 不能把今天的记号改回昨天
  const off = () => { try { if (store && !((store.getItem(OFF_KEY) || "") >= day)) store.setItem(OFF_KEY, day); } catch { /* 记不上就算了 */ } };
  if (!send) send = (body) => ping(globalThis.fetch, body, off);
  send(VIEW_BODY);
  try {
    if (!store || store.getItem(VISIT_KEY) === day) return 1;
    store.setItem(VISIT_KEY, day);
    if (store.getItem(VISIT_KEY) !== day) return 1;
  } catch {
    return 1;
  }
  send(VISIT_BODY);
  return 2;
}

// 给这个浏览器记上「管理员的」;记上了回 true
export function markOwner(store = local()) {
  try {
    store.setItem(OWNER_KEY, "1");
    return store.getItem(OWNER_KEY) === "1";
  } catch {
    return false;
  }
}

// 打开的是 …/#owner:记上管理员的浏览器,再把 #owner 从地址栏抹掉(# 后面的内容本来就不会发给服务器)
export function takeOwnerHash(loc = globalThis.location, hist = globalThis.history, store = local()) {
  if (loc?.hash !== "#owner") return false;
  try {
    hist.replaceState(null, "", loc.pathname + loc.search);
  } catch { /* 抹不掉也不影响 */ }
  return markOwner(store);
}
