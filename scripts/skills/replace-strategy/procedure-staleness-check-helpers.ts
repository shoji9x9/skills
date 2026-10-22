// procedure-staleness-check.test.ts のヘルパー。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert } from "vitest";
import {
  main,
  readProcedureLedger,
  readRevisions,
} from "../../../skills/replace-strategy/scripts/procedure-staleness-check.mjs";
import { parseJsonAs } from "../../lib/parse-as.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

/** CLI が stdout に出す JSON のうち、テストが読む項目。 */
export type Entry = {
  change: string;
  slug: string;
  state: string;
  placement: string;
  record: string;
  axis: string;
  basis: string;
  reason: string;
};
export type Output = {
  ledger_exists: boolean;
  unresolved: Entry[];
  resolved: Entry[];
  handed_off: Entry[];
  undeterminable: Entry[];
  artifacts: Entry[];
  stray: unknown[];
  errors: string[];
};
/** readRevisions・readProcedureLedger が失敗したときの結果。各テストは直前に `ok` が false であることを確かめる。 */
export type Failed = { ok: false; errors: string[] };
export type ReadLedger = Extract<ReturnType<typeof readProcedureLedger>, { ok: true }>;

/** 読み取りが失敗した結果として扱う。成功していたらテストを失敗させる。 */
export function failedOf(
  result: ReturnType<typeof readProcedureLedger> | ReturnType<typeof readRevisions>,
): Failed {
  assert(!result.ok, "失敗するはずの読み取りが成功した");
  return result;
}

/** 台帳の読み取りが成功した結果として扱う。失敗していたらテストを失敗させる。 */
export function ledgerOf(result: ReturnType<typeof readProcedureLedger>): ReadLedger {
  assert(result.ok, `台帳の読み取りが失敗した: ${JSON.stringify(result)}`);
  return result;
}

export const REVISIONS = {
  skill: "parity-suite",
  revision: 2,
  changes: [
    { revision: 1, axis: "導入点", affects: ["feature", "api-resource", "batch"] },
    { revision: 2, axis: "0 件の表示", affects: ["feature"] },
  ],
};

export const CHANGE_HEADER =
  "| ID | 追加日 | 足した軸 | 由来 | 対象の種類 | 見直しの置き場 |\n|---|---|---|---|---|---|\n";
export const RECORD_HEADER =
  "| 記録 ID | 変更 ID | slug | 判断 | 記録日 | 根拠・理由 |\n|---|---|---|---|---|---|\n";

/**
 * 台帳の本文を組み立てる。
 * @param {string[]} changes 「観点の追加」表の行
 * @param {string[]} records 「既に閉じた機能への当て直し」表の行
 */
export function ledger(changes: string[], records: string[]) {
  return (
    "# 台帳\n\n## 観点の追加\n\n" +
    CHANGE_HEADER +
    changes.map((row) => `${row}\n`).join("") +
    "\n## 既に閉じた機能への当て直し\n\n" +
    RECORD_HEADER +
    records.map((row) => `${row}\n`).join("")
  );
}

/**
 * 作業ディレクトリを作る。
 * @param {{ revisions?: unknown, ledger?: string, artifacts?: Record<string, unknown> }} spec
 */
export function workspace(spec: {
  revisions?: unknown;
  ledger?: string;
  artifacts?: Record<string, string | object | null>;
}) {
  const work = makeTempDir("procedure-staleness-");
  writeFileSync(join(work, "revisions.json"), JSON.stringify(spec.revisions ?? REVISIONS));
  mkdirSync(join(work, ".replace", "parity"), { recursive: true });
  if (spec.ledger !== undefined)
    writeFileSync(join(work, ".replace", "procedure-changes.md"), spec.ledger);
  for (const [slug, meta] of Object.entries(spec.artifacts ?? {})) {
    mkdirSync(join(work, ".replace", "parity", slug), { recursive: true });
    if (meta !== null) {
      writeFileSync(
        join(work, ".replace", "parity", slug, "metadata.json"),
        typeof meta === "string"
          ? meta
          : JSON.stringify(Object.hasOwn(meta, "slug") ? meta : { slug, ...meta }),
      );
    }
  }
  return work;
}

/**
 * 成果物の metadata.json を組み立てる。
 * @param {Record<string, unknown>} run
 * @param {string} [mode]
 */
export function meta(run: Record<string, unknown>, mode: string = "feature") {
  return { mode, run: { finished_at: "2026-09-10T00:00:00Z", ...run } };
}

/**
 * CLI を直接呼ぶ。
 * @param {string} work
 * @param {string[]} [extra]
 */
export function run(work: string, extra: string[] = []) {
  let stdout = "";
  let stderr = "";
  const code = main(["--revisions", "revisions.json", ...extra], {
    cwd: work,
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
  });
  return { code, stdout, stderr, json: stdout ? parseJsonAs<Output>(stdout) : null };
}

/** 台帳に addedAt に足した PC-001 を置き、order の成果物の終了日時を finishedAt にして CLI を実行する。 */
export function runFinishedAt(addedAt: string, finishedAt: string) {
  return run(
    workspace({
      ledger: ledger([`| PC-001 | ${addedAt} | 軸 | 由来 | feature | #1 |`], []),
      artifacts: { order: meta({ procedure_revision: 2, finished_at: finishedAt }) },
    }),
  );
}
