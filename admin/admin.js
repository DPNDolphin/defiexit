// 运营台(只在 admin 主机上打开):登录 → 读 /api/admin/state → 待发、收件、宣传、数据、已处理。管理员点的「已发 / 采纳」、改的草稿,
// 都经 /api/admin/* 存进数据库。页面里的评论、帖子是别人写的:一律用 textContent 放进页面,不当 HTML(宣传稿的正文也一样,markdown 照原样显示)。
// 每天放出几条回复、发得快了提醒,算法在 pace.js(测试也用它)。
import { capOf, gate, waitText, paceNote } from "./pace.js";
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
  // 换掉一个元素里的内容:和 h() 一样跳过 null / false(直接 replaceChildren(null) 会显示成「null」)
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  const NS = "http://www.w3.org/2000/svg";
  function sv(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, String(v));
    for (const kid of kids) if (kid != null) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const out = (href, text) => h("a", { href, target: "_blank", rel: "noopener noreferrer" }, text);
  const safeUrl = (u) => (/^https:\/\/(x|twitter)\.com\//.test(String(u || "")) ? u : null);

  // X 计字:中日韩文字算 2,网址算 23(和 X 的规则一致,所以写「约」);不带 https:// 的 defiexit.com 也会被 X 当成网址
  function xLen(s) {
    const re = /https?:\/\/\S+|(?:www\.)?defiexit\.com(?:\/[\x21-\x7e]*)?/gi;
    let n = (String(s).match(re) || []).length * 23;
    for (const ch of String(s).replace(re, "")) {
      const c = ch.codePointAt(0);
      n += c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037) ? 1 : 2;
    }
    return n;
  }
  // 引用原帖:原帖链接接在正文末尾(和手动粘贴一样),X 发出去显示成带原帖卡片的引用帖;字数按普通链接多算 24(空格 + 23),宁多勿少
  const QUOTE = /^https:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/\d{1,25}$/;
  const quoteOf = (d) => (d && d.mine && d.mine.kind === "post" && QUOTE.test(String(d.mine.quote || "")) ? d.mine.quote : null);
  const withQuote = (text, quote) => (quote ? String(text || "").trimEnd() + " " + quote : text || "");
  const intent = (text, replyTo, quote) => "https://x.com/intent/tweet?" + (/^\d{1,25}$/.test(String(replyTo || "")) ? "in_reply_to=" + replyTo + "&" : "") + "text=" + encodeURIComponent(withQuote(text, quote));

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
    network: "连不上服务器,看看网络再试", wrong: "用户名或密码不对", wait: "试错太多次了,等一会儿再试",
    weak: "密码至少 8 位", mismatch: "两次输的密码不一样", exists: "管理员已经设过了,请登录", db: "数据库还没接上(Cloudflare 里的 D1 还没绑)",
    origin: "请求来源不对,刷新页面再试", login: "登录过期了,请重新登录", busy: "刚刷新过,两分钟后再点", superseded: "同时有另一次刷新在跑,这次的结果没写进去,过一会儿再看", bad: "内容不合格,没存",
    nocode: "设置链接还没生成或已经过期,叫我重新发一个", code: "设置码不对", name: "用户名只能用字母、数字、汉字和 _ . -,最多 40 个", locked: "这条已经点过「已发 / 跳过」,先改回待发再改草稿",
    none: "这一条已经不在了,刷新一下", target: "这条没有目标帖子编号,不能发", draftbad: "草稿里有不许带的链接或不许用的词",
    purged: "这条 30 天到了,原帖信息已经删了,不能再记", gone: "这条帖子按对方要求删过,不能再记",
    changed: "这条刚被别处改过,页面刷新一下再改", more: "这条帖子还有记录没查完,再点「删除这条」并确认,接着往下查、往下删",
    badlink: "链接不对:要 x.com 上那一条的链接(帖子右下角「分享」→「复制链接」)",
    notsent: "先点「已发」再记回音", badurl: "链接不对:要 https:// 开头的完整网址(不带账号密码、IP 地址、端口)",
  };
  const why = (j) => (WHY[j && (j.error || j.need)] || "出错了(" + ((j && (j.error || j.need)) || "未知") + "),再试一次") + (j && j.why ? ":" + j.why : "");
  function note(el, msg, bad) {
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle("bad", !!bad);
    if (!bad) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 2500);
  }

  // quota:今天对人的首回放出几条(上限、已发、排队的编号),每次摆待发卡片前重算;hits:网站自己数的体检次数
  const S = { docs: {}, out: new Map(), inn: new Map(), reach: new Map(), cards: new Map(), ro: null, watchOff: new Set(), needs: [], leads: [], auto: {}, outStats: {}, hits: {}, quota: gate([], [], capOf(null)) };
  // 三种卡片:待发(out)、收件(in)、宣传(reach);接口的名字 → 卡片的种类
  const KINDS = { outbox: "out", inbox: "in", outreach: "reach" };
  const storeOf = (k) => (k === "out" ? S.out : k === "in" ? S.inn : S.reach);
  const resync = (k) => (k === "reach" ? syncReach() : sync(k));

  function show(view) {
    $("boot-msg").hidden = view !== "boot";
    $("setup").hidden = view !== "setup";
    $("login").hidden = view !== "login";
    $("desk").hidden = view !== "desk";
  }

  // 登进了运营台,这个浏览器就是管理员自己的:记上 dx-owner,在这个浏览器里体检不计数(运营台和主站是同一个网站 defiexit.com,
  // 本地存储是同一份;主站那边见 src/js/lib/count.js。钱包里的浏览器不登运营台,打开一次 defiexit.com/#owner 也能记上)
  function ownerBrowser() {
    try { localStorage.setItem("dx-owner", "1"); } catch (_) { /* 存不了:这个浏览器本来也数不了 */ }
  }

  async function load() {
    const { status, json } = await api("state");
    if (status === 200 && json.ok) { show("desk"); ownerBrowser(); apply(json); return; }
    if (json.need === "setup") return show("setup");
    if (json.need === "login" || status === 401) return show("login");
    show("boot");
    $("boot-msg").textContent = why(json);
  }

  async function save(kind, id, patch, msgEl) {
    const { status, json } = await api(kind, { id, ...patch });
    const ok = status === 200 && !!json.item;
    const k = KINDS[kind];
    const el0 = S.cards.get(k + ":" + id);
    if (el0 && el0._saved) el0._saved(ok, "draft" in patch, status);
    if (ok) {
      storeOf(k).set(id, json.item);
      // 状态或决定变了要挪到「待发 / 收件」或「已处理」(宣传卡片挪到下面的「发过的」;sync 只在顺序变了才挪,改草稿不会让框失焦)
      resync(k);
      renderTop();
      if (kind === "outbox") renderData();
      note(msgEl, "已存");
    } else if (status === 401) {
      show("login");
    } else note(msgEl, "没存上:" + why(json), true);
    return ok;
  }

  // 删除:先点一下变成「确定删除?再点一次」,旁边写清楚会删掉什么;5 秒内再点才删(按对方要求删数据时用)。
  // 删的是这条帖子:服务器把它在待发、收件、问题记录里的几行一起删(同一条帖子的别的卡片也删,以后也不再收);
  // 自己发的项目帖没有别人的帖子,只删这一张。删完重新读一遍,列表、计数、数据都照服务器的
  const SCOPE_POST = "会删掉这条帖子在待发、收件、问题记录里的全部记录(同一条帖子的别的卡片也删),以后也不再收";
  const SCOPE_CARD = "只删这一张自己发的帖子,以后不再收";
  // 宣传卡片:只删这一张;写邮件的,收件邮箱也记下(只存哈希),以后写给这个邮箱的都不再收
  const SCOPE_REACH = "只删这一张宣传卡片,以后不再收;写邮件的,以后写给这个邮箱的也不再收(对方要求删时用;不想发点「跳过」)";
  function delButton(kind, id, msgEl) {
    const b = h("button", { class: "linkbtn warn", type: "button" }, "删除这条");
    let armed = null, scope = "";
    const disarm = () => { armed = null; b.textContent = "删除这条"; if (msgEl.textContent === scope) msgEl.textContent = ""; };
    b.addEventListener("click", async () => {
      if (!armed) {
        b.textContent = "确定删除?再点一次";
        scope = kind === "outreach" ? SCOPE_REACH : kind === "outbox" && isPost(S.out.get(id)) ? SCOPE_CARD : SCOPE_POST;
        msgEl.textContent = scope;
        msgEl.classList.remove("bad");
        armed = setTimeout(disarm, 5000);
        return;
      }
      clearTimeout(armed);
      disarm();
      const { status, json } = await api("delete", { kind, id });
      if (status === 200 && json.ok) {
        storeOf(KINDS[kind]).delete(id);
        resync(KINDS[kind]);
        renderTop();
        await load(); // 同一条帖子的别的卡片、收件,问题记录的数,服务器那边也删了
      } else if (status === 409 && json.error === "more") {
        await load(); // 还没查完(这张卡片还留着,查到的可能已经删了):重新读一遍,再点删除并确认接着查
        note(msgEl, why(json), true);
      } else note(msgEl, "没删掉:" + why(json), true);
    });
    return b;
  }

  // ---------- 待发卡片 ----------
  // 两种:回别人的帖子(mine.target),或者自己发一条新帖(mine.kind === "post")。点过「已发 / 跳过」的挪到「已处理」
  const OUT_STATUS = { "待发": "hi", "已发": "ok", "跳过": "mute" };
  const isPost = (d) => !!(d && d.mine && d.mine.kind === "post");
  const isPend = (d) => ((d && d.status) || "待发") === "待发";
  // 我们发出去那一条的最新读数:刷新时记的(out_stats)和「帖子读数」里最后一个点(被监控的帖子),哪个新用哪个
  function statOf(d) {
    const x = S.outStats && S.outStats[d.id];
    const m = /\/status\/(\d{1,25})$/.exec(String(d.reply_url || ""));
    const p = m && ((S.docs.x_posts && S.docs.x_posts.posts) || []).find((q) => String(q.id) === m[1]);
    const pt = p && Array.isArray(p.points) && p.points[p.points.length - 1];
    const a = x && typeof x.at === "string" ? x : null, b = pt && typeof pt.at === "string" ? pt : null;
    return a && b ? (a.at >= b.at ? a : b) : a || b;
  }
  const n0 = (v) => (v == null ? "?" : v);
  const statText = (x) => "浏览 " + n0(x.views) + " · 赞 " + n0(x.likes) + " · 回复 " + n0(x.replies);
  function outCard(id) {
    const ta = h("textarea", { id: "draft-" + id, "aria-label": "回复草稿,可以直接改" });
    const count = h("span", { class: "count" });
    const restore = h("button", { class: "linkbtn", type: "button", hidden: true }, "用回我原来写的");
    const open = h("a", { class: "btn primary wide", target: "_blank", rel: "noopener noreferrer" }, "在 X 打开,字已填好 ↗");
    const copy = h("button", { class: "btn", type: "button" }, "复制");
    const wait = h("p", { class: "queue", hidden: true });
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
    const paste = h("input", { type: "url", id: "url-out-" + id, inputmode: "url", maxlength: "300", "aria-label": "贴上这一条在 X 上的链接" });
    const pasteRow = h("div", { class: "row", hidden: true }, paste);
    const lab = h("span", { class: "label" });
    const el = h("article", { class: "card", "data-id": id }, head, chips, kv,
      h("div", { class: "row" }, lab, h("span", { class: "grow" }), restore), ta,
      h("div", { class: "row" }, count, h("span", { class: "grow" }), copy),
      wait, open,
      h("div", { class: "row" }, sent, skip, back, h("span", { class: "grow" }), status),
      link, pasteRow, memo, h("div", { class: "row" }, saved, h("span", { class: "grow" }), delButton("outbox", id, saved)));
    // bad:框里的字服务器刚拒过(带了不许带的链接或词)。「在 X 打开」「复制」先收起来,免得把拒掉的字发出去;改好存上了、或点「用回我原来写的」才放开
    let timer = null, dirty = false, bad = false;
    const target = () => (el._d && el._d.mine && el._d.mine.target) || {};
    const refresh = () => {
      const q = quoteOf(el._d);
      const n = xLen(ta.value) + (q ? 24 : 0);
      count.textContent = "约 " + n + " / 280" + (q ? "(含引用的原帖)" : "");
      count.classList.toggle("over", n > 280);
      const tid = target().id;
      if (!el._wait && !bad && (isPost(el._d) || /^\d{1,25}$/.test(String(tid || "")))) { open.href = intent(ta.value, isPost(el._d) ? null : tid, q); open.removeAttribute("aria-disabled"); open.classList.remove("off"); }
      else { open.removeAttribute("href"); open.setAttribute("aria-disabled", "true"); open.classList.add("off"); }
      copy.disabled = !!el._wait || bad;
      restore.hidden = !isPend(el._d) || !(bad || (el._d && el._d.draft_admin != null));
    };
    // 草稿存不上:字留在框里(dirty 设回去,之后的刷新不会盖掉),也不往下改状态。服务器拒了(400)才算 bad,网络断了这类不算;
    // 存上了、而且存的时候框里的字没再改过,才放开(存的路上又改了,等这次改的存上)
    const flush = async () => { clearTimeout(timer); if (!dirty) return true; dirty = false; return save("outbox", id, { draft: ta.value }, saved); };
    el._saved = (ok, wasDraft, status) => {
      if (!wasDraft) return;
      if (!ok) dirty = true;
      if (ok) { if (!dirty) bad = false; } else if (status === 400) bad = true;
      refresh();
    };
    const decide = async (st, msg) => {
      if (!(await flush())) return note(saved, "草稿没存上,先别点「" + st + "」;字还在框里", true);
      const was = isPend(el._d);
      const ok = await save("outbox", id, { status: st }, saved);
      if (ok && was) note($("out-msg"), msg || "点了「" + st + "」,这条挪到下面的「已处理」了");
      return ok;
    };
    ta.addEventListener("input", () => { dirty = true; refresh(); clearTimeout(timer); timer = setTimeout(flush, 1200); });
    ta.addEventListener("blur", flush);
    restore.addEventListener("click", () => { dirty = false; save("outbox", id, { draft: null }, saved); });
    copy.addEventListener("click", () => {
      const q = quoteOf(el._d);
      // 剪贴板用不了:只能选中框里的正文,原帖链接得另外贴,要说清楚
      const fallback = () => { ta.focus(); ta.select(); note(saved, q ? "已选中正文,长按复制;发的时候末尾再贴上原帖链接(顶上「看原帖」)" : "已选中,长按复制"); };
      try { navigator.clipboard.writeText(withQuote(ta.value, q)).then(() => note(saved, q ? "已复制(末尾带着原帖链接,发出去就是引用)" : "已复制"), fallback); } catch (_) { fallback(); }
    });
    sent.addEventListener("click", async () => { if (await decide("已发")) paceCheck(); });
    // 点「在 X 打开」就当发了(省得发完再回来点「已发」):回复的链接运营台自己去目标帖子底下找,项目帖的链接晚上机器人补;
    // 一天还没在 X 上找到你那条回复,顶上会提醒(可能没发出去,点「改回待发」就回来)。记下以后看看是不是发得太快(只提醒,不拦;点「已发」也一样)
    open.addEventListener("click", async () => {
      if (isPend(el._d) && !open.classList.contains("off") && (await decide("已发", "打开了 X,发出去就行,不用再点「已发」;这条挪到下面的「已处理」了"))) paceCheck();
    });
    skip.addEventListener("click", () => decide("跳过"));
    back.addEventListener("click", async () => { if (await save("outbox", id, { status: "待发" }, saved)) note($("done-msg"), "这条挪回「待发」了"); });
    memo.addEventListener("change", () => save("outbox", id, { note: memo.value }, saved));
    paste.addEventListener("change", async () => {
      const v = paste.value.trim();
      if (v && (await save("outbox", id, { reply_url: v }, saved))) { paste.value = ""; note(saved, "链接记下了,之后浏览、点赞、回复每 20 分钟自动读"); }
    });
    el._update = (d) => {
      el._d = d;
      const m = d.mine || {}, t = m.target || {}, post = isPost(d), q = quoteOf(d);
      fill(head, ...(post
        ? (q
          ? [h("span", { class: "who" }, "自己发的帖子"), h("span", null, "引用 @" + QUOTE.exec(q)[1] + " 的原帖"), out(q, "看原帖 ↗")]
          : [h("span", { class: "who" }, "自己发的帖子"), h("span", null, "发一条新帖,不是回复别人")])
        : [h("span", { class: "who" }, "回 @" + (t.handle || "?")),
          t.postedAt ? h("span", null, md(t.postedAt) + " 发的帖") : null,
          safeUrl(t.url) ? out(t.url, "看原帖 ↗") : null]));
      chips.replaceChildren(...(post ? [m.topic] : [t.protocol, t.chain, t.type]).filter(Boolean).map((x) => h("span", { class: "chip" }, x)));
      fill(kv, ...(post
        ? [m.why ? h("dt", null, "为什么发") : null, m.why ? h("dd", null, m.why) : null]
        : [h("dt", null, "卡在"), h("dd", null, t.summary || (d.purged ? "(30 天到了,原帖信息已删)" : "—")),
          m.why ? h("dt", null, "为什么回") : null, m.why ? h("dd", null, m.why) : null]));
      const st = d.status || "待发";
      // 对人的首回今天放出的到了上限(运营规则 dailyReplyCap):多的这条排队,「在 X 打开」「复制」「已发」先点不了,明天放出;「跳过」照样能点
      el._wait = st === "待发" && S.quota.queued.has(id) ? waitText(S.quota) : null;
      wait.textContent = el._wait || "";
      wait.hidden = !el._wait;
      sent.disabled = !!el._wait;
      const draft = d.draft_admin != null ? d.draft_admin : (m.draft || "");
      if (document.activeElement !== ta && !dirty && ta.value !== draft) ta.value = draft;
      // 点过「已发 / 跳过」的草稿改不了(服务器也不收),「在 X 打开」也收起来,免得同一条发两次
      lab.textContent = (post ? "我写的帖子" : "我写的回复") + (st === "待发" ? "(可以直接改)" : "");
      ta.readOnly = st !== "待发";
      open.hidden = st !== "待发";
      open.textContent = q ? "在 X 打开,引用原帖发,字已填好 ↗" : post ? "在 X 打开,发新帖,字已填好 ↗" : "在 X 打开,字已填好 ↗";
      if (document.activeElement !== memo && memo.value !== (d.note || "")) memo.value = d.note || "";
      status.className = "pill " + (OUT_STATUS[st] || "mute");
      status.textContent = st + (st !== "待发" && d.decided_at ? " · " + mdhm(d.decided_at) : "");
      sent.setAttribute("aria-pressed", String(st === "已发"));
      skip.setAttribute("aria-pressed", String(st === "跳过"));
      back.hidden = st === "待发";
      el.classList.toggle("done", st !== "待发");
      const x = st === "已发" ? statOf(d) : null;
      link.replaceChildren(st === "已发"
        ? (safeUrl(d.reply_url)
          ? h("span", null, post ? "你的帖子:" : "你的回复:", out(d.reply_url, "看 ↗"), x ? " · " + statText(x) + "(" + mdhm(x.at) + " 读)" : " · 读数等下一次刷新")
          : post ? "你的帖子链接:晚上机器人找到了会补上,之后浏览、点赞、回复自动跟着读。" : "你的回复链接:运营台每 20 分钟自己去目标帖子底下找。")
        : "");
      pasteRow.hidden = true; // 老板 11-04:不用贴,链接自动找(服务器那边贴链接的入口留着,维护者用)
      paste.placeholder = post ? "贴上这条帖子的链接" : "贴上你这条回复的链接(可不贴)";
      refresh();
    };
    return el;
  }

  // 发得快了提醒一句(不拦人):点「在 X 打开」(自动记成已发)或「已发」以后算一下;点「知道了」收起,下次发了再算
  function paceCheck() {
    const msg = paceNote([...S.out.values()].filter((d) => d.status === "已发").map((d) => d.decided_at));
    if (!msg) return;
    $("pace-text").textContent = msg;
    $("pace").hidden = false;
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
    const undo = h("button", { class: "btn", type: "button", hidden: true }, "改回待定");
    const status = h("span", { class: "pill" });
    const memo = h("input", { type: "text", id: "memo-in-" + id, placeholder: "备注(可不填)", "aria-label": "备注", maxlength: "500" });
    const saved = h("span", { class: "saved", "aria-live": "polite" });
    const el = h("article", { class: "card", "data-id": id }, head, quote, kv, draftWrap,
      h("div", { class: "row" }, go, replied),
      h("div", { class: "label" }, "你的决定"),
      h("div", { class: "row" }, ...btns, undo, h("span", { class: "grow" }), status),
      memo, h("div", { class: "row" }, saved, h("span", { class: "grow" }), delButton("inbox", id, saved)));
    // 点了决定就挪到「已处理」;「改回待定」挪回收件
    btns.forEach((b, i) => b.addEventListener("click", async () => {
      const was = !(el._d && el._d.decision);
      if ((await save("inbox", id, { decision: DECISIONS[i] }, saved)) && was) note($("in-msg"), "定了「" + DECISIONS[i] + "」,这条挪到下面的「已处理」了");
    }));
    undo.addEventListener("click", async () => { if (await save("inbox", id, { decision: null }, saved)) note($("done-msg"), "这条挪回「收件」了"); });
    replied.addEventListener("click", async () => { if (await save("inbox", id, { replied: true }, saved)) note($("in-msg"), "记下了,这条挪到下面的「已处理」了"); });
    memo.addEventListener("change", () => save("inbox", id, { note: memo.value }, saved));
    el._update = (d) => {
      el._d = d;
      const m = d.mine || {};
      fill(head, 
        h("span", { class: "who" }, m.source || "评论"),
        h("span", null, "@" + (m.author || "?")),
        m.at ? h("span", null, mdhm(m.at)) : null,
        safeUrl(m.url) ? out(m.url, "看原帖 ↗") : null,
        d.replied ? h("span", { class: "pill ok" }, "已回复" + (d.replied_at ? " " + md(d.replied_at) : "")) : null);
      quote.textContent = d.text != null ? d.text : "(30 天到了,原文已删;需求摘要留在下面)";
      quote.classList.toggle("gone", d.text == null);
      fill(kv, 
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
      undo.hidden = !dec || !!d.replied; // 回过的本来就算处理过,改回待定也还在「已处理」
      status.className = "pill " + (dec || d.replied ? "ok" : "warn");
      status.textContent = dec ? "你定了:" + dec + (d.decided_at ? " · " + mdhm(d.decided_at) : "") : d.replied ? "回过了,不用再定" : "等你定";
      if (document.activeElement !== memo && memo.value !== (d.note || "")) memo.value = d.note || "";
      el.classList.toggle("done", !!dec || !!d.replied);
    };
    return el;
  }

  // ---------- 宣传卡片 ----------
  // 我写好的四种稿子,老板自己发:媒体投稿、给项目团队的邮件、安全清单的提交(PR 或 issue)、技术社区的帖子。没有发帖节奏的限制(那只管 X 上的回复)。
  // 带收件邮箱的点「写邮件」:收件人、邮件标题、正文填进 mailto 链接;链接太长(超过 MAILTO_MAX,有的邮件程序打不开)就不放正文,
  // 点的时候先把正文复制好。别的点「打开投稿页」,新标签打开。打开不算发了:发出去以后点「已发」,有回音了记一句话和一个链接
  const CHANNEL = { media: "媒体投稿", project: "项目团队", list: "安全清单", community: "技术社区" };
  const GROUPS = [...Object.keys(CHANNEL), "other"]; // 按这个顺序分组;不认识的渠道放最后「其他」
  const LANGS = { zh: "中文", en: "英文", ja: "日文", ko: "韩文", es: "西班牙文", fr: "法文", de: "德文", ru: "俄文", pt: "葡萄牙文", vi: "越南文", tr: "土耳其文", id: "印尼文" };
  const langName = (c) => { const s = String(c || ""), base = s.split("-")[0]; return LANGS[base] ? LANGS[base] + (s !== base ? "(" + s + ")" : "") : s; };
  const MAILTO_MAX = 1800, LONG = 400;
  const MAIL = /^[A-Za-z0-9._+-]{1,64}@[a-z0-9.-]{4,253}$/; // 服务器查过一遍(ingest.js 的 mailAddr),这里再兜一层:多不出别的收件人、别的栏
  const webHref = (u) => (/^https:\/\/[^\s"'<>\\]+$/.test(String(u || "")) ? u : null); // 网址显示成链接以前再兜一层:只认 https(主机名用下面线索那块的 hostName)
  // 写邮件的链接:正文的换行写成 \r\n(邮件的规矩)。整条超过 MAILTO_MAX 就先不放正文,还超就连邮件标题也不放;cut 是没放进去的
  function mailtoOf(m) {
    if (!MAIL.test(String(m.to || ""))) return null;
    const enc = (s) => encodeURIComponent(String(s).replace(/\r?\n/g, "\r\n"));
    const link = (parts) => { const q = parts.filter(([, v]) => v).map(([k, v]) => k + "=" + enc(v)).join("&"); return "mailto:" + m.to + (q ? "?" + q : ""); };
    const full = link([["subject", m.subject], ["body", m.body]]);
    if (full.length <= MAILTO_MAX) return { href: full, cut: [] };
    const noBody = link([["subject", m.subject]]);
    return noBody.length <= MAILTO_MAX ? { href: noBody, cut: ["body"] } : { href: link([]), cut: ["subject", "body"] };
  }
  // 剪贴板用不了的时候:选中那段字(请他长按复制);浏览器不支持就回 false
  const pick = (box) => { try { const r = document.createRange(); r.selectNodeContents(box); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); return true; } catch (_) { return false; } };

  function reachCard(id) {
    const btn = (t, hidden) => h("button", { class: "btn", type: "button", hidden }, t);
    const head = h("div", { class: "meta-row" });
    const chips = h("div", { class: "chips" });
    const whyDt = h("dt", null, "我的说明"), whyDd = h("dd"), toDt = h("dt", null, "收件人"), toDd = h("dd"), urlDt = h("dt", null, "去哪发"), urlDd = h("dd");
    const kv = h("dl", { class: "kv" }, whyDt, whyDd, toDt, toDd, urlDt, urlDd);
    const subj = h("div", { class: "quote" }), title = h("div", { class: "quote" });
    const subjWrap = h("div", { class: "drafted" }, h("div", { class: "label" }, "邮件标题"), subj);
    const titleWrap = h("div", { class: "drafted" }, h("div", { class: "label" }, "标题"), title);
    // 正文:长的收起来,点开看全文(打开过的,刷新时不再收回去)
    const body = h("div", { class: "quote" }), sum = h("summary");
    const fold = h("details", { class: "fold" }, sum, body);
    const cBody = btn("复制正文"), cTitle = btn("复制标题", true), cSubj = btn("复制邮件标题", true), cTo = btn("复制收件人", true);
    const tip = h("p", { class: "count", hidden: true });
    const go = h("a", { class: "btn primary wide", rel: "noopener noreferrer" });
    const sent = btn("已发"), skip = btn("跳过"), back = btn("改回待发", true);
    const status = h("span", { class: "pill" });
    // 回音:点「已发」以后才有;一句话加一个链接(可不填),两样都空着点「记下」就是清掉
    const said = h("p", { class: "result", hidden: true });
    const echo = btn("有回音", true), echoRow = h("div", { class: "row", hidden: true }, echo);
    const eNote = h("input", { type: "text", id: "echo-note-" + id, maxlength: "300", placeholder: "一句话:比如「编辑回邮件说下周发」「PR 合并了」", "aria-label": "回音:一句话" });
    const eLink = h("input", { type: "url", id: "echo-url-" + id, inputmode: "url", maxlength: "500", placeholder: "链接(可不填):发出来的文章、合并的 PR", "aria-label": "回音的链接" });
    const eKeep = btn("记下"), eDrop = h("button", { class: "linkbtn", type: "button" }, "先不记");
    const form = h("div", { class: "echo", hidden: true }, h("div", { class: "label" }, "回音(两样都空着点「记下」就是清掉)"), eNote, eLink, h("div", { class: "row" }, eKeep, eDrop));
    const saved = h("span", { class: "saved", "aria-live": "polite" });
    const el = h("article", { class: "card", "data-id": id }, head, chips, kv, subjWrap, titleWrap, fold,
      h("div", { class: "row" }, cBody, cTitle, cSubj, cTo), tip, go,
      h("div", { class: "row" }, sent, skip, back, h("span", { class: "grow" }), status),
      said, echoRow, form, h("div", { class: "row" }, saved, h("span", { class: "grow" }), delButton("outreach", id, saved)));
    const m = () => (el._d && el._d.mine) || {};
    const copyOut = (text, ok, box) => {
      const fb = () => { if (box === body) fold.open = true; note(saved, pick(box) ? "复制不了:已选中,长按复制" : "复制不了:长按上面的字自己复制", true); };
      try { navigator.clipboard.writeText(String(text || "")).then(() => note(saved, ok), fb); } catch (_) { fb(); }
    };
    cBody.addEventListener("click", () => copyOut(m().body, "正文已复制", body));
    cTitle.addEventListener("click", () => (m().title ? copyOut(m().title, "标题已复制", title) : copyOut(m().subject, "邮件标题已复制", subj)));
    cSubj.addEventListener("click", () => copyOut(m().subject, "邮件标题已复制", subj));
    cTo.addEventListener("click", () => copyOut(m().to, "收件人已复制", toDd));
    // 正文放不进邮件链接:点「写邮件」的同时先复制好正文(不拦着链接打开邮件程序)
    go.addEventListener("click", () => { if (el._mail && el._mail.cut.includes("body")) copyOut(m().body, "正文已复制:邮件窗口打开后,长按粘贴进正文", body); });
    const decide = async (st) => {
      const was = isPend(el._d);
      if ((await save("outreach", id, { status: st }, saved)) && was) note($("reach-msg"), "点了「" + st + "」,这条挪到下面的「发过的」了");
    };
    sent.addEventListener("click", () => decide("已发"));
    skip.addEventListener("click", () => decide("跳过"));
    back.addEventListener("click", async () => { if (await save("outreach", id, { status: "待发" }, saved)) note($("reach-msg"), "这条挪回上面了"); });
    echo.addEventListener("click", () => {
      const d = el._d || {};
      eNote.value = d.result_note || "";
      eLink.value = d.result_url || "";
      form.hidden = false;
      echo.hidden = echoRow.hidden = true;
      eNote.focus();
    });
    eDrop.addEventListener("click", () => { form.hidden = true; el._update(el._d); });
    eKeep.addEventListener("click", async () => {
      const v = { result_note: eNote.value.trim(), result_url: eLink.value.trim() };
      if (await save("outreach", id, v, saved)) { form.hidden = true; el._update(el._d); note(saved, v.result_note || v.result_url ? "回音记下了" : "回音清掉了"); }
    });
    el._update = (d) => {
      el._d = d;
      const mm = d.mine || {}, st = d.status || "待发", pend = st === "待发";
      const url = webHref(mm.url);
      el._mail = mailtoOf(mm);
      fill(head, h("span", { class: "who" }, mm.target || "?"), url ? h("span", null, hostName(url)) : null, el._mail ? h("span", null, "写邮件") : null);
      chips.replaceChildren(...[CHANNEL[mm.channel] || mm.channel, langName(mm.lang)].filter(Boolean).map((x) => h("span", { class: "chip" }, x)));
      whyDd.textContent = mm.why || "";
      // 点过「已发 / 跳过」满 180 天,服务器把收件邮箱删了(toGone):写明是到期删的,要再写叫我重新送一张
      toDd.textContent = mm.to || (mm.toGone ? "点过「已发 / 跳过」满 180 天,邮箱已删" : "");
      fill(urlDd, url ? out(url, url) : null);
      whyDt.hidden = whyDd.hidden = !mm.why;
      toDt.hidden = toDd.hidden = !mm.to && !mm.toGone;
      urlDt.hidden = urlDd.hidden = !url;
      kv.hidden = !mm.why && !mm.to && !mm.toGone && !url;
      subj.textContent = mm.subject || "";
      subjWrap.hidden = !mm.subject;
      title.textContent = mm.title || "";
      titleWrap.hidden = !mm.title;
      const text = String(mm.body || ""), long = text.length > LONG || text.split("\n").length > 10;
      if (el._text !== text) { el._text = text; body.textContent = text; fold.open = !long; }
      sum.textContent = long ? "正文(共 " + fmt(text.length) + " 字,点开看全文)" : "正文";
      cTitle.hidden = !(mm.title || mm.subject);
      cSubj.hidden = !(mm.title && mm.subject);
      cTo.hidden = !mm.to;
      // 主按钮:带收件邮箱的写邮件,别的打开投稿页;点过「已发 / 跳过」的收起来(免得同一份发两次)
      if (el._mail) {
        go.href = el._mail.href;
        go.removeAttribute("target");
        go.textContent = el._mail.cut.length ? "写邮件,正文先复制好 ↗" : "写邮件,字已填好 ↗";
      } else if (url) {
        go.href = url;
        go.setAttribute("target", "_blank");
        go.textContent = "打开投稿页 ↗";
      } else go.removeAttribute("href");
      go.hidden = !pend || !(el._mail || url);
      tip.textContent = !el._mail || !el._mail.cut.length ? ""
        : el._mail.cut.includes("subject") ? "邮件标题和正文太长,放不进邮件链接(有的邮件程序会打不开):先点「" + (mm.title ? "复制邮件标题" : "复制标题") + "」贴进邮件标题,再点「写邮件」(正文会先复制好),粘贴进正文。"
          : "正文太长,放不进邮件链接(有的邮件程序会打不开):点「写邮件」时先把正文复制好,邮件窗口打开后长按粘贴进正文。";
      tip.hidden = !pend || !tip.textContent;
      status.className = "pill " + (OUT_STATUS[st] || "mute");
      status.textContent = st + (!pend && d.decided_at ? " · " + mdhm(d.decided_at) : "");
      sent.setAttribute("aria-pressed", String(st === "已发"));
      skip.setAttribute("aria-pressed", String(st === "跳过"));
      back.hidden = pend;
      el.classList.toggle("done", !pend);
      const has = !!(d.result_note || d.result_url), link = webHref(d.result_url);
      fill(said, has ? ["回音:", d.result_note || "", link ? [d.result_note ? " · " : "", out(link, "看 ↗")] : null, d.result_at ? " · " + md(d.result_at) + " 记" : ""] : null);
      said.hidden = st !== "已发" || !has;
      if (st !== "已发") form.hidden = true;
      echo.hidden = echoRow.hidden = st !== "已发" || !form.hidden;
      echo.textContent = has ? "改回音" : "有回音";
    };
    return el;
  }

  // 宣传:还没点的按渠道分组(先送来的在上面),点过「已发 / 跳过」的放下面「发过的」(最近点的在上面)。分组第一次用到时按固定顺序建好
  const reachGroups = new Map();
  function syncReach() {
    if (!reachGroups.size) for (const ch of GROUPS) {
      const n = h("span", { class: "n" }), box = h("div", { class: "cards" });
      const el = h("div", { class: "group", hidden: true }, h("h3", { class: "group-h" }, CHANNEL[ch] || "其他", n), box);
      reachGroups.set(ch, { el, box, n });
      $("reach-cards").append(el);
    }
    const keys = new Set([...S.reach.keys()].map((id) => "reach:" + id));
    for (const [key, el] of S.cards) if (key.startsWith("reach:") && !keys.has(key)) { el.remove(); S.cards.delete(key); }
    const all = [...S.reach.entries()];
    const pend = all.filter(([, d]) => isPend(d)).sort((a, b) => String(a[1].created_at || "").localeCompare(String(b[1].created_at || "")) || a[0].localeCompare(b[0]));
    for (const ch of GROUPS) {
      const g = reachGroups.get(ch);
      const rows = pend.filter(([, d]) => (CHANNEL[(d.mine || {}).channel] ? d.mine.channel : "other") === ch).map(([id, d]) => ["reach", id, d]);
      place(g.box, rows);
      g.el.hidden = !rows.length;
      g.n.textContent = rows.length;
    }
    const done = all.filter(([, d]) => !isPend(d)).sort((a, b) => String(b[1].decided_at || "").localeCompare(String(a[1].decided_at || ""))).map(([id, d]) => ["reach", id, d]);
    place("reach-done-cards", done);
    $("reach-done").hidden = !done.length;
    $("reach-empty").hidden = pend.length > 0;
    $("reach-empty").textContent = done.length
      ? "要发的都发完了。发过的在下面:有回音了点「有回音」记一句。"
      : "还没有要发的宣传。我写好的媒体投稿、给项目团队的邮件、安全清单的提交、技术社区的帖子放在这里,按渠道分好。";
  }

  // 按顺序摆卡片:只在顺序变了才挪(挪动会让正在打字的框失焦)。rows 是 [种类, 编号, 数据];box 是容器的 id,或者容器本身(宣传的分组)
  // 「待发」只放还没点的(先送来的在上面),「收件」只放还没定的(新的在上面);
  // 待发里点过「已发 / 跳过」的、收件里点过决定的,一起放「已处理」(最近点的在上面)
  function place(boxId, rows) {
    const box = typeof boxId === "string" ? $(boxId) : boxId;
    const want = rows.map(([k, id]) => k + ":" + id);
    for (const [k, id, d] of rows) {
      const key = k + ":" + id;
      let el = S.cards.get(key);
      if (!el) { el = k === "out" ? outCard(id) : k === "in" ? inCard(id) : reachCard(id); el._key = key; S.cards.set(key, el); }
      el._update(d);
    }
    const now = [...box.children].map((c) => c._key);
    if (now.join("|") !== want.join("|")) want.forEach((k) => box.append(S.cards.get(k)));
  }
  // 收件里点过决定的、回过的(你点「我已回复」,或刷新时认出你在 X 上回了),都算处理过
  const handledIn = (d) => !!(d && (d.decision || d.replied));
  function sync(kind) {
    const store = kind === "out" ? S.out : S.inn;
    const keys = new Set([...store.keys()].map((id) => kind + ":" + id));
    for (const [key, el] of S.cards) if (key.startsWith(kind + ":") && !keys.has(key)) { el.remove(); S.cards.delete(key); }
    if (kind === "out") {
      const pend = [...S.out.entries()].filter(([, d]) => isPend(d)).sort((a, b) => String(a[1].created_at || "").localeCompare(String(b[1].created_at || ""))).map(([id, d]) => ["out", id, d]);
      // 今天(北京时间)还能放出几条对人的首回:按这个顺序放,多的排队。先算好,卡片照着显示
      S.quota = gate([...S.out.values()], pend.map((r) => r[2]), capOf(S.docs.rules));
      place("out-cards", pend);
      $("out-empty").hidden = pend.length > 0;
      $("out-empty").textContent = S.out.size > pend.length
        ? "待发的都处理完了。点过「已发 / 跳过」的在下面的「已处理」里。"
        : "还没有待发的。机器人交帖后,我把原帖逐条看过,写好回复放在这里;每天的项目帖也放这里。";
    } else {
      const pend = [...S.inn.entries()].filter(([, d]) => !handledIn(d)).sort((a, b) => String((b[1].mine || {}).at || "").localeCompare(String((a[1].mine || {}).at || ""))).map(([id, d]) => ["in", id, d]);
      place("in-cards", pend);
      $("in-empty").hidden = pend.length > 0;
      $("in-empty").textContent = S.inn.size > pend.length
        ? "收件里的都处理完了。点过决定的、回过的在下面的「已处理」里。"
        : "还没有评论。每 20 分钟自动刷新一次,也可以点上面的「刷新」。";
    }
    const done = [
      ...[...S.out.entries()].filter(([, d]) => !isPend(d)).map(([id, d]) => ["out", id, d]),
      ...[...S.inn.entries()].filter(([, d]) => handledIn(d)).map(([id, d]) => ["in", id, d]),
    ].sort((a, b) => String(b[2].decided_at || b[2].replied_at || "").localeCompare(String(a[2].decided_at || a[2].replied_at || "")) || String(b[2].created_at || "").localeCompare(String(a[2].created_at || "")));
    place("done-cards", done);
    $("done-empty").hidden = done.length > 0;
  }

  function apply(json) {
    S.docs = json.docs || {};
    S.watchOff = new Set(json.watchOff || []);
    S.needs = Array.isArray(json.needs) ? json.needs : [];
    S.leads = Array.isArray(json.leads) ? json.leads : [];
    S.auto = json.auto && typeof json.auto === "object" ? json.auto : {};
    S.outStats = json.outStats && typeof json.outStats === "object" ? json.outStats : {};
    S.hits = json.hits && typeof json.hits === "object" ? json.hits : {};
    S.problems = json.problems && typeof json.problems === "object" ? json.problems : null; // 问题记录的数(最近 7 天、30 天)
    S.out = new Map((json.outbox || []).map((d) => [d.id, d]));
    S.inn = new Map((json.inbox || []).map((d) => [d.id, d]));
    S.reach = new Map((Array.isArray(json.outreach) ? json.outreach : []).map((d) => [d.id, d]));
    sync("out");
    sync("in");
    syncReach();
    renderTop(json);
    renderData();
  }

  // ---------- 顶部 ----------
  function renderTop(json) {
    const pend = [...S.out.values()].filter(isPend);
    const pendOut = pend.length, pendPosts = pend.filter(isPost).length, pendReplies = pendOut - pendPosts;
    const queued = S.quota.queued.size, ready = pendReplies - queued; // 排队的回复今天发不了,不催
    const pendIn = [...S.inn.values()].filter((d) => !handledIn(d)).length;
    $("n-out").textContent = pendOut; $("n-out").classList.toggle("due", pendOut - queued > 0);
    $("n-in").textContent = pendIn; $("n-in").classList.toggle("due", pendIn > 0);
    $("n-done").textContent = S.out.size - pendOut + S.inn.size - pendIn;
    const pendReach = [...S.reach.values()].filter(isPend).length;
    $("n-reach").textContent = pendReach; $("n-reach").classList.toggle("due", pendReach > 0);
    const items = [];
    if (ready || pendPosts) items.push({ text: [ready ? ready + " 条回复" : "", pendPosts ? pendPosts + " 条项目帖" : ""].filter(Boolean).join("、") + "等你发(点「在 X 打开」发出去就行)", href: "#outbox", when: "今天" });
    if (queued) items.push({ text: queued + " 条回复在排队:今天" + (S.quota.used >= S.quota.cap ? "已到上限 " : "上限 ") + S.quota.cap + " 条,明天放出", href: "#outbox", when: "明天" });
    if (pendIn) items.push({ text: pendIn + " 条评论等你看(回一句,或点一个决定)", href: "#inbox", when: "今天" });
    if (pendReach) items.push({ text: pendReach + " 份宣传等你发(投稿、邮件、清单、社区;发出去以后点「已发」)", href: "#reach", when: "今天" });
    const lost = [...S.out.values()].filter((d) => !isPost(d) && d.status === "已发" && !safeUrl(d.reply_url) && Date.now() - Date.parse(d.decided_at || 0) > 864e5 && Date.now() - Date.parse(d.decided_at || 0) < 7 * 864e5).length;
    if (lost) items.push({ text: lost + " 条回复点了「在 X 打开」,一天了还没在 X 上找到你发的,可能没发出去(在「已处理」里点「改回待发」)", href: "#done", when: "今天" });
    if (json && json.synced) $("sync-at").textContent = json.synced.at ? "上次刷新 " + mdhm(json.synced.at) + (json.synced.note ? " · " + json.synced.note : "") : "";
    // 定时任务停了要说出来(「没有新东西」和「根本没跑」不是一回事)
    const late = (x, hrs) => x && x.at && (Date.now() - Date.parse(x.at)) / 3600e3 > hrs;
    if (late(S.auto.sync, 3) || (S.auto.sync && S.auto.sync.ok === false)) items.push({ text: "自动刷新没跑成,看「数据」最下面的「定时任务」", href: "#data", when: "今天" });
    else if (syncBlind(S.auto.sync)) items.push({ text: "自动刷新一条帖子都没读到,看「数据」最下面的「定时任务」", href: "#data", when: "今天" });
    if (late(S.auto.monitor, 14)) items.push({ text: "项目变动监控超过 14 小时没跑,看「数据」最下面的「定时任务」", href: "#data", when: "今天" });
    const asks = S.docs.summary && S.docs.summary.asks;
    for (const a of Array.isArray(asks) ? asks : []) if (a && typeof a.text === "string") items.push(a);
    $("todo").replaceChildren(...(items.length ? items.map((a) => h("li", null,
      h("span", { class: "when " + (a.when === "不急" || a.when === "明天" ? "later" : "now") }, a.when || "今天"),
      a.href && /^#[a-z]+$/.test(a.href) ? h("a", { href: a.href }, a.text) : h("span", null, a.text))) : [h("li", { class: "none" }, "今天没有要你做的。")]));
    const upd = S.docs.summary && S.docs.summary.updatedAt;
    $("upd").textContent = upd ? "我 " + mdhm(upd) + " 更新" : "";
  }

  // ---------- 数据 ----------
  // 网站自己数的体检次数(/api/hit,不带地址):放在目标里「陌生人来体检」那一行下面,和我送来的数分开写
  function hitLine(c) {
    if (!c || typeof c.total !== "number") return null;
    const today = new Date(todayBJ()).toISOString().slice(0, 10);
    const n = c.byDay && typeof c.byDay[today] === "number" ? c.byDay[today] : 0;
    return h("p", { class: "note" }, "网站自己数的:共 " + fmt(c.total) + " 个地址,今天 " + fmt(n) + " 个" + (c.since ? "(" + String(c.since).slice(5) + " 起)" : "")
      + "。同一个浏览器同一个地址只算一次;你登过运营台的浏览器不算,钱包里的浏览器打开一次 defiexit.com/#owner 也不算。");
  }
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
      return h("div", { class: "g-row" }, h("span", { class: "name" }, it.label), valEl, meter, it.note ? h("p", { class: "note" }, it.note) : null,
        it.key === "checks" ? hitLine(S.hits.checkup) : null);
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
    // 回帖试验只数回帖,不数自己发的帖子
    const replies = [...S.out.values()].filter((d) => !isPost(d));
    const live = { drafted: replies.length, posted: replies.filter((d) => d.status === "已发").length };
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

  // 大家最常问(问题记录,服务器只给数):最近 7 天、30 天每种问题几条(两边都没有的不列,「其他」放最后)、问得多的协议、我们回了几条
  const PROBLEM = { "bridge-wait": "跨链 / L2 提款要等", "chain-shutdown": "链关停", migration: "换币迁移", "unstake-wait": "解押排队", "frontend-down": "官网打不开", "wallet-missing": "钱包看不到", "deadline-missed": "错过截止", scam: "遇到骗子", other: "其他" };
  function problemPanel(p) {
    if (!p || !p.d7 || !p.d30) return null;
    const { d7, d30 } = p;
    if (!d7.total && !d30.total) return h("div", { class: "panel" }, h("h3", null, "大家最常问"),
      h("p", { class: "empty" }, "还没有记录。机器人找到的、官方公告底下的、我们帖子底下的,说自己钱卡住的帖子,我核过原帖以后按问题记在这里(只记数,不记账号),用来决定先写哪篇说明。"));
    const n = (w, k) => (w.byType && typeof w.byType[k] === "number" ? w.byType[k] : 0);
    const keys = [...new Set([...Object.keys(PROBLEM), ...Object.keys(d30.byType || {}), ...Object.keys(d7.byType || {})])]
      .filter((k) => n(d30, k) || n(d7, k))
      .sort((a, b) => (a === "other") - (b === "other") || n(d30, b) - n(d30, a) || n(d7, b) - n(d7, a));
    const sum = (label, w) => h("div", { class: "li" },
      h("span", { class: "k" }, label),
      h("span", { class: "nm" }, w.total ? "我们回了 " + fmt(w.replied) + " 条 / 共 " + fmt(w.total) + " 条" : "还没有"),
      // 协议名和条数之间是不换行的空格:手机上折行时数字不会掉到下一行
      w.total && Array.isArray(w.byProtocol) && w.byProtocol.length ? h("span", { class: "sub" }, "问得多的协议:" + w.byProtocol.map((r) => r.protocol + "\u00a0" + fmt(r.n)).join(" · ")) : null);
    return h("div", { class: "panel" },
      h("h3", null, "大家最常问"),
      h("div", { class: "list" }, sum("7 天", d7), sum("30 天", d30)),
      h("div", { class: "tbl-wrap" }, h("table", null,
        h("thead", null, h("tr", null, h("th", null, "问题"), h("th", { class: "num" }, "7 天"), h("th", { class: "num" }, "30 天"))),
        h("tbody", null, ...keys.map((k) => h("tr", null, h("td", null, PROBLEM[k] || k), h("td", { class: "num" }, fmt(n(d7, k))), h("td", { class: "num" }, fmt(n(d30, k)))))))),
      h("p", { class: "src" }, "机器人找到的、官方公告底下的、我们帖子底下的,一条帖子记一次,按发帖那天(北京时间)算;只有数,不带账号和链接。"));
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

  // 监控找到的项目变动线索(公开信息;来源链接服务器只收白名单里的网站)
  const LEAD_KIND = { "事件": "hi", "论坛": "mute", "锁仓骤降": "warn" };
  const hostName = (u) => { try { return new URL(u).hostname; } catch (_) { return ""; } };
  function leadsPanel(rows) {
    if (!rows.length) return h("div", { class: "panel" }, h("h3", null, "项目变动线索"),
      h("p", { class: "empty" }, "还没有。监控每 6 小时跑一次,找到会影响「能不能取、怎么取」的变动就列在这里;我核过官方原文再写成帖子放进「待发」。"));
    return h("div", { class: "panel" }, h("h3", null, "项目变动线索(最近 " + rows.length + " 条)"),
      h("div", { class: "list" }, ...rows.map((l) => h("div", { class: "li" },
        h("span", { class: "k" }, String(l.when || l.found_at || "").slice(5, 10)),
        h("span", { class: "nm" }, h("b", null, l.protocol || "?"), ":" + (l.text || "")),
        h("span", { class: "pill " + (LEAD_KIND[l.kind] || "mute") }, l.kind || "线索"),
        h("span", { class: "sub" }, /^https:\/\//.test(String(l.source || "")) ? out(l.source, "来源 " + hostName(l.source) + " ↗") : "", l.site ? " · 官网 " + l.site : "", l.x ? " · " + l.x : "")))),
      h("p", { class: "src" }, "都只是线索,不等于事实;我核过官方原文再写成帖子。"));
  }

  // 我们发出去的帖子和回复:最近点了「已发」的 40 条,带最新读数
  function minePanel(outbox) {
    const items = [...outbox.values()].filter((d) => d.status === "已发").sort((a, b) => String(b.decided_at || "").localeCompare(String(a.decided_at || ""))).slice(0, 40);
    if (!items.length) return null;
    return h("div", { class: "panel" }, h("h3", null, "我们发的帖子和回复"),
      h("div", { class: "list" }, ...items.map((d) => {
        const m = d.mine || {}, t = m.target || {}, x = statOf(d), url = safeUrl(d.reply_url) ? d.reply_url : null;
        return h("div", { class: "li" + (url ? "" : " muted") },
          h("span", { class: "k" }, isPost(d) ? "帖子" : "回复"),
          h("span", { class: "nm" }, isPost(d) ? (m.topic || d.id) : "回 @" + (t.handle || "?") + (t.protocol ? " · " + t.protocol : "")),
          h("span", { class: "pill " + (x ? (x.replies ? "warn" : "ok") : "mute") }, x ? statText(x) : url ? "等读数" : "还没链接"),
          h("span", { class: "sub" }, url ? out(url, mdhm(d.decided_at) + " 发 ↗") : mdhm(d.decided_at) + " 发"));
      })),
      h("p", { class: "src" }, "点了「已发」、链接核到了的,7 天内每 20 分钟轮着读浏览、点赞、回复;别人接着回的进「收件」,我起草接着回的话。自己发的帖子要在卡片上贴一次链接。"));
  }

  // 刷新跑了、但被监控的帖子一条都没读到(和「没有新评论」不是一回事)
  function syncBlind(x) { return !!(x && x.ok !== false && x.failed > 0 && x.read === 0); }

  // 定时任务(GitHub 上每小时刷新、每 6 小时监控):上次什么时候跑的、成没成
  function autoPanel(a) {
    const row = (name, x, maxH, text, blind = () => false) => {
      if (!x || !x.at) return h("div", { class: "li" }, h("span", { class: "k" }, name), h("span", { class: "nm" }, "还没跑过"), h("span", { class: "pill warn" }, "等第一次"), h("span", { class: "sub" }, ""));
      const ageH = (Date.now() - Date.parse(x.at)) / 3600e3;
      const late = ageH > maxH, bad = x.ok === false || blind(x);
      return h("div", { class: "li" + (late || bad ? "" : " muted") },
        h("span", { class: "k" }, name), h("span", { class: "nm" }, text(x)),
        h("span", { class: "pill " + (late || bad ? "stop" : "ok") }, late ? "超过 " + Math.round(ageH) + " 小时没跑" : bad ? "没成功" : "正常"),
        h("span", { class: "sub" }, "上次 " + mdhm(x.at)));
    };
    return h("div", { class: "panel" }, h("h3", null, "定时任务"),
      h("div", { class: "list" },
        row("刷新", a.sync, 3, (x) => (x.ok === false ? "没刷成:" + (x.error || "原因不明") : (x.read == null ? "" : "读到 " + x.read + " 条帖子,") + "新评论 " + (x.newReplies || 0) + " 条" + (x.failed ? ",有 " + x.failed + " 条没读到" + (Array.isArray(x.errors) && x.errors.length ? ":" + x.errors.join("、") : "") : "")), syncBlind),
        row("监控", a.monitor, 14, (x) => "读了 " + (x.read == null ? "?" : x.read) + " 个来源,新线索 " + (x.stored || 0) + " 条" + (Array.isArray(x.failed) && x.failed.length ? ";没读到:" + x.failed.join("、") : ""), (x) => x.read === 0)),
      h("p", { class: "src" }, "GitHub 上的定时任务:每小时刷新一次评论和读数,每 6 小时盯一次项目变动。超过时间没跑会标红,顶上「今天要你做的」也会提醒。"));
  }

  // 某一块的数据格式不对,只让那一块显示一句话,别的照常
  function safe(fn, d) {
    try { return fn(d); } catch (_) { return h("p", { class: "empty" }, "这一块的数据格式不对,我下次干活时修。"); }
  }
  function renderData() {
    const D = S.docs;
    const parts = [safe(goalPanel, D.goal_1215), safe(routePanel, D.funnel), safe(viewsPanel, D.x_posts), safe(minePanel, S.out), safe(leadsPanel, S.leads), safe(problemPanel, S.problems), safe(protocolPanel, D.protocols), safe(needsPanel, S.needs), safe(clocksPanel, D.clocks), safe(botPanel, D.bot), safe(autoPanel, S.auto)].filter(Boolean);
    $("data-body").replaceChildren(...(parts.length ? parts : [h("p", { class: "empty" }, "还没有数据。我下次干活时送进来。")]));
  }

  // ---------- 登录、设管理员、刷新、退出 ----------
  function bindForms() {
    $("login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.currentTarget, msg = $("login-msg");
      const btn = f.querySelector("button");
      btn.disabled = true;
      const { status, json } = await api("login", { name: f.name.value.trim(), password: f.password.value, remember: f.remember.checked });
      btn.disabled = false;
      if (status === 200 && json.ok) { f.password.value = ""; msg.textContent = ""; load(); }
      else note(msg, why(json) + (json.seconds ? "(约 " + json.seconds + " 秒)" : ""), true);
    });
    $("setup-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.currentTarget, msg = $("setup-msg");
      if (f.password.value.length < 8) return note(msg, WHY.weak, true);
      if (f.password.value !== f.password2.value) return note(msg, WHY.mismatch, true);
      const btn = f.querySelector("button");
      btn.disabled = true;
      const { status, json } = await api("setup", { code: f.code.value.trim(), name: f.name.value.trim(), password: f.password.value, remember: f.remember.checked });
      btn.disabled = false;
      if (status === 200 && json.ok) { f.reset(); load(); }
      else note(msg, why(json), true);
    });
    // 「刷新」:先请服务器去 X 上读一次(新评论、读数),再把运营台的内容整个重新拉一遍(我送来的草稿、分析也一起到)
    $("refresh").addEventListener("click", async (e) => {
      const btn = e.currentTarget, msg = $("sync-msg");
      btn.disabled = true;
      msg.textContent = "正在读 X 上的新评论和读数…";
      const { status, json } = await api("sync", {});
      btn.disabled = false;
      if (status === 401) return show("login");
      const errs = (status === 200 && Array.isArray(json.errors)) ? json.errors : [];
      if (status === 200 && json.ok) note(msg, "刷新好了:读到 " + (json.read || 0) + " 条,新评论 " + (json.newReplies || 0) + " 条" + (errs.length ? ";有 " + errs.length + " 条没读到(" + errs.join("、") + "),不算「没有新评论」" : ""), errs.length > 0);
      else if (json.error === "busy") note(msg, "两分钟内刚刷新过,已把最新的内容拉下来");
      else note(msg, why(json) + ";已把最新的内容拉下来", true);
      load();
    });
    $("pace-ok").addEventListener("click", () => { $("pace").hidden = true; });
    $("logout").addEventListener("click", async () => { await api("logout", {}); show("login"); });
    $("logout-all").addEventListener("click", async () => { await api("logout-all", {}); show("login"); });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !$("desk").hidden) load(); });
  }

  // 设置链接 defiexit.com/admin/#setup=…:把码填进去,再从地址栏抹掉(# 后面的内容不会发给服务器)
  (function takeSetupCode() {
    const m = /^#setup=([A-Za-z0-9_-]{20,100})$/.exec(location.hash);
    if (!m) return;
    $("setup-code").value = m[1];
    $("setup-hint").textContent = "设置码已经从链接里带进来了。起个用户名和密码(密码至少 8 位,别和别的网站用同一个)。";
    try { history.replaceState(null, "", location.pathname); } catch (_) { /* 抹不掉也不影响 */ }
  })();
  bindForms();
  load();
})();
