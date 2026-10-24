// tracking-issue-title.test.ts のヘルパー。
import { assert, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadYamlAs } from "../../../lib/text/yaml-as.ts";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const LIB = "skills/kaizen/scripts/tracking-issue-lib.sh";
export const libPath = join(repoRoot, LIB);
export const libSource = () => readFileSync(libPath, "utf8");

// 同じ lib を source するワークフローの一覧。片方だけ直る余地を残さないため一括で検査する。
export const WORKFLOWS = [
  {
    path: ".github/workflows/kaizen-schedule.yml",
    prefix: "kaizen: 未適用の学び",
    // 追跡 Issue が 1 件も見つからず、新規作成へ進む条件。
    createEnv: { PENDING_COUNT: "3" },
    // 追跡 Issue を閉じる側（何もしない側）へ進む条件。
    closeEnv: { PENDING_COUNT: "0" },
    // ステップの挙動を決める入力。空・仕様外の値なら、gh を呼ばずに失敗すること。
    gateVar: "PENDING_COUNT",
    badValues: ["", "3件", "-1"],
  },
  {
    path: ".github/workflows/outdated.yml",
    prefix: "mise outdated tool versions",
    createEnv: { HAS_OUTDATED: "true" },
    closeEnv: { HAS_OUTDATED: "false" },
    gateVar: "HAS_OUTDATED",
    badValues: ["", "TRUE", "1"],
  },
];

// `gh issue list` を失敗させるスタブ。変更系の呼び出しは GH_LOG へ記録する。
export const GH_FAILING = `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1-}" = issue ] && [ "\${2-}" = list ]; then
  echo "gh: HTTP 403: You have exceeded a secondary rate limit" >&2
  exit 1
fi
printf 'CALL: %s\\n' "$*" >>"$GH_LOG"
`;

// 一致 0 件を正常に返すスタブ（新規作成の分岐へ到達することを示す確認用）。
export const GH_EMPTY = `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1-}" = issue ] && [ "\${2-}" = list ]; then
  echo "scanned=0"
  exit 0
fi
printf 'CALL: %s\\n' "$*" >>"$GH_LOG"
`;

/**
 * **照会の呼び出しまで記録する**スタブ。`gh` を呼ぶ前に失敗すること（照会できないときの停止の起点）は、
 * 変更系だけを記録するスタブでは測れない。照会が実行されても記録が空のままになる。
 * 返す本文は `LIST_OUT` で与え、`--search` 付きと無しで出し分けたいときは `LIST_OUT_2` を使う。
 */
export const GH_LOGGING = `#!/usr/bin/env bash
set -euo pipefail
printf 'CALL: %s\\n' "$*" >>"$GH_LOG"
if [ "\${1-}" = issue ] && [ "\${2-}" = list ]; then
  n="$(grep -c '^CALL: issue list' "$GH_LOG")"
  if [ "$n" -ge 2 ] && [ -n "\${LIST_OUT_2-}" ]; then
    printf '%s\\n' "$LIST_OUT_2"
  else
    printf '%s\\n' "\${LIST_OUT-scanned=0}"
  fi
fi
`;

/** ステップが `date -u +%F` で得る UTC の日付。テストでは固定し、日付の境目で結果が変わらないようにする。 */
export const TODAY = "2026-09-14";

/**
 * スタブ化した `gh` と `date` を PATH 前段に置いて bash スクリプトを実行する。
 * `date` は `-u +%F` のときだけ TODAY を返し、ほかの引数は PATH の後ろにある本物に渡す。
 */
