// 检测器登记表:配方里的 "detector" 字段对应这里的名字。
// 新增检测器:写一个 detect(address) → { status, usd, lines, warnings, note, flags, vars },在这里登记,
// 再把它要访问的接口加进 scripts/site.mjs 的 connect。
// 能做现场诊断的,再写一个 diagnose(address) → { at, step, facts, findings, choice },登记到 diagnosers。
// 合计不是「到账多少 USDC」的(比如 WOOFi 有好几种币),detect 再返回 total: { label, value };
// 到账核对查到好几笔的,arrival 里给 items: [{ sym, amount, text }]。
import { detect as hyperliquid, diagnose as hyperliquidDiagnose } from "./hyperliquid.js";
import { detect as woofi, diagnose as woofiDiagnose } from "./woofi.js";

export const detectors = { hyperliquid, woofi };
export const diagnosers = { hyperliquid: hyperliquidDiagnose, woofi: woofiDiagnose };
