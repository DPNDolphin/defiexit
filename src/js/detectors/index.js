// 检测器登记表:配方里的 "detector" 字段对应这里的名字。
// 新增检测器:写一个 detect(address) → { status, usd, lines, warnings, note, flags, vars },在这里登记,
// 再把它要访问的接口加进 scripts/site.mjs 的 connect。
// 能做现场诊断的,再写一个 diagnose(address) → { at, step, facts, findings, choice },登记到 diagnosers。
import { detect as hyperliquid, diagnose as hyperliquidDiagnose } from "./hyperliquid.js";

export const detectors = { hyperliquid };
export const diagnosers = { hyperliquid: hyperliquidDiagnose };
