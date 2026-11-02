// 首页:粘贴地址 → 去检查结果页(地址放在 # 后面,不会发给任何服务器)。
import "./site.js";
import { isEvmAddress } from "./lib/net.js";
import { setText } from "./lib/ui.js";
import { makeT, pageLang, prefix } from "./lib/i18n.js";
import { mountWalletRead } from "./lib/wallet.js";

const lang = pageLang(), t = makeT(lang);
const form = document.getElementById("scan");
const input = document.getElementById("addr");
const err = document.getElementById("addrErr");

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const a = input.value.replace(/\s+/g, "");
  if (!isEvmAddress(a)) {
    setText(err, t("badAddr"));
    err.hidden = false;
    input.setAttribute("aria-invalid", "true");
    input.focus();
    return;
  }
  location.href = `${prefix(lang)}/check/#a=${a}`;
});
input.addEventListener("input", () => {
  if (err.hidden) return;
  err.hidden = true;
  input.removeAttribute("aria-invalid");
});
// 在钱包里打开:自动读地址,读到就直接去体检,不用再点。
// 同一个标签页里只自动跳一次:从结果页返回、或点「换个地址再查」回来,只把地址填好,不再跳
function firstAutoGo() {
  if (performance.getEntriesByType?.("navigation")?.[0]?.type === "back_forward") return false;
  try {
    if (sessionStorage.getItem("dx-wallet-went")) return false;
    sessionStorage.setItem("dx-wallet-went", "1");
    return true;
  } catch {
    return false; // 记不住就不自动跳,免得来回跳
  }
}
mountWalletRead(input, t, {
  onAddress: (a, how) => {
    if (how === "auto" && !firstAutoGo()) return;
    location.href = `${prefix(lang)}/check/#a=${a}`;
  },
});
