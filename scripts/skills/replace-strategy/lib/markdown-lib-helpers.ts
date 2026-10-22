// markdown-lib.test.ts のヘルパー。
import { parseTables } from "../../../../skills/replace-strategy/scripts/lib/markdown.mjs";
import { readProcedureLedger } from "../../../../skills/replace-strategy/scripts/procedure-staleness-check.mjs";

export const lines = (...xs: string[]) => [...xs, ""].join("\n");

// セルの値を前後の空白を除いて返す（コメントを空白に置き換えた分の空白を比べない）。
export const cells = (text: string) =>
  parseTables(text).tables.flatMap((t) => t.rows.map((r) => r.map((c) => c.trim())));
export const PC = (id: string) => `| ${id} | 2026-09-20 | 軸 | 由来 | feature | #1 |`;
export const procedureIds = (text: string) => {
  const r = readProcedureLedger(text, new Set());
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.changes.map((c) => c.id);
};
export const PLAN = (api: string) =>
  `| plan | 計画管理 | ${api} | ${api}: measured | MST_PLAN | #210 |`;
export const COPY = (kind: string) => `| ${kind} | 実体をコピーする | 有効 |`;

export const norm = (text: string) => cells(text).map((r) => r.map((c) => c.replace(/\s+/gu, " ")));
