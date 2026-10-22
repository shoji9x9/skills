// artifact-health-check.test.ts が使うヘルパーと fixture。
import { expect, assert } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  RENDER_INPUTS,
  featureMetadata,
  makeCarryProject,
  type ScopeTuple,
} from "../evidence/evidence-carry-fixture.ts";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";
import { parseJsonAs } from "../../../lib/parse-as.ts";
import { isArray } from "../../../lib/is-array.ts";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";

/** 機能の metadata.json のうち、反復実行の記録の指紋を書き換える欄。 */
export type RepeatRunMetadata = {
  suite: { repeat_run: { runs: { suite_fingerprint: unknown }[] } };
};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const script = join(repoRoot, "skills/parity-suite/scripts/artifact-health-check.mjs");
// 期待値はスクリプトと同じ関数から取る（テスト側で計算規則を複製すると、両方が同時に間違っても緑になる）。
export const {
  main,
  suiteFingerprint,
  stripJsComments,
}: typeof import("../../../../skills/parity-suite/scripts/artifact-health-check.mjs") =
  await import(pathToFileURL(script).href);

/** artifact_health.entries の 1 件。 */
type ArtifactEntry = {
  path: string;
  kind: string;
  read_by: string[];
  unread_reason: string | null;
  derived_from: { path: string; sha256: string } | null;
  freshness_unverified_reason: string | null;
};

/** repeat_run.runs の 1 件。 */
type RunRecord = {
  started_at: string;
  result: string;
  suite_fingerprint?: string;
  shared_fingerprint?: string;
  spec_fingerprints?: Record<string, string>;
};

/** スペック単位の分類表・共有ファイル・current から外すスペックの 1 件。 */
type SpecEntry = { path: string; state_mutating: boolean; reason: string };
type PathReason = { path: string; reason: string };

/** suite.repeat_run。スペック単位の欄（specs・shared_files・current_excluded）は perSpecProject だけが持つ。 */
type RepeatRun = {
  cleanup_in_suite: boolean;
  runs: RunRecord[];
  reason: string | null;
  specs?: SpecEntry[];
  shared_files?: PathReason[];
  current_excluded?: PathReason[];
};

/** suite。interactions は共有ファイルとして指紋に入れる宣言パス。 */
type Suite = {
  current_green?: boolean;
  specs?: string;
  expectations?: string;
  interactions?: string;
  state_mutating: boolean;
  repeat_run: RepeatRun;
};

/** artifact_health。採取物を持たないスイートは declared: false と理由だけを書く。 */
type DeclaredArtifactHealth = {
  declared: true;
  baseline_dir?: string;
  entries: ArtifactEntry[];
  reason: null;
};
type ArtifactHealth = DeclaredArtifactHealth | { declared: false; reason: string };

/** unmeasured.entries の 1 件。 */
type UnmeasuredEntry = {
  item: string;
  reason: string;
  disposition: string;
  approved_by: string | null;
  approved_at: string | null;
};

/** metadata.json のうち、テストが書き換える部分。 */
type Metadata = {
  slug: string;
  suite: Suite;
  unmeasured: { declared: boolean; entries: UnmeasuredEntry[]; reason: string | null };
  artifact_health: ArtifactHealth;
};

/** perSpecProject の metadata.json（スペック単位の欄を持つ）。 */
export type PerSpecMetadata = Metadata & {
  suite: Suite & {
    repeat_run: RepeatRun & {
      specs: SpecEntry[];
      shared_files: PathReason[];
      current_excluded: PathReason[];
    };
  };
};

/** declared: true の artifact_health（baseMetadata の形）を取り出す。 */
export function declaredHealth(m: Metadata): DeclaredArtifactHealth {
  const health = m.artifact_health;
  assert(health.declared, "artifact_health が declared: true でない");
  return health;
}

/** suite がスペック単位の欄（specs・shared_files・current_excluded）を持つか。 */
function isPerSpec(m: Metadata): m is PerSpecMetadata {
  const rr = m.suite.repeat_run;
  return isArray(rr.specs) && isArray(rr.shared_files) && isArray(rr.current_excluded);
}

const XLSX_BODY = "row-a\nrow-b\n";
const xlsxSha = createHash("sha256").update(XLSX_BODY).digest("hex");

