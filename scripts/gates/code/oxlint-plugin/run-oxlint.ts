// oxlint を実物のまま起動し、診断を読む（check-skill-lint-directives.ts・oxlint-pending.ts のテスト・oxlint-plugin/ のテストが使う）。
// 本番のチェックも使うので、テスト用の補助（lib/testing/）を import しない。テスト用の補助は run-rule.ts に置く。
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord } from "../../../lib/guards.ts";
import { isArray } from "../../../lib/is-array.ts";

export const REPO_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const PLUGIN_PATH = join(REPO_DIR, "scripts/gates/code/oxlint-plugin/plugin.ts");
/** 本番のチェックの打ち切りの時間。CI の負荷でも終わる長さにする（テストは短い時間を渡す）。 */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * oxlint の診断。rule は設定のキーと同じ字面（`max-params`・`skills-repo/import-direction`）。
 * offset はファイルの中の UTF-8 のバイト位置。
 */
export type Diagnostic = {
  file: string;
  rule: string;
  line: number;
  offset: number;
  message: string;
};

/** 使われていない disable コメントの診断（reportUnusedDisableDirectives）の rule。oxlint は code を付けない。 */
export const UNUSED_DIRECTIVE = "unused-disable-directive";

/** 診断の code（`eslint(max-params)`・`skills-repo(import-direction)`）を、設定のキーの字面にする。 */
export function ruleOf(code: string): string {
  const m = /^([\w-]+)\((.+)\)$/.exec(code);
  if (!m) throw new Error(`oxlint の診断の code を読めない: ${code}`);
  return m[1] === "eslint" ? m[2] : `${m[1]}/${m[2]}`;
}

/**
 * code の無い診断の rule。使われていない disable コメントなら UNUSED_DIRECTIVE。
 * それ以外（JS プラグインのルールが投げた例外・ファイルの構文の誤り）は、判定できないので実行の失敗として例外にする。
 */
function ruleWithoutCode(message: string): string {
  if (/^Unused \S+-disable directive/.test(message)) return UNUSED_DIRECTIVE;
  const cause = message.startsWith("Error running JS plugin")
    ? "JS プラグインの例外"
    : "構文の誤りなど";
  throw new Error(`oxlint を実行できない（${cause}）: ${message}`);
}

/** oxlint の JSON の診断 1 件を読む。読めない形は、判定できないので例外にする。 */
export function toDiagnostic(d: unknown): Diagnostic {
  if (!isRecord(d) || typeof d.message !== "string") throw new Error("oxlint の診断の形を読めない");
  const rule = typeof d.code === "string" ? ruleOf(d.code) : ruleWithoutCode(d.message);
  const label = isArray(d.labels) ? d.labels[0] : undefined;
  const span = isRecord(label) ? label.span : undefined;
  if (
    typeof d.filename !== "string" ||
    !isRecord(span) ||
    typeof span.line !== "number" ||
    typeof span.offset !== "number"
  )
    throw new Error("oxlint の診断の形を読めない");
  return { file: d.filename, rule, line: span.line, offset: span.offset, message: d.message };
}

/**
 * oxlint を実行して診断を返す。args は `-c <設定>` とファイルなど、oxlint にそのまま渡す引数。
 * 違反が無い（exit 0）か、違反がある（exit 1）とき以外は、判定できないので例外にする。
 */
export function runOxlint(
  args: readonly string[],
  {
    cwd = REPO_DIR,
    env = {},
    timeout = DEFAULT_TIMEOUT_MS,
  }: { cwd?: string; env?: Record<string, string>; timeout?: number } = {},
): Diagnostic[] {
  const res = spawnSync("pnpm", ["exec", "oxlint", "--format", "json", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
    // 一覧のすべてを検査すると、JSON は数百 KB になる。デフォルトの 1 MiB を超えて status が null になるのを避ける。
    maxBuffer: 64 * 1024 * 1024,
  });
  // 打ち切り（signal）と起動の失敗（error）は status が null になるので、原因を出力に残す。
  if (res.status !== 0 && res.status !== 1) {
    const cause =
      res.error?.message ?? (res.signal ? `signal ${res.signal}（timeout ${timeout} ms）` : "");
    throw new Error(
      `oxlint を実行できない（exit ${res.status}${cause ? `、${cause}` : ""}）: ${res.stderr}${res.stdout}`,
    );
  }
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
