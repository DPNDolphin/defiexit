// 项目变动监控(GitHub Actions 每 6 小时跑一次;只读公开数据,不登录任何账号,不碰 X):
// 找会影响存款人「能不能取、怎么取」的变动,写成线索交给 scripts/ops-task.mjs 送进运营台「项目变动线索」。
// 来源:① DefiLlama 协议列表里编辑标注的事件(只能取不能存、迁移、被攻击……);② 一天内锁仓掉得多的大协议;
//       ③ 各大协议治理论坛(Discourse)标题里带关停、暂停、迁移、取款等词的新帖。
// 不记状态:按时间窗口取(论坛 forumHours 小时内新建的、事件 eventDays 天内的),重复的由运营台按 key 去重。
// 线索只是线索:主窗口核过官方原文才写成帖子。来源和门槛在 sources.json。
// 用法:node scripts/monitor/monitor.mjs [输出文件,默认 leads.json]
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CFG = JSON.parse(readFileSync(join(HERE, "sources.json"), "utf8"));
const OUT = process.argv[2] || "leads.json";
const KW = new RegExp(CFG.keywords.join("|"), "i");
const HEAD = { "User-Agent": "defiexit-monitor/1.0 (+https://defiexit.com)", Accept: "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bjDay = (d = new Date()) => new Date(+d + 8 * 3600e3).toISOString().slice(0, 10);

async function getJson(url, tries = 3) {
  let last = "";
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: HEAD, signal: AbortSignal.timeout(45000) });
      if (r.ok) return await r.json();
      last = "HTTP " + r.status;
      if (r.status === 404 || r.status === 403) break;
    } catch (e) { last = e.message; }
    await sleep(2500 * (i + 1));
  }
  throw new Error(last || "读不到");
}

async function llama(leads) {
  const C = CFG.llama, W = CFG.windows;
  const list = await getJson("https://api.llama.fi/protocols");
  const now = Date.now() / 1000, today = bjDay();
  for (const p of list) {
    if (!p.slug || C.skipCategories.includes(p.category)) continue;
    const base = { protocol: p.name, category: p.category, chains: (p.chains || []).slice(0, 4), tvl: Math.round(p.tvl || 0), source: "https://defillama.com/protocol/" + p.slug, site: p.url || "", x: p.twitter ? "@" + p.twitter : "" };
    for (const h of p.hallmarks || []) {
      if (!Array.isArray(h) || typeof h[0] !== "number") continue;
      const [ts, text] = [h[0], String(h[1] ?? "")];
      if (now - ts > W.eventDays * 86400 || ts - now > 86400) continue;
      if ((p.tvl || 0) >= C.eventMinTvl || KW.test(text)) leads.push({ ...base, kind: "事件", key: `event|${p.slug}|${ts}|${text}`, when: new Date(ts * 1000).toISOString().slice(0, 10), text });
    }
    if ((p.tvl || 0) >= C.minTvl && typeof p.change_1d === "number" && p.change_1d <= C.drop1d) {
      leads.push({ ...base, kind: "锁仓骤降", key: `drop|${p.slug}|${today}`, when: today, text: `24 小时锁仓 ${p.change_1d.toFixed(1)}%,现在约 ${(p.tvl / 1e6).toFixed(0)}M 美元(原因要查:可能是被攻击、迁移、大户撤出或币价跌)` });
    }
  }
  return list.length;
}

async function forums(leads, failed) {
  const W = CFG.windows;
  let ok = 0;
  for (const f of CFG.forums) {
    const base = f.url.replace(/\/$/, "");
    try {
      const j = await getJson(base + "/latest.json?order=created");
      for (const t of (j && j.topic_list && j.topic_list.topics) || []) {
        if (typeof t.id !== "number") continue;
        if (Date.now() - Date.parse(t.created_at || 0) > W.forumHours * 3600e3) continue;
        const title = String(t.title || t.fancy_title || "");
        const tags = (t.tags || []).map((x) => String((x && x.name) || x));
        if (KW.test(title) || tags.some((x) => KW.test(x))) {
          leads.push({ kind: "论坛", key: `forum|${base}|${t.id}`, protocol: f.name, when: String(t.created_at || "").slice(0, 10), text: title, source: `${base}/t/${t.slug}/${t.id}` });
        }
      }
      ok++;
    } catch (e) { failed.push(f.name + "(" + e.message + ")"); }
    await sleep(700);
  }
  return ok;
}

const leads = [], failed = [];
let protos = 0;
try { protos = await llama(leads); } catch (e) { failed.push("DefiLlama(" + e.message + ")"); }
const forumOk = await forums(leads, failed);
const read = (protos ? 1 : 0) + forumOk;
writeFileSync(OUT, JSON.stringify({ read, failed, leads: leads.slice(0, 100) }, null, 1));
console.log(`线索 ${leads.length} 条;DefiLlama ${protos} 个协议;论坛 ${forumOk}/${CFG.forums.length}` + (failed.length ? `;没读到:${failed.join("、")}` : ""));
for (const l of leads.slice(0, 40)) console.log(`- [${l.kind}] ${l.when || ""} ${l.protocol}:${l.text}  ${l.source}`);
