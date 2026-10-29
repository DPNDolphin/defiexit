// 从钱包读地址(只读):只请钱包把地址告诉本页,不发起签名、代币授权或交易。
// 全站只有这里碰钱包,也只发 eth_requestAccounts 这一个请求;页面打开时不发,用户点了按钮才发。
// 钱包用 EIP-6963 找(多个钱包时让用户选,只问选中的那个);找不到再用老的 window.ethereum。
// 读到的地址只填进输入框,查不查、查哪个,还是用户自己点原来的按钮。
import { isEvmAddress, shortAddr } from "./net.js";
import { el, icon, setText } from "./ui.js";

const WAIT_MS = 120000; // 钱包弹窗一直没人理,两分钟后按钮恢复,迟到的结果作废

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

// 请钱包把地址告诉本页。只认 0x 开头、42 位的字符串;别的一律当没给
export async function askAddresses(provider) {
  const out = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(out)) return [];
  return [...new Set(out.filter((a) => typeof a === "string" && isEvmAddress(a)))];
}

// 在地址输入框下面放「从钱包读取地址」。找不到钱包就什么都不放
export async function mountWalletRead(input, t) {
  const wallets = await findWallets();
  if (!wallets.length || !input.isConnected) return;

  const btn = el("button", { class: "btn small", type: "button" }, icon("wallet"), t("walletRead"));
  const pick = el("div", { class: "wallet-pick", hidden: true });
  const msg = el("p", { class: "hint", role: "status" });
  const note = el("p", { class: "hint" }, t("walletNote"));
  input.after(el("div", { class: "wallet-read" }, btn, pick, msg, note));

  let busy = false, gen = 0;

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

  function use(a) {
    input.value = a;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    setText(msg, t("walletGot", shortAddr(a)));
  }

  async function read(w) {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    pick.hidden = true;
    setText(msg, t("walletWait"));
    const my = ++gen;
    const timer = setTimeout(() => {
      if (my !== gen) return;
      gen++;
      busy = false;
      btn.disabled = false;
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
    if (err) return setText(msg, err?.code === 4001 ? t("walletDenied") : t("walletNo"));
    if (!list.length) return setText(msg, t("walletNo"));
    if (list.length === 1) return use(list[0]);
    setText(msg, "");
    choices({ title: t("walletPickAddr"), list: list.map((a) => ({ label: shortAddr(a), value: a })) }, use);
  }

  btn.addEventListener("click", () => {
    if (wallets.length === 1) return read(wallets[0]);
    setText(msg, "");
    choices({ title: t("walletPick"), list: wallets.map((w, i) => ({ label: w.name || t("walletCurrent"), value: i })) }, (i) => read(wallets[i]));
  });
}
