// 运营台的定时任务(.github/workflows/ops-cron.yml 每小时跑):用一把「小钥匙」请运营台干活。
// 这把钥匙只能做两件事:刷新(评论、读数),往「项目变动线索」里加线索;改不了待发、收件、看板(见 server/ops/task.js)。
// 私钥在 GitHub 的保密设置 DX_TASK_KEY(PEM),不放在任何电脑上;公钥在 wrangler.toml 的 TASK_PUBKEYS。
// 用法:node scripts/ops-task.mjs sync
//       node scripts/ops-task.mjs leads leads.json      (leads.json 是 scripts/monitor/monitor.mjs 写的)
import { createPrivateKey, sign, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = (process.env.DX_OPS_URL || "https://defiexit.com").replace(/\/+$/, "");
const ENV = process.env.DX_OPS_ENV || "production";
const PATH = "/api/admin/task";
const pem = process.env.DX_TASK_KEY || "";
if (!pem.includes("PRIVATE KEY")) { console.error("没有 DX_TASK_KEY(GitHub 保密设置里要有这把钥匙)"); process.exit(2); }

const [cmd, file] = process.argv.slice(2);
let body;
if (cmd === "sync") body = { do: "sync" };
else if (cmd === "leads" && file) {
  const j = JSON.parse(readFileSync(file, "utf8"));
  body = { do: "leads", leads: (j.leads || []).slice(0, 100), read: j.read, failed: (j.failed || []).slice(0, 30) };
} else { console.error("用法:node scripts/ops-task.mjs sync | leads <leads.json>"); process.exit(2); }

const raw = JSON.stringify({ v: 1, ts: Date.now(), nonce: randomBytes(18).toString("base64url"), ...body });
const sig = sign(null, Buffer.from(`dx-task-v1\n${ENV}\nPOST\n${PATH}\n${raw}`), createPrivateKey(pem)).toString("base64url");
const r = await fetch(BASE + PATH, { method: "POST", headers: { "Content-Type": "application/json", "X-DX-Sig": sig }, body: raw, signal: AbortSignal.timeout(60000) });
const text = await r.text();
console.log(`${cmd}: HTTP ${r.status} ${text.slice(0, 300)}`);
// 运营台还没上线这个入口(旧版本回 404,或者把它当成网页请求回 403 origin)、刚刷过或今天次数满了(429):这次跳过,不算失败
const notYet = r.status === 404 || (r.status === 403 && /"origin"/.test(text));
if (notYet) console.log("运营台还没上线这个入口,这次跳过");
if (notYet || r.status === 429) process.exit(0);
process.exit(r.ok ? 0 : 1);
