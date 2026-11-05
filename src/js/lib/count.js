// 体检计数:数「有多少个不同的地址来体检过」,地址不出浏览器(服务端是 functions/api/hit.js,只存每天的总数)。
// 体检结果页三路都查完、至少一路查成了,调一次 countCheckup(地址):
//   1. 浏览器自己算地址的摘要(SHA-256 取前 16 位十六进制),只记在这个浏览器的本地存储里(dx-seen,最多记最近 500 个);
//   2. 这个浏览器没数过这个摘要:先记上,再给本站 /api/hit 发一个固定的 {"k":"checkup"}——不带地址、不带摘要、不带 cookie,没有任何编号;
//   3. 存不了(浏览器禁了本地存储、存满了)就不发:宁可少数,不重复数。换浏览器、清了浏览器数据再查同一个地址会再数一次,所以是约数。
// 管理员自己的浏览器不数(本地存储里记着 dx-owner):
//   - 登进运营台(defiexit.com/admin/,和主站是同一个网站,本地存储是同一份)时,admin/admin.js 自动记上;
//   - 钱包里的浏览器这种不登运营台的,打开一次 defiexit.com/#owner:site.js 记上,再把 #owner 从地址栏抹掉。
export const OWNER_KEY = "dx-owner", SEEN_KEY = "dx-seen", SEEN_MAX = 500;
export const HIT_BODY = '{"k":"checkup"}';

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
export function ping(f = globalThis.fetch) {
  try {
    f("/api/hit", { method: "POST", headers: { "Content-Type": "application/json" }, body: HIT_BODY, keepalive: true, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" }).catch(() => {});
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