/** 健全な metadata.json（4 節すべてが条件を満たす）。 */
const baseMetadata = (): Metadata => ({
  slug: "order-list",
  suite: {
    current_green: true,
    state_mutating: false,
    repeat_run: {
      cleanup_in_suite: false,
      runs: [],
      reason: "読み取りだけの機能で書き込み操作を持たない",
    },
  },
  unmeasured: { declared: true, entries: [], reason: null },
  artifact_health: {
    declared: true,
    baseline_dir: ".replace/parity/order-list/baseline",
    entries: [
      {
        path: "orders.default.desktop.png",
        kind: "captured",
        read_by: ["e2e/parity/order-list/orders.spec.ts"],
        unread_reason: null,
        derived_from: null,
        freshness_unverified_reason: null,
      },
      {
        path: "orders.xlsx",
        kind: "captured",
        read_by: [],
        unread_reason: "実体は展開結果の元であり、スペックは展開結果だけを読む",
        derived_from: null,
        freshness_unverified_reason: null,
      },
      {
        path: "orders.xlsx.json",
        kind: "derived",
        read_by: ["e2e/parity/order-list/orders.spec.ts"],
        unread_reason: null,
        derived_from: { path: "orders.xlsx", sha256: xlsxSha },
        freshness_unverified_reason: null,
      },
    ],
    reason: null,
  },
});

/**
 * プロジェクトの雛形を作る。
 * @param {(m: ReturnType<typeof baseMetadata>) => void} [mutate] metadata の書き換え
 * @param {{ xlsxBody?: string, extraBaselineFile?: string, specBody?: string, dataset?: unknown }} [opts]
 */
export function makeProject(
  mutate?: (m: Metadata) => void,
  opts: {
    xlsxBody?: string;
    extraBaselineFile?: string;
    specBody?: string;
    dataset?: unknown;
  } = {},
) {
  const root = makeTempDir("artifact-health-");
  const slugDir = join(root, ".replace/parity/order-list");
  mkdirSync(join(slugDir, "baseline"), { recursive: true });
  mkdirSync(join(slugDir, "new/local-dev"), { recursive: true });
  mkdirSync(join(root, ".replace/dataset"), { recursive: true });
  mkdirSync(join(root, "e2e/parity/order-list"), { recursive: true });

  writeFileSync(join(slugDir, "baseline/orders.xlsx"), opts.xlsxBody ?? XLSX_BODY);
  writeFileSync(join(slugDir, "baseline/orders.xlsx.json"), '{"rows":["row-a","row-b"]}\n');
  writeFileSync(join(slugDir, "baseline/orders.default.desktop.png"), "PNG\n");
  if (opts.extraBaselineFile !== undefined) {
    writeFileSync(join(slugDir, "baseline", opts.extraBaselineFile), "stray\n");
  }
  writeFileSync(
    join(root, "e2e/parity/order-list/orders.spec.ts"),
    opts.specBody ?? "// orders.default.desktop.png と orders.xlsx.json を読む\n",
  );
  mkdirSync(join(root, "e2e/parity/lib"), { recursive: true });
  writeFileSync(
    join(root, "e2e/parity/lib/expectations.ts"),
    "export const expected = { total: 3 };\n",
  );
  writeFileSync(
    join(root, ".replace/dataset/metadata.json"),
    JSON.stringify(
      opts.dataset ?? {
        version: 7,
        changes: Array.from({ length: 7 }, (_, i) => ({ version: i + 1, affects: ["orders"] })),
      },
    ),
  );

  const metadata = baseMetadata();
  if (mutate) mutate(metadata);
  const metadataPath = join(slugDir, "metadata.json");
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  return { root, slugDir, metadataPath };
}

/**
 * main を同じプロセスで呼ぶ（子プロセスの起動を省く。ミューテーションテストが変異ごとにこのファイルを丸ごと回すため、Issue #478）。
 * CLI として起動できること（エントリ判定・引数と出力の受け渡し）は cli() の通ることの確認が受け持つ。
 * @param {string} metadataPath
 * @param {string[]} [extra]
 */
