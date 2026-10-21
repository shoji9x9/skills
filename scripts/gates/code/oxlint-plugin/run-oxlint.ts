// テストから oxlint を実物のまま起動し、診断を読む（oxlint-plugin/ のルールと oxlint-pending.ts のテストが使う）。
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord } from "../../../lib/guards.ts";
import { isArray } from "../../../lib/is-array.ts";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";

export const REPO_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const PLUGIN_PATH = join(REPO_DIR, "scripts/gates/code/oxlint-plugin/plugin.ts");

/** oxlint の診断。rule は設定のキーと同じ字面（`max-params`・`skills-repo/import-direction`）。 */
export type Diagnostic = { file: string; rule: string; line: number; message: string };

/** 診断の code（`eslint(max-params)`・`skills-repo(import-direction)`）を、設定のキーの字面にする。 */
export function ruleOf(code: string): string {
  const m = /^([\w-]+)\((.+)\)$/.exec(code);
  if (!m) throw new Error(`oxlint の診断の code を読めない: ${code}`);
  return m[1] === "eslint" ? m[2] : `${m[1]}/${m[2]}`;
}

/** oxlint の JSON の診断 1 件を読む。読めない形は、判定できないので例外にする。 */
export function toDiagnostic(d: unknown): Diagnostic {
  // JS プラグインのルールが例外を投げると、code の無い診断（Error running JS plugin）になる。違反ではなく実行の失敗として扱う。
  if (isRecord(d) && d.code === undefined && typeof d.message === "string")
    throw new Error(`oxlint を実行できない（JS プラグインの例外）: ${d.message}`);
  const label = isRecord(d) && isArray(d.labels) ? d.labels[0] : undefined;
  const span = isRecord(label) ? label.span : undefined;
  if (
    !isRecord(d) ||
    typeof d.code !== "string" ||
    typeof d.filename !== "string" ||
    typeof d.message !== "string" ||
    !isRecord(span) ||
    typeof span.line !== "number"
  )
    throw new Error("oxlint の診断の形を読めない");
  return { file: d.filename, rule: ruleOf(d.code), line: span.line, message: d.message };
}

/**
 * oxlint を実行して診断を返す。args は `-c <設定>` とファイルなど、oxlint にそのまま渡す引数。
 * 違反が無い（exit 0）か、違反がある（exit 1）とき以外は、判定できないので例外にする。
 */
export function runOxlint(
  args: readonly string[],
  { cwd = REPO_DIR, env = {} }: { cwd?: string; env?: Record<string, string> } = {},
): Diagnostic[] {
  const res = spawnSync("pnpm", ["exec", "oxlint", "--format", "json", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: CHILD_TIMEOUT_MS,
  });
  if (res.status !== 0 && res.status !== 1)
    throw new Error(`oxlint を実行できない（exit ${res.status}）: ${res.stderr}${res.stdout}`);
  // 設定の誤り（ルールのオプションの誤りなど）でも exit 1 で終わり、JSON ではない説明を出す。
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    throw new Error(`oxlint を実行できない（出力が JSON でない）: ${res.stdout}${res.stderr}`);
  }
  const diagnostics = isRecord(parsed) ? parsed.diagnostics : undefined;
  if (!isArray(diagnostics)) throw new Error(`oxlint の出力に diagnostics が無い: ${res.stdout}`);
  return diagnostics.map(toDiagnostic);
}
