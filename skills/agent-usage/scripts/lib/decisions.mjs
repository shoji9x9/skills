// ブランチごとの「記録するか」の判断。リポジトリには入れず、git の共通のディレクトリ（worktree で共有）に置く。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isRecord } from "./config.mjs";

/** @typedef {"record" | "decline"} Decision */

/**
 * @param {string} commonDir
 * @returns {string}
 */
export function decisionsPath(commonDir) {
  return join(commonDir, "agent-usage", "decisions.json");
}

/**
 * @param {string} commonDir
 * @returns {Record<string, { decision: Decision; at: string }>}
 */
export function loadDecisions(commonDir) {
  const path = decisionsPath(commonDir);
  if (!existsSync(path)) return {};
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(raw)) throw new Error(`${path}: オブジェクトでない`);
  /** @type {Record<string, { decision: Decision; at: string }>} */
  const out = {};
  for (const [branch, v] of Object.entries(raw)) {
    if (
      !isRecord(v) ||
      (v.decision !== "record" && v.decision !== "decline") ||
      typeof v.at !== "string"
    ) {
      throw new Error(`${path}: ${branch} の判断が不正`);
    }
    out[branch] = { decision: v.decision, at: v.at };
  }
  return out;
}

/**
 * @param {string} commonDir
 * @param {string} branch
 * @returns {Decision | null}
 */
export function decisionFor(commonDir, branch) {
  const all = loadDecisions(commonDir);
  return Object.hasOwn(all, branch) ? all[branch].decision : null;
}

/**
 * @param {string} commonDir
 * @param {string} branch
 * @param {Decision} decision
 * @param {number} now
 */
export function saveDecision(commonDir, branch, decision, now) {
  const all = loadDecisions(commonDir);
  all[branch] = { decision, at: new Date(now).toISOString() };
  const path = decisionsPath(commonDir);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(all, null, 2)}\n`);
  renameSync(tmp, path);
}
