// 截图求助(页面图鉴里的「发截图给 AI 认」):选图 → 竖向裁剪 → 在手机里重新生成一张新图 → 放大预览 + 两个勾 → 发送。
// 发出去的就是预览里那张新图;AI 只回编号。页面只显示我们审过的图和文字,不显示 AI 写的任何话;
// 认出普通页面后,用户还要并排对照、逐条核对文字特征,才显示审过的答案(答案只带路,签名照旧看核对卡)。
import { toast, setText } from "./lib/ui.js";

const MAX_W = 900, MAX_H = 1800, MAX_BYTES = 560 * 1024; // 服务端上限 600KB,留点余量
const SHOW_MAX = 1200;  // 裁剪时画在屏幕上的那张,最长边缩到这么大就够看
const MIN_KEEP = 0.1;   // 至少留 10% 的高度,免得两条边叠在一起
const WAIT_MS = 45000;
const ID = /^[a-z0-9-]{1,40}$/;

export function setupShot({ t, lang, picked, showAnswer }) {
  const $ = (id) => document.getElementById(id);
  const box = $("lostShot");
  if (!box) return null;
  const panels = ["shotPick", "shotCrop", "shotSend", "shotWait", "shotMatch", "shotMiss", "shotSecret"].map($);
  const file = $("shotFile"), cv = $("shotCv"), cropBox = $("shotCropBox");
  const hTop = cropBox.querySelector(".crop-h.top"), hBot = cropBox.querySelector(".crop-h.bot");
  const shTop = cropBox.querySelector(".crop-sh.top"), shBot = cropBox.querySelector(".crop-sh.bot");
  const prev = $("shotPrev"), go = $("shotGo"), yes = $("shotYes");
  const agrees = [...box.querySelectorAll("[data-agree]")];

  let img = null;        // 用户选的原图(只在这一页的内存里)
  let top = 0, bot = 1;  // 留下的那一段:从上往下的比例
  let out = null;        // 裁好、重新生成的那张(发出去的就是它)
  let urls = [];         // 本页生成的 blob 网址,用完就收回
  let matchId = null, busy = false, drag = null;

  const panel = (name) => { for (const p of panels) p.hidden = p.id !== name; };
  const blobUrl = (b) => { const u = URL.createObjectURL(b); urls.push(u); return u; };

  // 关掉、换图、重新开始:原图和新图都丢掉
  function reset() {
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
    img = out = matchId = null;
    top = 0;
    bot = 1;
    prev.removeAttribute("src");
    $("shotMine").removeAttribute("src");
    $("shotOurs").removeAttribute("src");
    $("shotFeats").replaceChildren();
    for (const a of agrees) a.checked = false;
    go.disabled = true;
    tsReset();
    panel("shotPick");
  }

  // ---------- 选图 ----------

  $("shotChoose").addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    if (!/^image\//.test(f.type || "image/")) return toast(t("shotFileBad"));
    const im = new Image();
    im.src = blobUrl(f);
    try {
      await im.decode();
    } catch {
      return toast(t("shotFileBad"));
    }
    if (!im.naturalWidth || !im.naturalHeight) return toast(t("shotFileBad"));
    img = im;
    const s = Math.min(1, SHOW_MAX / Math.max(im.naturalWidth, im.naturalHeight));
    cv.width = Math.max(1, Math.round(im.naturalWidth * s));
    cv.height = Math.max(1, Math.round(im.naturalHeight * s));
    cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
    top = 0;
    bot = 1;
    layout();
    panel("shotCrop");
    hBot.focus({ preventScroll: true });
  });

  // ---------- 竖向裁剪:上下两条边,拖动或者用方向键 ----------

  function layout() {
    shTop.style.height = `${top * 100}%`;
    shBot.style.height = `${(1 - bot) * 100}%`;
    hTop.style.top = `${top * 100}%`;
    hBot.style.top = `${bot * 100}%`;
    hTop.setAttribute("aria-valuenow", String(Math.round(top * 100)));
    hBot.setAttribute("aria-valuenow", String(Math.round(bot * 100)));
  }
  function move(h, y) {
    y = Math.max(0, Math.min(1, y));
    if (h === hTop) top = Math.min(y, bot - MIN_KEEP);
    else bot = Math.max(y, top + MIN_KEEP);
    layout();
  }
  for (const h of [hTop, hBot]) {
    h.addEventListener("pointerdown", (e) => {
      drag = h;
      h.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });
    h.addEventListener("pointermove", (e) => {
      if (drag !== h) return;
      const r = cropBox.getBoundingClientRect();
      if (r.height) move(h, (e.clientY - r.top) / r.height);
    });
    const end = () => { drag = null; };
    h.addEventListener("pointerup", end);
    h.addEventListener("pointercancel", end);
    h.addEventListener("keydown", (e) => {
      const d = { ArrowUp: -0.02, ArrowDown: 0.02, PageUp: -0.1, PageDown: 0.1 }[e.key];
      if (!d) return;
      e.preventDefault();
      move(h, (h === hTop ? top : bot) + d);
    });
  }

  // 按留下的那一段,从原图重新画一张新图(缩到够看清字就行,JPEG)。太大就降质量、再缩小
  async function encode() {
    const sw = img.naturalWidth, sy = Math.round(top * img.naturalHeight);
    const sh = Math.max(1, Math.round((bot - top) * img.naturalHeight));
    let scale = Math.min(1, MAX_W / sw, MAX_H / sh);
    for (let k = 0; k < 7; k++) {
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(sw * scale));
      c.height = Math.max(1, Math.round(sh * scale));
      const g = c.getContext("2d");
      g.fillStyle = "#fff"; // 透明的 PNG 垫白底
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, sy, sw, sh, 0, 0, c.width, c.height);
      const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", k < 2 ? 0.82 : 0.7));
      if (blob && blob.size <= MAX_BYTES) return blob;
      if (k >= 1) scale *= 0.8;
    }
    return null;
  }

  $("shotUse").addEventListener("click", async () => {
    if (!img) return panel("shotPick");
    out = await encode();
    if (!out) return toast(t("shotMakeFail"));
    prev.src = blobUrl(out);
    for (const a of agrees) a.checked = false;
    updateGo();
    panel("shotSend");
    tsInit();
  });

  // ---------- 两个勾(+ 配了的话人机验证)才能发 ----------

  function updateGo() {
    go.disabled = busy || !out || agrees.some((a) => !a.checked) || (needTs() && !tsToken);
  }
  for (const a of agrees) a.addEventListener("change", updateGo);

  const toDataUrl = (b) => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(b);
  });

  go.addEventListener("click", async () => {
    if (go.disabled || !out) return;
    busy = true;
    updateGo();
    panel("shotWait");
    let res = { screen: "none", why: "error" };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), WAIT_MS);
    try {
      const body = JSON.stringify({ r: box.dataset.r, v: box.dataset.v, img: await toDataUrl(out), ...(tsToken ? { ts: tsToken } : {}) });
      const r = await fetch("/api/see", { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: ctl.signal, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
      const j = await r.json().catch(() => null);
      if (j && typeof j.screen === "string") res = { screen: j.screen, why: typeof j.why === "string" ? j.why : "" };
      else if (r.status === 413) res = { screen: "none", why: "big" };
    } catch (e) {
      res = { screen: "none", why: e?.name === "AbortError" ? "timeout" : "error" };
    } finally {
      clearTimeout(timer);
      busy = false;
      tsReset();
    }
    result(res);
  });

  // ---------- 结果:只按编号显示我们自己的东西 ----------

  function result({ screen, why }) {
    const id = ID.test(screen) ? screen : "none";
    picked.add(`ai:${id === "none" ? why || "none" : id}`);
    if (id === "secret") return panel("shotSecret");
    const ans = id === "none" ? null : document.querySelector(`#lost [data-scr-a="${id}"]`);
    if (!ans) return miss(why || "none");
    // 停手的情况(域名不对、要签名授权、地区限制、地址被拦):答案只让停下,直接给
    if (ans.classList.contains("stop")) return showAnswer(id);
    const tpl = box.querySelector(`template[data-feat="${id}"]`);
    const ours = document.querySelector(`#lost [data-scr="${id}"] img`);
    if (!tpl || !ours) return miss("none");
    matchId = id;
    $("shotMine").src = prev.src;
    $("shotOurs").src = ours.currentSrc || ours.src;
    $("shotFeats").replaceChildren(tpl.content.cloneNode(true));
    updateYes();
    panel("shotMatch");
  }
  function updateYes() {
    const cks = [...$("shotFeats").querySelectorAll("[data-feat-ck]")];
    yes.disabled = !cks.length || cks.some((c) => !c.checked);
  }
  $("shotFeats").addEventListener("change", updateYes);
  yes.addEventListener("click", () => { if (matchId && !yes.disabled) showAnswer(matchId); });
  $("shotNo").addEventListener("click", () => miss("no"));

  function miss(why) {
    setText($("shotMissMsg"), t("shotMiss", why));
    panel("shotMiss");
  }

  for (const b of box.querySelectorAll("[data-shot-again]")) b.addEventListener("click", reset);

  // ---------- 人机验证(Turnstile):页面上配了站点密钥才加载,没配就跳过 ----------

  const sitekey = document.querySelector('meta[name="dx-turnstile"]')?.content || "";
  let tsToken = "", tsWidget = null, tsLoading = null;
  const needTs = () => !!sitekey;
  function loadTs() {
    if (window.turnstile) return Promise.resolve();
    return (tsLoading ||= new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = res;
      s.onerror = rej;
      document.head.append(s);
    }));
  }
  async function tsInit() {
    if (!sitekey) return;
    const holder = $("shotTs");
    holder.hidden = false;
    try {
      await loadTs();
      if (tsWidget === null) {
        tsWidget = window.turnstile.render(holder, {
          sitekey, language: lang === "en" ? "en" : "zh-cn",
          callback: (tok) => { tsToken = tok; updateGo(); },
          "expired-callback": () => { tsToken = ""; updateGo(); },
          "error-callback": () => { tsToken = ""; updateGo(); },
        });
      }
    } catch {
      tsToken = "";
      updateGo();
    }
  }
  function tsReset() {
    tsToken = "";
    if (tsWidget !== null && window.turnstile) window.turnstile.reset(tsWidget);
  }

  return { open: reset, close: reset };
}