export function runBash(script: string, ghScript: string, env: NodeJS.ProcessEnv) {
  const dir = makeTempDir("tracking-step-");
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin, { recursive: true });
    const gh = join(bin, "gh");
    writeFileSync(gh, ghScript);
    chmodSync(gh, 0o755);
    const date = join(bin, "date");
    writeFileSync(
      date,
      `#!/usr/bin/env bash\nif [ "$*" = "-u +%F" ]; then echo ${TODAY}; exit 0; fi\nPATH="\${PATH#*:}" exec date "$@"\n`,
    );
    chmodSync(date, 0o755);
    const file = join(dir, "step.sh");
    writeFileSync(file, script);
    const log = join(dir, "gh.log");
    writeFileSync(log, "");
    const res = spawnSync("bash", ["-eo", "pipefail", file], {
      timeout: CHILD_TIMEOUT_MS,
      cwd: dir,
      encoding: "utf8",
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: dir,
        LC_ALL: "C.UTF-8",
        GH_LOG: log,
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "o/r",
        GITHUB_RUN_ID: "1",
        BODY_FILE: join(dir, "body.md"),
        ...env,
      },
    });
    return { ...res, calls: readFileSync(log, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** lib を source して `script` を実行する（lib の挙動を実測する）。 */
export function runLib(script: string, ghScript: string, env: NodeJS.ProcessEnv) {
  return runBash(`. ${JSON.stringify(libPath)}\n${script}\n`, ghScript, env);
}

const STEP_NAME = "Update tracking issue";
const LOCATE_STEP = "Locate kaizen scripts";

/** テストが読むワークフローの形（使うフィールドだけ）。 */
type WorkflowStep = { name?: string; id?: string; run: string; env?: Record<string, unknown> };
type Workflow = {
  env?: Record<string, unknown>;
  jobs: Record<string, { steps?: WorkflowStep[]; env?: Record<string, unknown> }>;
};

/** ワークフローの指定ステップ（宣言そのもの）を返す。 */
function step(wfPath: string, name: string) {
  const doc = loadYamlAs<Workflow>(readFileSync(join(repoRoot, wfPath), "utf8"));
  // `uses:` で再利用ワークフローを呼ぶ job には `steps` が無い（TypeError で落ちるのを避ける）。
  const steps = Object.values(doc.jobs).flatMap((job) => job.steps ?? []);
  const matched = steps.filter((s) => s.name === name);
  // 0 件・複数件を合格として扱わない（ステップ名を変えたら検査が空振りするだけになる）。
  expect(matched, `${wfPath}: "${name}" ステップ`).toHaveLength(1);
  const [found] = matched;
  assert.exists(found, `${wfPath}: "${name}" ステップが無い`);
  return found;
}

/** 追跡 Issue 更新ステップの `run` を返す。 */
export function trackingStep(wfPath: string) {
  return step(wfPath, STEP_NAME).run;
}

/**
 * ワークフローが `env:` で宣言している値を返す（0 件・複数件は落とす）。
 * **実行テストへはこの値を渡す**。ハードコードした期待値を渡すと、宣言を消す変異で
 * テストが緑のまま通り、空の値でステップが実行されていることに気づけない（実測）。
 */
export function declaredEnv(wfPath: string, key: string) {
  const doc = loadYamlAs<Workflow>(readFileSync(join(repoRoot, wfPath), "utf8"));
  const scopes = [
    doc.env ?? {},
    ...Object.values(doc.jobs).map((j) => j.env ?? {}),
    step(wfPath, STEP_NAME).env ?? {},
  ];
  const found = scopes.map((e) => e[key]).filter((v) => v !== undefined);
  // 宣言は 1 箇所だけ（`run` へ直書きすると照合と表示でずれる）。0 件も複数件も落とす。
  expect(found, `${wfPath}: env の ${key} 宣言`).toHaveLength(1);
  return String(found[0]);
}

/**
 * ステップの `TRACKING_LIB` 宣言が**実在する lib を指していること**を確かめる。
 *
 * kaizen 側は `Locate kaizen scripts` の出力を受けるので、**その探索ステップを実際に実行して**
 * 解決する（ハードコードすると、探索が lib を出さなくなる変異で緑のまま通る）。
 * outdated 側はリポジトリ内の相対パス直書きなので、実在を確かめてから絶対パスにする。
 *
 * **返り値を実行テストへは渡さない。** 探索は `.claude/skills/kaizen/scripts` を先に見るので、
 * ここで解決した先は**インストール済みコピー**になりうる。それを source して測ると、
 * 再インストール前の週に原本ではない別のファイルを測ることになり、原本へ入れた退行が
 * 緑のまま通る（ミューテーションテストで実際に起きた）。実行は原本（`libPath`）で測り、
 * コピーとの一致は `scripts/gates/packaging/copies/check-skills-sync.ts` が別に見る。
 */
export function resolveLib(wfPath: string) {
  const declared = declaredEnv(wfPath, "TRACKING_LIB");
  const m = declared.match(/^\$\{\{\s*steps\.([\w-]+)\.outputs\.(\w+)\s*\}\}$/);
  if (!m) {
    expect(declared, "TRACKING_LIB は式かリポジトリ内の相対パス").not.toMatch(/\$\{\{/);
    const abs = join(repoRoot, declared);
    expect(existsSync(abs), `${wfPath}: TRACKING_LIB=${declared} が実在しない`).toBe(true);
    return abs;
  }
  const [, stepId, output] = m;
  expect(step(wfPath, LOCATE_STEP).id, `${wfPath}: ${LOCATE_STEP} の id`).toBe(stepId);
  const found = runLocate(wfPath, repoRoot);
  expect(found.status, found.stderr).toBe(0);
  const value = found.outputs[output];
  expect(value, `${LOCATE_STEP} が ${output} を出力していない`).toBeTruthy();
  const abs = join(repoRoot, value);
  expect(existsSync(abs), `${LOCATE_STEP} が出した ${value} が実在しない`).toBe(true);
  return abs;
}

/** 探索ステップを `cwd` で実際に実行し、`$GITHUB_OUTPUT` へ書かれた値を返す。 */
export function runLocate(wfPath: string, cwd: string) {
  const dir = makeTempDir("tracking-locate-");
  try {
    const out = join(dir, "output.txt");
    writeFileSync(out, "");
    const file = join(dir, "locate.sh");
    writeFileSync(file, step(wfPath, LOCATE_STEP).run);
    const res = spawnSync("bash", ["-eo", "pipefail", file], {
      timeout: CHILD_TIMEOUT_MS,
      cwd,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HOME: dir,
        LC_ALL: "C.UTF-8",
        GITHUB_OUTPUT: out,
      },
    });
    const outputs = Object.fromEntries(
      readFileSync(out, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
    return { ...res, outputs };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `--jq '<式>'` の中身を取り出す。 */
export function jqFilter(source: string) {
  const m = source.match(/--jq '([\s\S]*?)'\s*$/m);
  assert.exists(m, "--jq の式を取り出せない");
  return m[1];
}

/** jq 式の照合を測る検体。hit は、照合が拾うべき Issue かどうか。 */
export function jqProbeCases(prefix: string): {
  title: string;
  number: number;
  hit: boolean;
  state?: string;
  why: string;
}[] {
  return [
    { title: prefix, number: 1, hit: true, why: "日付を入れる前の既存追跡 Issue" },
    { title: `${prefix} (2026-09-14)`, number: 2, hit: true, why: "通常の世代" },
    { title: `${prefix} (2026-09-21)`, number: 3, hit: true, why: "別の世代" },
    // `--search` の `is:open` はインデックス側評価で、閉じた直後の Issue が open として
    // 返る（結果整合は偽陰性だけでなく偽陽性にも振れる）。返ってきた `state` で落とす。
    {
      title: `${prefix} (2026-09-07)`,
      number: 9,
      hit: false,
      state: "CLOSED",
      why: "閉じた直後でインデックスが追いついていない",
    },
    { title: `${prefix} について相談`, number: 4, hit: false, why: "接頭辞で始まるだけ" },
    { title: `${prefix} (2026-9-1)`, number: 5, hit: false, why: "日付の桁が足りない" },
    { title: `${prefix}(2026-09-21)`, number: 6, hit: false, why: "空白が無い" },
    { title: `x ${prefix} (2026-09-21)`, number: 7, hit: false, why: "接頭辞で始まらない" },
    {
      title: `${prefix} (2026-09-21) 追記`,
      number: 8,
      hit: false,
      why: "日付の後ろに続きがある",
    },
  ];
}
