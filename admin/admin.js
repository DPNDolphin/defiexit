// 运营台(只在 admin 主机上打开):登录 → 读 /api/admin/state → 待发、收件、数据。管理员点的「已发 / 采纳」、改的草稿,
// 都经 /api/admin/* 存进数据库。页面里的评论、帖子是别人写的:一律用 textContent 放进页面,不当 HTML。
(function () {
  "use strict";
  const H8 = 8 * 3600e3;
  const pad = (n) => String(n).padStart(2, "0");
  const bjParts = (iso) => { const t = new Date(new Date(iso).getTime() + H8); return { mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes() }; };
  const md = (iso) => { const p = bjParts(iso); return pad(p.mo) + "-" + pad(p.d); };
  const mdhm = (iso, approx) => { const p = bjParts(iso); return md(iso) + " " + pad(p.h) + ":" + (approx ? String(p.mi).slice(0, 1) + "x" : pad(p.mi)); };
  const todayBJ = () => { const t = new Date(Date.now() + H8); return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()); };
  const daysUntil = (ymd) => { const [y, m, d] = String(ymd).split("-").map(Number); return Math.round((Date.UTC(y, m - 1, d) - todayBJ()) / 864e5); };
  const fmt = (n) => (typeof n === "number" ? n.toLocaleString("zh-CN") : "—");
  const $ = (id) => document.getElementById(id);

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const NS = "http://www.w3.org/2000/svg";
  function sv(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, String(v));
    for (const kid of kids) if (kid != null) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const out = (href, text) => h("a", { href, target: "_blank", rel: "noopener noreferrer" }, text);
  const safeUrl = (u) => (/^https:\/\/(x|twitter)\.com\//.test(String(u || "")) ? u : null);

  // X 计字:中日韩文字算 2,网址算 23(和 X 的规则一致,所以写「约」)
  function xLen(s) {
    const re = /https?:\/\/\S+/g;
    let n = (String(s).match(re) || []).length * 23;
    for (const ch of String(s).replace(re, "")) {
      const c = ch.codePointAt(0);
      n += c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037) ? 1 : 2;
    }
    return n;
  }
  const intent = (text, replyTo) => "https://x.com/intent/tweet?" + (/^\d{1,25}$/.test(String(replyTo || "")) ? "in_reply_to=" + replyTo + "&" : "") + "text=" + encodeURIComponent(text || "");

  // ---------- 接口 ----------
  async function api(path, body) {
    const opt = body === undefined
      ? { method: "GET", credentials: "same-origin", headers: { Accept: "application/json" } }
      : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) };
    let r;
    try { r = await fetch("/api/admin/" + path, opt); } catch (_) { return { status: 0, json: { error: "network" } }; }
    let json = {};
    try { json = await r.json(); } catch (_) { /* 空 */ }
    return { status: r.status, json };
  }
  const WHY = {
    network: "连不上服务器,看看网络再试", wrong: "用户名或密码不对", wait: "试错太多次了,等一会儿再试", code: "设置码不对",
    weak: "密码至少 20 位", mismatch: "两次输的密码不一样", exists: "管理员已经设过了,请登录", db: "数据库还没接上(Cloudflare 里的 D1 还没绑)",
    origin: "请求来源不对,刷新页面再试", login: "登录过期了,请重新登录", busy: "刚刷新过,两分钟后再点", bad: "内容不合格,没存",
    nocode: "Cloudflare 里的设置码(SETUP_CODE)还没加,或者不到 16 位", name: "用户名只能用字母、数字、汉字和 _ . -,最多 40 个", locked: "这条已经点过「已发 / 跳过」,先改回待发再改草稿",
    none: "这一条已经不在了,刷新一下", target: "这条没有目标帖子编号,不能发",
  };
  const why = (j) => WHY[j && (j.error || j.need)] || "出错了(" + ((j && (j.error || j.need)) || "未知") + "),再试一次";
  function note(el, msg, bad) {
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle("bad", !!bad);
    if (!bad) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 2500);
  }

  const S = { docs: {}, out: new Map(), inn: new Map(), cards: new Map(), ro: null, watchOff: new Set(), needs: [] };

  function show(view) {
    $("boot-msg").hidden = view !== "boot";
    $("setup").hidden = view !== "setup";
    $("login").hidden = view !== "login";
    $("desk").hidden = view !== "desk";
  }

  async function load() {
    const { status, json } = await api("state");
    if (status === 200 && json.ok) { show("desk"); apply(json); return; }
    if (json.need === "setup") return show("setup");
    if (json.need === "login" || status === 401) return show("login");
    show("boot");
    $("boot-msg").textContent = why(json);
  }

  async function save(kind, id, patch, msgEl) {
    const { status, json } = await api(kind, { id, ...patch });
    const ok = status === 200 && !!json.item;
    const el0 = S.cards.get((kind === "outbox" ? "out:" : "in:") + id);
    if (el0 && el0._saved) el0._saved(ok, "draft" in patch);
    if (ok) {
      (kind === "outbox" ? S.out : S.inn).set(id, json.item);
      const el = S.cards.get((kind === "outbox" ? "out:" : "in:") + id);
      if (el) el._update(json.item);
      renderTop();
      if (kind === "outbox") renderData();
      note(msgEl, "已存");
    } else if (status === 401) {
      show("login");
    } else note(msgEl, "没存上:" + why(json), true);
    return ok;
  }

  // 删除:先点一下变成「确定删除?再点一次」,3 秒内再点才删(按对方要求删数据时用)
  function delButton(kind, id, msgEl) {
    const b = h("button", { class: "linkbtn warn", type: "button" }, "删除这条");
    let armed = null;
    b.addEventListener("click", async () => {
      if (!armed) {
        b.textContent = "确定删除?再点一次";
        armed = setTimeout(() => { armed = null; b.textContent = "删除这条"; }, 3000);
        return;
      }
      clearTimeout(armed);
      armed = null;
      const { status, json } = await api("delete", { kind, id });
      if (status === 200 && json.ok) {
        (kind === "outbox" ? S.out : S.inn).delete(id);
        sync(kind === "outbox" ? "out" : "in");
        renderTop();
      } else note(msgEl, "没删掉:" + why(json), true);
    });
    return b;
  }

  // ---------- 待发卡片 ----------
  const OUT_STATUS = { "待发": "hi", "已发": "ok", "跳过": "mute" };
  function outCard(id) {
    const ta = h("textarea", { id: "draft-" + id, "aria-label": "回复草稿,可以直接改" });
    const count = h("span", { class: "count" });
    const restore = h("button", { class: "linkbtn", type: "button", hidden: true }, "用回我原来写的");
    const open = h("a", { class: "btn primary wide", target: "_blank", rel: "noopener noreferrer" }, "在 X 打开,字已填好 ↗");
    const copy = h("button", { class: "btn", type: "button" }, "复制");
    const sent = h("button", { class: "btn", type: "button" }, "已发");
    const skip = h("button", { class: "btn", type: "button" }, "跳过");
    const back = h("button", { class: "btn", type: "button", hidden: true }, "改回待发");
    const status = h("span", { class: "pill" });
    const memo = h("input", { type: "text", id: "memo-out-" + id, placeholder: "备注(可不填)", "aria-label": "备注", maxlength: "500" });
    const saved = h("span", { class: "saved", "aria-live": "polite" });
    const head = h("div", { class: "meta-row" });
    const chips = h("div", { class: "chips" });
    const kv = h("dl", { class: "kv" });
    const link = h("p", { class: "count" });
    const el = h("article", { class: "card", "data-id": id }, head, chips, kv,
      h("div", { class: "row" }, h("span", { class: "label" }, "我写的回复(可以直接改)"), h("span", { class: "grow" }), restore), ta,
      h("div", { class: "row" }, count, h("span", { class: "grow" }), copy),
      open,
      h("div", { class: "row" }, sent, skip, back, h("span", { class: "grow" }), status),
      link, memo, h("div", { class: "row" }, saved, h("span", { class: "grow" }), delButton("outbox", id, saved)));
    let timer = null, dirty = false;
    const target = () => (el._d && el._d.mine && el._d.mine.target) || {};
    const refresh = () => {
      const n = xLen(ta.value);
      count.textContent = "约 " + n + " / 280";
      count.classList.toggle("over", n > 280);
      const tid = target().id;
      if (/^\d{1,25}$/.test(String(tid || ""))) { open.href = intent(ta.value, tid); open.removeAttribute("aria-disabled"); open.classList.remove("off"); }
      else { open.removeAttribute("href"); open.setAttribute("aria-disabled", "true"); open.classList.add("off"); }
    };
    // 草稿存不上:字留在框里(dirty 设回去,之后的刷新不会盖掉),也不往下改状态
    const flush = async () => { clearTimeout(timer); if (!dirty) return true; dirty = false; return save("outbox", id, { draft: ta.value }, saved); };
    el._saved = (ok, wasDraft) => { if (wasDraft && !ok) dirty = true; };
    const decide = async (st) => {
      if (!(await flush())) return note(saved, "草稿没存上,先别点「" + st + "」;字还在框里", true);
      save("outbox", id, { status: st }, saved);
    };
    ta.addEventListener("input", () => { dirty = true; refresh(); clearTimeout(timer); timer = setTimeout(flush, 1200); });
    ta.addEventListener("blur", flush);
    restore.addEventListener("click", () => { dirty = false; save("outbox", id, { draft: null }, saved); });
    copy.addEventListener("click", () => {
      const fallback = () => { ta.focus(); ta.select(); note(saved, "已选中,长按复制"); };
      try { navigator.clipboard.writeText(ta.value).then(() => note(saved, "已复制"), fallback); } catch (_) { fallback(); }
    });
    sent.addEventListener("click", () => decide("已发"));
    skip.addEventListener("click", () => decide("跳过"));
    back.addEventListener("click", () => save("outbox", id, { status: "待发" }, saved));
    memo.addEventListener("change", () => save("outbox", id, { note: memo.value }, saved));
    el._update = (d) => {
      el._d = d;
      const m = d.mine || {}, t = m.target || {};
      head.replaceChildren(
        h("span", { class: "who" }, "回 @" + (t.handle || "?")),
        t.postedAt ? h("span", null, md(t.postedAt) + " 发的帖") : null,
        safeUrl(t.url) ? out(t.url, "看原帖 ↗") : null);
      chips.replaceChildren(...[t.protocol, t.chain, t.type].filter(Boolean).map((x) => h("span", { class: "chip" }, x)));
      kv.replaceChildren(
        h("dt", null, "卡在"), h("dd", null, t.summary || (d.purged ? "(30 天到了,原帖信息已删)" : "—")),
        m.why ? h("dt", null, "为什么回") : null, m.why ? h("dd", null, m.why) : null);
      const draft = d.draft_admin != null ? d.draft_admin : (m.draft || "");
      if (document.activeElement !== ta && !dirty && ta.value !== draft) ta.value = draft;
      restore.hidden = d.draft_admin == null;
      if (document.activeElement !== memo && memo.value !== (d.note || "")) memo.value = d.note || "";
      const st = d.status || "待发";
      status.className = "pill " + (OUT_STATUS[st] || "mute");
      status.textContent = st;
      sent.setAttribute("aria-pressed", String(st === "已发"));
      skip.setAttribute("aria-pressed", String(st === "跳过"));
      back.hidden = st === "待发";
      el.classList.toggle("done", st !== "待发");
      link.replaceChildren(st === "已发"
        ? (safeUrl(d.reply_url) ? h("span", null, "你的回复:", out(d.reply_url, "看 ↗")) : "你的回复链接:我下次干活时自己找到填上。")
        : "");
      refresh();
    };
    return el;
  }

  // ---------- 收件卡片 ----------
  const DECISIONS = ["采纳", "以后再说", "不采纳"];
  function inCard(id) {
    const head = h("div", { class: "meta-row" });
    const quote = h("blockquote", { class: "quote" });
    const kv = h("dl", { class: "kv" });
    const draftLabel = h("div", { class: "label" });
    const draftBox = h("div", { class: "quote" });
    const draftWrap = h("div", { class: "drafted" }, draftLabel, draftBox);
    const go = h("a", { class: "btn", target: "_blank", rel: "noopener noreferrer" }, "去 X 回复 ↗");
    const replied = h("button", { class: "btn", type: "button" }, "我已回复");
    const btns = DECISIONS.map((x) => h("button", { class: "btn", type: "button" }, x));
    const status = h("span", { class: "pill" });
    const memo = h("input", { type: "text", id: "memo-in-" + id, placeholder: "备注(可不填)", "aria-label": "备注", maxlength: "500" });
    const saved = h("span", { class: "saved", "aria-live": "polite" });
    const el = h("article", { class: "card", "data-id": id }, head, quote, kv, draftWrap,
      h("div", { class: "row" }, go, replied),
      h("div", { class: "label" }, "你的决定"),
      h("div", { class: "row" }, ...btns, h("span", { class: "grow" }), status),
      memo, h("div", { class: "row" }, saved, h("span", { class: "grow" }), delButton("inbox", id, saved)));
    btns.forEach((b, i) => b.addEventListener("click", () => save("inbox", id, { decision: DECISIONS[i] }, saved)));
    replied.addEventListener("click", () => save("inbox", id, { replied: true }, saved));
    memo.addEventListener("change", () => save("inbox", id, { note: memo.value }, saved));
    el._update = (d) => {
      el._d = d;
      const m = d.mine || {};
      head.replaceChildren(
        h("span", { class: "who" }, m.source || "评论"),
        h("span", null, "@" + (m.author || "?")),
        m.at ? h("span", null, mdhm(m.at)) : null,
        safeUrl(m.url) ? out(m.url, "看原帖 ↗") : null,
        d.replied ? h("span", { class: "pill ok" }, "已回复" + (d.replied_at ? " " + md(d.replied_at) : "")) : null);
      quote.textContent = d.text != null ? d.text : "(30 天到了,原文已删;需求摘要留在下面)";
      quote.classList.toggle("gone", d.text == null);
      kv.replaceChildren(
        h("dt", null, "类型"), h("dd", null, m.type || "等我分析"),
        h("dt", null, "背后的需求"), h("dd", null, m.need || (m.type ? "暂无明确需求" : "我下次干活时看")),
        h("dt", null, "我的建议"), h("dd", null, m.suggestion ? h("b", null, m.suggestion) : "—", m.suggestionWhy ? ":" + m.suggestionWhy : ""));
      draftLabel.textContent = m.yourReply ? "你回的" : "我起草的回复";
      draftBox.textContent = m.yourReply || m.draft || "";
      draftWrap.hidden = !(m.yourReply || m.draft);
      go.href = intent(m.draft, m.replyToId);
      go.hidden = !!d.replied || !m.draft;
      replied.hidden = !!d.replied || !m.draft;
      const dec = d.decision || null;
      btns.forEach((b, i) => b.setAttribute("aria-pressed", String(dec === DECISIONS[i])));
      status.className = "pill " + (dec ? "ok" : "warn");
      status.textContent = dec ? "你定了:" + dec : "等你定";
      if (document.activeElement !== memo && memo.value !== (d.note || "")) memo.value = d.note || "";
      el.classList.toggle("done", !!dec);
    };
    return el;
  }

  // 按顺序摆卡片:只在顺序变了才挪(挪动会让正在打字的框失焦)
  function sync(kind) {
    const box = $(kind === "out" ? "out-cards" : "in-cards");
    const store = kind === "out" ? S.out : S.inn;
    const rows = [...store.entries()];
    if (kind === "out") rows.sort((a, b) => ((a[1].status || "待发") === "待发" ? 0 : 1) - ((b[1].status || "待发") === "待发" ? 0 : 1) || String(a[1].created_at || "").localeCompare(String(b[1].created_at || "")));
    else rows.sort((a, b) => (a[1].decision ? 1 : 0) - (b[1].decision ? 1 : 0) || String((b[1].mine || {}).at || "").localeCompare(String((a[1].mine || {}).at || "")));
    const want = rows.map((r) => kind + ":" + r[0]);
    for (const [key, el] of S.cards) if (key.startsWith(kind + ":") && !want.includes(key)) { el.remove(); S.cards.delete(key); }
    for (const [id, d] of rows) {
      const key = kind + ":" + id;
      let el = S.cards.get(key);
      if (!el) { el = kind === "out" ? outCard(id) : inCard(id); S.cards.set(key, el); }
      el._update(d);
    }
    const now = [...box.children].map((c) => kind + ":" + c.getAttribute("data-id"));
    if (now.join("|") !== want.join("|")) want.forEach((k) => box.append(S.cards.get(k)));
    $(kind === "out" ? "out-empty" : "in-empty").hidden = rows.length > 0;
  }

  function apply(json) {
    S.docs = json.docs || {};
    S.watchOff = new Set(json.watchOff || []);
    S.needs = Array.isArray(json.needs) ? json.needs : [];
    S.out = new Map((json.outbox || []).map((d) => [d.id, d]));
    S.inn = new Map((json.inbox || []).map((d) => [d.id, d]));
    sync("out");
    sync("in");
    renderTop(json);
    renderData();
  }

  // ---------- 顶部 ----------
  function renderTop(json) {
    const pendOut = [...S.out.values()].filter((d) => (d.status || "待发") === "待发").length;
    const pendIn = [...S.inn.values()].filter((d) => !d.decision).length;
    $("n-out").textContent = pendOut; $("n-out").classList.toggle("due", pendOut > 0);
    $("n-in").textContent = pendIn; $("n-in").classList.toggle("due", pendIn > 0);
    const items = [];
    if (pendOut) items.push({ text: pendOut + " 条回复等你点发", href: "#outbox", when: "今天" });
    if (pendIn) items.push({ text: pendIn + " 条评论等你点一个决定", href: "#inbox", when: "今天" });
    const asks = S.docs.summary && S.docs.summary.asks;
    for (const a of Array.isArray(asks) ? asks : []) if (a && typeof a.text === "string") items.push(a);
    $("todo").replaceChildren(...(items.length ? items.map((a) => h("li", null,
      h("span", { class: "when " + (a.when === "不急" ? "later" : "now") }, a.when || "今天"),
      a.href && /^#[a-z]+$/.test(a.href) ? h("a", { href: a.href }, a.text) : h("span", null, a.text))) : [h("li", { class: "none" }, "今天没有要你做的。")]));
    const upd = S.docs.summary && S.docs.summary.updatedAt;
    $("upd").textContent = upd ? "我 " + mdhm(upd) + " 更新" : "";
    if (json && json.synced && json.synced.at) $("sync-msg").textContent = "上次刷新 " + mdhm(json.synced.at) + (json.synced.note ? " · " + json.synced.note : "");
  }

  // ---------- 数据 ----------
  function goalPanel(g) {
    if (!g || !g.deadline) return null;
    const left = daysUntil(g.deadline);
    const rows = (Array.isArray(g.items) ? g.items : []).map((it) => {
      const v = it.value;
      const valEl = v == null
        ? h("span", { class: "pill warn" }, "还没开始数")
        : it.kind === "zero"
          ? h("span", { class: "pill " + (v === 0 ? "ok" : "stop") }, (v === 0 ? "✓ " : "! ") + v + (it.unit || ""))
          : h("span", { class: "val" }, String(v), h("small", null, " / " + it.goal + (it.unit || "")));
      let meter = null;
      if (v != null && it.kind !== "zero" && it.goal) {
        const fill = h("i");
        fill.style.width = Math.min(100, Math.round((v / it.goal) * 100)) + "%";
        meter = h("div", { class: "meter", role: "img", "aria-label": it.label + " " + v + " / " + it.goal }, fill);
      }
      return h("div", { class: "g-row" }, h("span", { class: "name" }, it.label), valEl, meter, it.note ? h("p", { class: "note" }, it.note) : null);
    });
    return h("div", { class: "panel" },
      h("div", { class: "goal-head" },
        h("span", { class: "days" }, left >= 0 ? String(left) : "已过", left >= 0 ? h("small", null, "天") : null),
        h("span", { class: "what" }, "距 " + String(g.deadline).slice(5) + " 读钟(开源产品第一期)")),
      ...rows,
      g.source ? h("p", { class: "src" }, g.source) : null);
  }

  function exitIcon() {
    const s = sv("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round" });
    s.append(sv("path", { d: "M6 2.5h6.5v11H6" }), sv("path", { d: "M2.5 8h6.5M7 5.5 9.5 8 7 10.5" }));
    return s;
  }
  function routePanel(f) {
    const live = { drafted: S.out.size, posted: [...S.out.values()].filter((d) => d.status === "已发").length };
    const stages = (Array.isArray(f && f.stages) ? f.stages : []).map((s) => ({ ...s, value: s.key in live ? live[s.key] : s.value }));
    if (!stages.length) return null;
    const ol = h("ol", { class: "route", "aria-label": "回帖试验的每一站" });
    stages.forEach((s, i) => {
      const on = (s.value || 0) > 0;
      const last = i === stages.length - 1;
      const dot = h("span", { class: "dot" });
      if (last) dot.append(exitIcon());
      ol.append(h("li", { class: "stop-i" + (on ? " on" : "") + (last ? " exit" : "") }, dot, h("span", { class: "t" }, s.label), h("span", { class: "c" }, String(s.value || 0))));
    });
    return h("div", { class: "panel" },
      h("h3", null, "回帖试验:先发 " + ((f && f.target) || 5) + " 条"),
      f && f.note ? h("p", { class: "src" }, f.note) : null,
      ol);
  }

  function viewsPanel(x) {
    if (!x || !Array.isArray(x.posts)) return null;
    const series = x.posts.slice(0, 3).map((p, i) => ({ ...p, cls: "s" + (i + 1), pts: (Array.isArray(p.points) ? p.points : []).filter((r) => r && typeof r.views === "number" && !Number.isNaN(Date.parse(r.at))).sort((a, b) => String(a.at).localeCompare(String(b.at))) }));
    const legend = h("div", { class: "legend" }, ...series.map((s) => {
      const last = s.pts[s.pts.length - 1];
      const off = S.watchOff.has(String(s.id));
      const tg = h("button", { class: "linkbtn watch", type: "button", "aria-pressed": String(!off) }, off ? "没在读评论,点了恢复" : "读评论中");
      tg.addEventListener("click", async () => {
        const { status, json } = await api("watch", { id: String(s.id), on: off });
        if (status === 200 && json.ok) { if (off) S.watchOff.delete(String(s.id)); else S.watchOff.add(String(s.id)); renderData(); }
      });
      return h("span", null, h("i", { class: "k-" + s.cls }), safeUrl(s.url) ? out(s.url, s.name) : s.name, h("b", null, last ? fmt(last.views) : "—"), tg);
    }));
    const chart = h("div", { class: "chart", tabindex: "0", role: "img", "aria-label": "X 帖子浏览数随时间的变化,下方有表格" });
    const tip = h("div", { class: "tip", hidden: true });
    chart.append(tip);
    const draw = () => drawViews(chart, tip, series);
    requestAnimationFrame(draw);
    if (S.ro) S.ro.disconnect();
    if (window.ResizeObserver) { S.ro = new ResizeObserver(() => draw()); S.ro.observe(chart); }

    const times = [...new Set(series.flatMap((s) => s.pts.map((p) => p.at)))].sort();
    const table = h("table", null,
      h("thead", null, h("tr", null, h("th", null, "读数时间"), ...series.map((s) => h("th", { class: "num" }, s.name)))),
      h("tbody", null, ...times.slice().reverse().map((t) => h("tr", null,
        h("td", null, mdhm(t, series.some((s) => s.pts.some((p) => p.at === t && p.approx)))),
        ...series.map((s) => { const p = s.pts.find((q) => q.at === t); return h("td", { class: "num" }, p ? (p.label ? p.label + " " : "") + fmt(p.views) : "—"); })))));
    const sq = Array.isArray(x.square) && x.square.length ? h("div", { class: "tbl-wrap" }, h("table", null,
      h("thead", null, h("tr", null, h("th", null, "币安广场"), h("th", { class: "num" }, "浏览"), h("th", { class: "num" }, "评论"), h("th", null, "读数时间"))),
      h("tbody", null, ...x.square.map((r) => h("tr", null, h("td", null, String(r.name || "").replace("币安广场", "") || r.name), h("td", { class: "num" }, fmt(r.views)), h("td", { class: "num" }, fmt(r.comments)), h("td", null, r.at ? mdhm(r.at) : "—")))))) : null;
    return h("div", { class: "panel" },
      h("h3", null, "帖子读数"),
      legend, chart,
      h("details", null, h("summary", null, "用表格看这些数"), h("div", { class: "tbl-wrap" }, table)),
      sq,
      x.squareNote ? h("p", { class: "src" }, x.squareNote) : null,
      h("p", { class: "src" }, "来源:" + (x.source || "X 的公开计数") + "。币安广场的数是你截图给我的。"));
  }

  function drawViews(chart, tip, series) {
    const W = Math.max(280, chart.clientWidth || 600);
    const narrow = W < 480;
    const m = { l: 40, r: narrow ? 64 : 92, t: 14, b: 28 };
    const Hh = narrow ? 210 : 240;
    const all = series.flatMap((s) => s.pts);
    if (!all.length) return;
    const t0 = Math.min(...all.map((p) => +new Date(p.at)));
    const t1 = Math.max(...all.map((p) => +new Date(p.at)));
    const vmax = Math.max(...all.map((p) => p.views));
    const step = vmax > 1500 ? 500 : vmax > 600 ? 200 : 100;
    const ymax = Math.max(step, Math.ceil(vmax / step) * step);
    const X = (t) => m.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - m.l - m.r);
    const Y = (v) => m.t + (1 - v / ymax) * (Hh - m.t - m.b);
    const svg = sv("svg", { viewBox: "0 0 " + W + " " + Hh, width: W, height: Hh, "aria-hidden": "true" });
    for (let v = 0; v <= ymax; v += step) {
      svg.append(sv("line", { class: v === 0 ? "base" : "gl", x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }));
      svg.append(sv("text", { x: m.l - 8, y: Y(v) + 4, "text-anchor": "end" }, v >= 1000 ? v / 1000 + "K" : String(v)));
    }
    const day = 864e5;
    const d0 = Math.ceil((t0 + H8) / day) * day - H8;
    const every = (t1 - t0) / day > 10 || narrow ? 2 : 1;
    let k = 0;
    for (let t = d0; t <= t1; t += day, k++) {
      if (k % every) continue;
      svg.append(sv("text", { x: X(t), y: Hh - 8, "text-anchor": "middle" }, md(new Date(t).toISOString())));
    }
    for (const s of series) {
      if (!s.pts.length) continue;
      const d = s.pts.map((p, i) => (i ? "L" : "M") + X(+new Date(p.at)).toFixed(1) + " " + Y(p.views).toFixed(1)).join(" ");
      svg.append(sv("path", { class: "ln " + s.cls, d }));
      for (const p of s.pts) svg.append(sv("circle", { class: "pt " + s.cls, cx: X(+new Date(p.at)), cy: Y(p.views), r: 4 }));
      const last = s.pts[s.pts.length - 1];
      svg.append(sv("text", { class: "end", x: X(+new Date(last.at)) + 8, y: Y(last.views) + 4 }, fmt(last.views)));
    }
    const cross = sv("line", { class: "cross", y1: m.t, y2: Hh - m.b, visibility: "hidden" });
    svg.append(cross);
    chart.querySelectorAll("svg").forEach((n) => n.remove());
    chart.prepend(svg);

    const times = [...new Set(all.map((p) => p.at))].sort();
    let cur = -1;
    const showAt = (i) => {
      cur = i;
      const t = times[i];
      const x = X(+new Date(t));
      cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
      const approx = series.some((s) => s.pts.some((p) => p.at === t && p.approx));
      tip.replaceChildren(h("span", { class: "when" }, mdhm(t, approx)), ...series.map((s) => {
        const p = s.pts.find((q) => q.at === t);
        return h("span", { class: "r" }, h("i", { class: "k-" + s.cls }), h("b", null, p ? fmt(p.views) : "—"), s.name);
      }));
      tip.hidden = false;
      tip.style.left = Math.min(Math.max(0, x + 12), W - tip.offsetWidth) + "px";
    };
    const hide = () => { cross.setAttribute("visibility", "hidden"); tip.hidden = true; cur = -1; };
    const nearest = (px) => { let best = 0, bd = Infinity; times.forEach((t, i) => { const dd = Math.abs(X(+new Date(t)) - px); if (dd < bd) { bd = dd; best = i; } }); return best; };
    chart.onpointermove = (e) => { const r = chart.getBoundingClientRect(); showAt(nearest(((e.clientX - r.left) / r.width) * W)); };
    chart.onpointerleave = hide;
    chart.onblur = hide;
    chart.onkeydown = (e) => {
      if (e.key === "ArrowRight") { showAt(Math.min(times.length - 1, cur + 1)); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { showAt(Math.max(0, cur < 0 ? times.length - 1 : cur - 1)); e.preventDefault(); }
      else if (e.key === "Escape") hide();
    };
  }

  function protocolPanel(p) {
    const rows = Array.isArray(p && p.rows) ? p.rows : [];
    const max = Math.max(1, ...rows.map((r) => r.posts || 0));
    return h("div", { class: "panel" },
      h("h3", null, "大家卡在哪些协议"),
      rows.length
        ? h("div", { class: "bars" }, ...rows.map((r) => {
            const bar = h("i");
            bar.style.width = "calc((100% - 4.5em) * " + ((r.posts || 0) / max).toFixed(3) + ")";
            return h("div", { class: "bar-r" },
              h("span", null, h("b", null, r.protocol), r.chain ? " · " + r.chain : ""),
              h("div", { class: "bt", title: (r.posts || 0) + " 条帖子," + (r.people || 0) + " 个人" }, bar, h("span", null, (r.posts || 0) + " 条")));
          }))
        : h("p", { class: "empty" }, "还没有。机器人交来的帖子我核过原帖以后,按协议排在这里,用来决定下一份指南先做哪个。"),
      p && p.note ? h("p", { class: "src" }, p.note) : null);
  }

  // 到期删掉的评论只留下这些:月份、类型、需求、建议和你的决定(没有账号和原文)
  function needsPanel(rows) {
    if (!rows.length) return null;
    return h("div", { class: "panel" },
      h("h3", null, "30 天前的评论需求(已去掉账号和原文)"),
      h("div", { class: "list" }, ...rows.map((r) => h("div", { class: "li" },
        h("span", { class: "k" }, String(r.month || "").slice(2)),
        h("span", { class: "nm" }, r.need || "暂无明确需求"),
        h("span", { class: "pill " + (r.decision ? "ok" : "mute") }, r.decision || "没定"),
        h("span", { class: "sub" }, [r.source, r.type, r.suggestion ? "我的建议:" + r.suggestion : ""].filter(Boolean).join(" · "))))));
  }

  const CLOCK = { open: ["进行中", "hi"], read: ["已读", "mute"], canceled: ["取消", "mute"], void: ["作废", "mute"] };
  function clocksPanel(c) {
    const rows = (Array.isArray(c && c.rows) ? c.rows : []).slice().sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || String(a.due || "9").localeCompare(String(b.due || "9")));
    if (!rows.length) return null;
    return h("div", { class: "panel" },
      h("h3", null, "判定钟"),
      h("div", { class: "list" }, ...rows.map((r) => {
        const [txt, cls] = CLOCK[r.status] || [r.status, "mute"];
        const left = r.due && r.status === "open" ? daysUntil(r.due) : null;
        return h("div", { class: "li" + (r.status === "open" ? "" : " muted") },
          h("span", { class: "k" }, r.short),
          h("span", { class: "nm" }, r.name),
          h("span", { class: "pill " + cls }, txt),
          h("span", { class: "sub" }, r.due ? String(r.due).slice(5) + (left != null ? (left >= 0 ? " 读 · 还有 " + left + " 天" : " 读 · 已过 " + -left + " 天") : "") : "一直有效", r.status === "read" && r.reading ? " · " + String(r.reading).split(":")[0] : ""));
      })),
      c.source ? h("p", { class: "src" }, "来源:" + c.source) : null);
  }

  const BOT = { "已回复": "ok", "待办": "warn", "要我回答": "stop" };
  function botPanel(b) {
    const rows = Array.isArray(b && b.rows) ? b.rows : [];
    if (!b) return null;
    return h("div", { class: "panel" },
      h("h3", null, "机器人「DX找卡点」"),
      rows.length ? h("div", { class: "list" }, ...rows.map((r) => h("div", { class: "li" },
        h("span", { class: "k" }, "#" + r.n),
        h("span", { class: "nm" }, String(r.title || "").replace("【任务】", "")),
        h("span", { class: "pill " + (BOT[r.state] || "mute") }, r.state),
        h("span", { class: "sub" }, (r.comments || 0) + " 条回复" + (r.updatedAt ? " · 最后动静 " + mdhm(r.updatedAt) : ""))))) : h("p", { class: "empty" }, b.error || "信箱里还没有任务。"),
      b.note ? h("p", { class: "src" }, b.note) : null,
      b.source ? h("p", { class: "src" }, "来源:" + b.source) : null);
  }

  // 某一块的数据格式不对,只让那一块显示一句话,别的照常
  function safe(fn, d) {
    try { return fn(d); } catch (_) { return h("p", { class: "empty" }, "这一块的数据格式不对,我下次干活时修。"); }
  }
  function renderData() {
    const D = S.docs;
    const parts = [safe(goalPanel, D.goal_1215), safe(routePanel, D.funnel), safe(viewsPanel, D.x_posts), safe(protocolPanel, D.protocols), safe(needsPanel, S.needs), safe(clocksPanel, D.clocks), safe(botPanel, D.bot)].filter(Boolean);
    $("data-body").replaceChildren(...(parts.length ? parts : [h("p", { class: "empty" }, "还没有数据。我下次干活时送进来。")]));
  }

  // ---------- 登录、设管理员、刷新、退出 ----------
  function bindForms() {
    $("login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.currentTarget, msg = $("login-msg");
      const btn = f.querySelector("button");
      btn.disabled = true;
      const { status, json } = await api("login", { name: f.name.value.trim(), password: f.password.value });
      btn.disabled = false;
      if (status === 200 && json.ok) { f.password.value = ""; msg.textContent = ""; load(); }
      else note(msg, why(json) + (json.seconds ? "(约 " + json.seconds + " 秒)" : ""), true);
    });
    $("setup-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.currentTarget, msg = $("setup-msg");
      if (f.password.value.length < 20) return note(msg, WHY.weak, true);
      if (f.password.value !== f.password2.value) return note(msg, WHY.mismatch, true);
      const btn = f.querySelector("button");
      btn.disabled = true;
      const { status, json } = await api("setup", { code: f.code.value, name: f.name.value.trim(), password: f.password.value });
      btn.disabled = false;
      if (status === 200 && json.ok) { f.reset(); load(); }
      else note(msg, why(json), true);
    });
    $("refresh").addEventListener("click", async (e) => {
      const btn = e.currentTarget, msg = $("sync-msg");
      btn.disabled = true;
      msg.textContent = "正在读 X 上的评论和读数…";
      const { status, json } = await api("sync", {});
      btn.disabled = false;
      if (status === 200 && json.ok) {
        note(msg, "读好了:新评论 " + (json.newReplies || 0) + " 条" + (json.errors && json.errors.length ? ";有 " + json.errors.length + " 条帖子没读到(" + json.errors.join("、") + "),不算「没有新评论」" : ""), !!(json.errors && json.errors.length));
        load();
      } else if (status === 401) show("login");
      else note(msg, why(json), true);
    });
    $("logout").addEventListener("click", async () => { await api("logout", {}); show("login"); });
    $("logout-all").addEventListener("click", async () => { await api("logout-all", {}); show("login"); });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !$("desk").hidden) load(); });
  }

  bindForms();
  load();
})();
