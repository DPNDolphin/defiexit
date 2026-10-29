// 从钱包读地址(只读):只请钱包把地址告诉本页,不发起签名、代币授权或交易。
// 全站只有这里碰钱包,也只发两种请求:eth_accounts(问已经共享给本站的地址,不弹窗)、
// eth_requestAccounts(请钱包共享地址;第一次会弹「连接」,那是钱包自己的确认,省不掉)。
// 能自动就自动,不让用户多点一下:
//   手机钱包的内置浏览器里打开:连过的直接读;没连过就直接请钱包共享(钱包弹一次「连接」);
//   电脑上装了钱包插件:连过的直接读;没连过不弹窗,给一个按钮;
//   用户拒绝过:这个标签页里不再自动弹,给按钮。
// 链接里已经带了地址、或者用户已经动手输入了,就不读、不覆盖。读到之后交给页面直接往下走(onAddress)。
// 钱包用 EIP-6963 找;只有一个钱包才自动,好几个让用户选,只问选中的那个。找不到 EIP-6963 再用老的 window.ethereum。
import { isEvmAddress, shortAddr } from "./net.js";
import { el, icon, setText } from "./ui.js";

const WAIT_MS = 120000; // 钱包弹窗一直没人理,两分钟后按钮恢复,迟到的结果作废
const NO_KEY = "dx-wallet-no"; // 这个标签页里用户拒绝过连接

// 找钱包:先等 EIP-6963 的回应;没有就看 window.ethereum。有的钱包注入得晚,再等一轮
export async function findWallets(win = window, waits = [350, 1200]) {
  const found = new Map();
  const on = (e) => {
    const d = e?.detail;
    if (!d || typeof d.provider?.request !== "function") return;
    const id = String(d.info?.uuid || `w${found.size}`);
    // 名字只当纯文字显示,不当身份证;图标不用
    if (!found.has(id)) found.set(id, { name: String(d.info?.name || "").trim().slice(0, 40), provider: d.provider });
  };
  win.addEventListener("eip6963:announceProvider", on);
  try {
    for (const ms of waits) {
      win.dispatchEvent(new Event("eip6963:requestProvider"));
      await new Promise((r) => setTimeout(r, ms));
      if (found.size) break;
      if (typeof win.ethereum?.request === "function") return [{ name: "", provider: win.ethereum }];
    }
  } finally {
    win.removeEventListener("eip6963:announceProvider", on);
  }
  return [...found.values()];
}

// 只认 0x 开头、42 位的字符串,去重;不是数组就当没给
const addresses = (out) => (Array.isArray(out) ? [...new Set(out.filter((a) => typeof a === "string" && isEvmAddress(a)))] : []);
// 已经共享给本站的地址(不弹窗;没连过就是空的)
export const sharedAddresses = async (provider) => addresses(await provider.request({ method: "eth_accounts" }));
// 请钱包把地址共享给本站(没连过的,钱包会弹「连接」)
export const askAddresses = async (provider) => addresses(await provider.request({ method: "eth_requestAccounts" }));

const session = (k, v) => {
  try {
    if (v === undefined) return sessionStorage.getItem(k);
    sessionStorage.setItem(k, v);
  } catch { /* 存不了就算了 */ }
  return null;
};
// 手机、平板(没有鼠标悬停):在钱包 App 的内置浏览器里
const inWalletApp = () => matchMedia("(hover: none) and (pointer: coarse)").matches;

// 挂在地址输入框下面。onAddress(地址, how):how 是 "auto"(打开时自动读到的)或 "click"(用户点了按钮)
export async function mountWalletRead(input, t, { auto = true, onAddress = null } = {}) {
  let typed = false;
  input.addEventListener("input", (e) => {
    if (e.isTrusted) typed = true;
  });
  const wallets = await findWallets();
  if (!wallets.length || !input.isConnected) return;

  const btn = el("button", { class: "btn small", type: "button" }, icon("wallet"), t("walletRead"));
  const pick = el("div", { class: "wallet-pick", hidden: true });
  const msg = el("p", { class: "hint", role: "status" });
  const note = el("p", { class: "hint" }, t("walletNote"));
  const box = el("div", { class: "wallet-read" }, btn, pick, msg, note);
  input.after(box);

  let busy = false, gen = 0;
  const showButton = (on) => {
    btn.hidden = note.hidden = !on;
  };
  const untouched = () => !typed && !input.value.trim();

  // 一排选项按钮:选钱包、或钱包给了好几个地址时选地址
  function choices(items, onPick) {
    pick.replaceChildren(el("p", { class: "hint" }, items.title), ...items.list.map((x) => {
      const b = el("button", { class: "btn small", type: "button" }, x.label);
      b.addEventListener("click", () => {
        pick.hidden = true;
        onPick(x.value);
      });
      return b;
    }));
    pick.hidden = false;
  }

  function use(a, how) {
    input.value = a;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    showButton(false);
    setText(msg, t("walletGot", shortAddr(a)));
    onAddress?.(a, how);
  }

  async function read(w, how) {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    pick.hidden = true;
    setText(msg, how === "auto" ? t("walletAuto") : t("walletWait"));
    const my = ++gen;
    const timer = setTimeout(() => {
      if (my !== gen) return;
      gen++;
      busy = false;
      btn.disabled = false;
      showButton(true);
      setText(msg, t("walletNo"));
    }, WAIT_MS);
    let list = [], err = null;
    try {
      list = await askAddresses(w.provider);
    } catch (e) {
      err = e;
    }
    clearTimeout(timer);
    if (my !== gen) return; // 已经超时作废了
    busy = false;
    btn.disabled = false;
    if (err || !list.length) {
      if (err?.code === 4001) session(NO_KEY, "1");
      showButton(true);
      return setText(msg, err?.code === 4001 ? t("walletDenied") : t("walletNo"));
    }
    // 自动读的时候用户已经动手输入了:不覆盖
    if (how === "auto" && !untouched()) return setText(msg, "");
    if (list.length === 1) return use(list[0], how);
    setText(msg, "");
    choices({ title: t("walletPickAddr"), list: list.map((a) => ({ label: shortAddr(a), value: a })) }, (a) => use(a, how));
  }

  btn.addEventListener("click", () => {
    if (wallets.length === 1) return read(wallets[0], "click");
    setText(msg, "");
    choices({ title: t("walletPick"), list: wallets.map((w, i) => ({ label: w.name || t("walletCurrent"), value: i })) }, (i) => read(wallets[i], "click"));
  });

  // 打开时自动读:只有一个钱包、链接没带地址、用户还没动手输入
  if (!auto || wallets.length !== 1 || !untouched()) return;
  showButton(false);
  let list = [];
  try {
    list = await sharedAddresses(wallets[0].provider);
  } catch { /* 当没连过 */ }
  if (!untouched()) return showButton(true);
  if (list.length) return use(list[0], "auto");
  if (inWalletApp() && session(NO_KEY) !== "1") return read(wallets[0], "auto");
  showButton(true);
}