export function run(metadataPath: string, extra: string[] = []) {
  let stdout = "";
  let stderr = "";
  const status = main(["--metadata", metadataPath, ...extra], {
    out: (s) => (stdout += s),
    err: (s) => (stderr += s),
  });
  return { status, stdout, stderr };
}

/**
 * 子プロセスとして CLI を起動する。
 * @param {string} metadataPath
 * @param {string[]} [extra]
 */
export function cli(metadataPath: string, extra: string[] = []) {
  const r = spawnSync(process.execPath, [script, "--metadata", metadataPath, ...extra], {
    timeout: CHILD_TIMEOUT_MS,
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/**
 * 新側の工程が回った状態（replace-metadata.json ＋ diff-metadata.json）を作る。
 * @param {string} slugDir
 * @param {Record<string, unknown>} diffMeta
 * @param {Record<string, unknown>} [replaceExtra] replace-metadata.json へ足す記録
 */
export function writeStage(
  slugDir: string,
  diffMeta: Record<string, unknown>,
  replaceExtra: Record<string, unknown> = {},
) {
  writeFileSync(
    join(slugDir, "new/local-dev/replace-metadata.json"),
    JSON.stringify({ suite: { new_green: true }, ...replaceExtra }),
  );
  writeFileSync(join(slugDir, "new/local-dev/diff-metadata.json"), JSON.stringify(diffMeta));
}

/**
 * 状態を変えるスイートを 2 回緑で回した metadata を作る。
 * @param {string | null} fingerprint 記録する指紋（null なら記録しない＝旧成果物）
 */
export function mutatingSuite(fingerprint: string | null): Suite {
  const runs: RunRecord[] = [
    { started_at: "2026-09-17T01:00:00Z", result: "green" },
    { started_at: "2026-09-17T02:00:00Z", result: "green" },
  ];
  if (fingerprint !== null) for (const r of runs) r.suite_fingerprint = fingerprint;
  return {
    current_green: true,
    specs: "e2e/parity/order-list",
    expectations: "e2e/parity/lib/expectations.ts",
    state_mutating: true,
    repeat_run: { cleanup_in_suite: true, runs, reason: null },
  };
}

/** 指紋の対象（mutatingSuite と同じ宣言）。 */
export const FP_SUITE = {
  specs: "e2e/parity/order-list",
  expectations: "e2e/parity/lib/expectations.ts",
};

/**
 * 状態を変えるスイートを、いまのスイートの指紋で 2 回緑として記録したプロジェクトを作る。
 * @param {{ specBody?: string, legacy?: boolean }} [opts]
 */
export function recordedProject(opts: { specBody?: string; legacy?: boolean } = {}) {
  const project = makeProject(
    (m) => {
      m.suite = mutatingSuite("placeholder");
    },
    opts.specBody === undefined ? {} : { specBody: opts.specBody },
  );
  const fp = suiteFingerprint(FP_SUITE, project.root, { legacy: opts.legacy === true }).fingerprint;
  const meta = parseJsonAs<RepeatRunMetadata>(readFileSync(project.metadataPath, "utf8"));
  for (const r of meta.suite.repeat_run.runs) r.suite_fingerprint = fp;
  writeFileSync(project.metadataPath, JSON.stringify(meta, null, 2));
  return { ...project, fp, specPath: join(project.root, "e2e/parity/order-list/orders.spec.ts") };
}

/**
 * makeProject に持ち越しの fixture（新側 git リポジトリ・変更宣言・部品 metadata・amend-verify の記録）を足す。
 * @param {[string, string, string][]} scope 機能が撮った組
 * @param {Record<string, unknown>} [replaceNewExtra] replace-metadata.json の new へ足す値
 */
export function carryProject(
  scope: ScopeTuple[],
  replaceNewExtra: Record<string, unknown> = { render_inputs: RENDER_INPUTS },
) {
  const conditions = featureMetadata(scope);
  const made = makeProject((m) => {
    Object.assign(m, { mode: "feature", capture_conditions: conditions.capture_conditions });
    // makeCarryProject が現側の基準（baseline_dir の下）に置く amend-verify の current 画像を採取物として宣言する
    declaredHealth(m).entries.push({
      path: "list/hover/desktop/screenshot.png",
      kind: "captured",
      read_by: [],
      unread_reason: "部品改修の機械判定（amend-verify）の現側の入力としてだけ読む",
      derived_from: null,
      freshness_unverified_reason: null,
    });
  });
  const carry = makeCarryProject({ root: made.root });
  writeStage(
    made.slugDir,
    {
      new: { target: "local-dev", commit: carry.commits.base },
      iteration: 3,
      dataset_version: 7,
      converged: true,
    },
    {
      new: {
        target: "local-dev",
        commit: carry.commits.component,
        dirty: false,
        ...replaceNewExtra,
      },
      loop: { iterations: 3 },
    },
  );
  return { ...made, carry };
}

export const SPEC_DIR = "e2e/parity/order-list";
export const LOCALE = `${SPEC_DIR}/locale.spec.ts`;
export const ORDERS = `${SPEC_DIR}/orders.spec.ts`;

/**
 * スペック単位の分類表を持つプロジェクトを作る（locale.spec.ts が状態を変え、orders.spec.ts は変えない）。
 * runs は空。記録は recordRuns で --fingerprint の出力から書く。
 */
export function perSpecProject(mutate?: (m: PerSpecMetadata) => void) {
  const project = makeProject((m) => {
    m.suite = {
      current_green: true,
      specs: SPEC_DIR,
      expectations: "e2e/parity/lib/expectations.ts",
      state_mutating: true,
      repeat_run: {
        cleanup_in_suite: true,
        specs: [
          { path: ORDERS, state_mutating: false, reason: "一覧を表示して読むだけ" },
          { path: LOCALE, state_mutating: true, reason: "ロケールを保存し、同じテストで戻す" },
        ],
        current_excluded: [
          {
            path: `${SPEC_DIR}/new-only`,
            reason:
              "current プロジェクトの testIgnore で除外（parity-diff が新側採取スペックを置く）",
          },
        ],
        shared_files: [
          { path: `${SPEC_DIR}/helpers.ts`, reason: "画面を開く共通関数。テストを定義しない" },
        ],
        runs: [],
        reason: null,
      },
    };
    if (mutate) {
      assert(isPerSpec(m), "suite がスペック単位の欄を持たない");
      mutate(m);
    }
  });
  writeFileSync(join(project.root, LOCALE), "test('locale', async () => { save('ja'); });\n");
  writeFileSync(join(project.root, SPEC_DIR, "helpers.ts"), "export const open = () => 1;\n");
  return project;
}

/** --fingerprint の出力を読む。 */
export function fingerprints(metadataPath: string): {
  suite_fingerprint: string;
  shared_fingerprint: string;
  spec_fingerprints: Record<string, string>;
} {
  const r = run(metadataPath, ["--fingerprint"]);
  expect(r.status).toBe(0);
  return parseJsonAs<ReturnType<typeof fingerprints>>(r.stdout);
}

/**
 * 回したスペックを 2 回緑で記録する（--fingerprint の出力からコピーする）。
 * @param {string} metadataPath
 * @param {string[]} ranSpecs
 * @param {{ day: string, times?: number }} options - day は started_at の日付部分（記録を足すたびに後の日付を渡す）。
 *   times は回数（状態を変えないスペックだけを回すなら 1）
 */
export function recordRuns(
  metadataPath: string,
  ranSpecs: string[],
  { day, times = 2 }: { day: string; times?: number },
) {
  const fp = fingerprints(metadataPath);
  const meta = parseJsonAs<PerSpecMetadata>(readFileSync(metadataPath, "utf8"));
  for (const hour of ["01", "02"].slice(0, times)) {
    meta.suite.repeat_run.runs.push({
      started_at: `${day}T${hour}:00:00Z`,
      result: "green",
      shared_fingerprint: fp.shared_fingerprint,
      spec_fingerprints: Object.fromEntries(ranSpecs.map((s) => [s, fp.spec_fingerprints[s]])),
    });
  }
  writeFileSync(metadataPath, JSON.stringify(meta, null, 2));
}

export function editMetadata(metadataPath: string, mutate: (m: PerSpecMetadata) => void) {
  const meta = parseJsonAs<PerSpecMetadata>(readFileSync(metadataPath, "utf8"));
  mutate(meta);
  writeFileSync(metadataPath, JSON.stringify(meta, null, 2));
}
