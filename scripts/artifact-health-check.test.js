// parity-suite の採取物・工程の健全性チェッカ（artifact-health-check.mjs）の回帰テスト（Issue #382 / #278）。
//
// 採取物は工程の出力であり次の工程の入力なのに、「読まれたか」「いま正しいか」を数える段が無いと
// 4 つの形で緑のまま抜ける——読み手のいない採取物・古い加工物・回っていない工程・1 回だけ回した状態変更スイート。
// 加えて、gaps.md の散文は収束判定の入力ではないため、未測定と書いてあっても収束する（#278）。
//
// 陽性コントロール（健全な成果物が exit 0、旧成果物は判定しない）を置く——これが無いと「常に落とす」実装と区別できない。

import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-suite/scripts/artifact-health-check.mjs");
// 期待値はスクリプトと同じ関数から取る（テスト側で計算規則を複製すると、両方が同時に間違っても緑になる）。
const { suiteFingerprint } = await import(pathToFileURL(script).href);

const XLSX_BODY = "row-a\nrow-b\n";
const xlsxSha = createHash("sha256").update(XLSX_BODY).digest("hex");

/** 健全な metadata.json（4 節すべてが条件を満たす）。 */
const baseMetadata = () => ({
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
function makeProject(mutate, opts = {}) {
  const root = mkdtempSync(join(tmpdir(), "artifact-health-"));
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
 * @param {string} metadataPath
 * @param {string[]} [extra]
 */
function run(metadataPath, extra = []) {
  const r = spawnSync(process.execPath, [script, "--metadata", metadataPath, ...extra], {
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("陽性コントロール: 健全な成果物は exit 0", () => {
  const { root, metadataPath } = makeProject();
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("読み手も unread_reason も無い採取物を落とす", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.artifact_health.entries[1].unread_reason = null;
  });
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/読み手が宣言されておらず unread_reason も空/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("read_by の字面照合は名前の一部が一致する別ファイルに当たらない", () => {
  const { root, metadataPath } = makeProject(
    (m) => {
      // 展開結果（orders.xlsx.json）だけを読むスペックに、元の orders.xlsx の読み手を主張させる。
      m.artifact_health.entries[1].read_by = ["e2e/parity/order-list/orders.spec.ts"];
      m.artifact_health.entries[1].unread_reason = null;
    },
    { specBody: "// orders.default.desktop.png と orders.xlsx.json を読む\n" },
  );
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/字面の照合で不一致.*orders\.xlsx /);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("baseline_dir に在るのに宣言が無いファイルを落とす", () => {
  const { root, metadataPath } = makeProject(undefined, { extraBaselineFile: "stray.aria.yml" });
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/採取物が宣言されていない.*stray\.aria\.yml/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("元の実体が採り直された加工物（sha256 不一致）を落とす", () => {
  const { root, metadataPath } = makeProject(undefined, { xlsxBody: "row-a\nrow-b\nrow-c\n" });
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/加工物が古い（元の実体の sha256 が宣言と一致しない）/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("read_by が指すスペックに採取物の名前が現れなければ落とす（字面の照合）", () => {
  const { root, metadataPath } = makeProject(undefined, { specBody: "// 何も読まない\n" });
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/字面の照合で不一致/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("derived_from も freshness_unverified_reason も無い加工物を落とす", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.artifact_health.entries[2].derived_from = null;
  });
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/derived_from が無く freshness_unverified_reason も空/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("freshness_unverified_reason を書けば未検証として残して通す", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.artifact_health.entries[2].derived_from = null;
    m.artifact_health.entries[2].freshness_unverified_reason =
      "展開は別ツールで、元のハッシュを取れない";
  });
  const r = run(metadataPath);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("状態を変えるスイートの実行記録が 1 件なら落とす", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.suite.state_mutating = true;
    m.suite.repeat_run = {
      cleanup_in_suite: true,
      runs: [{ started_at: "2026-09-17T01:00:00Z", result: "green" }],
      reason: null,
    };
  });
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/実行記録が 1 件/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("2 回続けて緑なら通す", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.suite.state_mutating = true;
    m.suite.repeat_run = {
      cleanup_in_suite: true,
      runs: [
        { started_at: "2026-09-17T01:00:00Z", result: "green" },
        { started_at: "2026-09-17T01:20:00Z", result: "green" },
      ],
      reason: null,
    };
  });
  const r = run(metadataPath);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("2 回の started_at が同じなら落とす（1 回の記録の写しと区別が付かない）", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.suite.state_mutating = true;
    m.suite.repeat_run = {
      cleanup_in_suite: true,
      runs: [
        { started_at: "2026-09-17T01:00:00Z", result: "green" },
        { started_at: "2026-09-17T01:00:00Z", result: "green" },
      ],
      reason: null,
    };
  });
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/started_at が同じ/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("後始末がスイートの外なら落とす", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.suite.state_mutating = true;
    m.suite.repeat_run = {
      cleanup_in_suite: false,
      runs: [
        { started_at: "2026-09-17T01:00:00Z", result: "green" },
        { started_at: "2026-09-17T01:20:00Z", result: "green" },
      ],
      reason: null,
    };
  });
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/cleanup_in_suite が true でない/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("artifact_health.declared: true なのに state_mutating が無ければ落とす", () => {
  const { root, metadataPath } = makeProject((m) => {
    delete m.suite.state_mutating;
    delete m.suite.repeat_run;
  });
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/suite\.state_mutating が無い/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("artifact_health.declared: false でも state_mutating が無ければ落とす（免除は旧成果物ではない）", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.artifact_health = { declared: false, reason: "視覚採取物を持たない api-resource のスイート" };
    delete m.suite.state_mutating;
    delete m.suite.repeat_run;
  });
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/artifact_health を持つ成果物なのに suite\.state_mutating が無い/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("blocking の未測定が残れば落とす（#278）", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.unmeasured.entries = [
      {
        item: "一覧の空状態",
        reason: "このパターンのシードが無い",
        disposition: "blocking",
        approved_by: null,
        approved_at: null,
      },
    ];
  });
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/未測定が残っている（disposition: blocking）/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("accepted でも承認記録が空なら blocking として数える", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.unmeasured.entries = [
      {
        item: "一覧の空状態",
        reason: "このパターンのシードが無い",
        disposition: "accepted",
        approved_by: null,
        approved_at: null,
      },
    ];
  });
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/approved_by \/ approved_at が空のため blocking として数える/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("語彙外の disposition は blocking として数える（fail-closed）", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.unmeasured.entries = [
      {
        item: "一覧の空状態",
        reason: "このパターンのシードが無い",
        disposition: "later",
        approved_by: null,
        approved_at: null,
      },
    ];
  });
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/disposition が語彙外/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("承認記録のある accepted は通す", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.unmeasured.entries = [
      {
        item: "一覧の空状態",
        reason: "このパターンのシードが無い",
        disposition: "accepted",
        approved_by: "user",
        approved_at: "2026-09-17T02:00:00Z",
      },
    ];
  });
  const r = run(metadataPath);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("suite.new_green が真なのに diff-metadata.json が無ければ落とす", () => {
  const { root, slugDir, metadataPath } = makeProject();
  writeFileSync(
    join(slugDir, "new/local-dev/replace-metadata.json"),
    JSON.stringify({ suite: { new_green: true } }),
  );
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stdout).toMatch(/diff-metadata\.json が無い/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

/**
 * 新側の工程が回った状態（replace-metadata.json ＋ diff-metadata.json）を作る。
 * @param {string} slugDir
 * @param {Record<string, unknown>} diffMeta
 * @param {Record<string, unknown>} [replaceExtra] replace-metadata.json へ足す記録
 */
function writeStage(slugDir, diffMeta, replaceExtra = {}) {
  writeFileSync(
    join(slugDir, "new/local-dev/replace-metadata.json"),
    JSON.stringify({ suite: { new_green: true }, ...replaceExtra }),
  );
  writeFileSync(join(slugDir, "new/local-dev/diff-metadata.json"), JSON.stringify(diffMeta));
}

/** 新側の版と反復を両成果物に記録した状態（対応づけの陽性コントロールの土台）。 */
const CORRELATED = {
  replace: {
    new: { target: "local-dev", commit: "a".repeat(40), dirty: false },
    loop: { iterations: 3 },
  },
  diff: { new: { target: "local-dev", commit: "a".repeat(40) }, iteration: 3 },
};

test("記録後の changes[].affects に * があれば陳腐化として落とす", () => {
  const { root, slugDir, metadataPath } = makeProject(undefined, {
    dataset: {
      version: 7,
      changes: [
        ...Array.from({ length: 6 }, (_, i) => ({ version: i + 1, affects: ["orders"] })),
        { version: 7, affects: ["*"] },
      ],
    },
  });
  writeStage(slugDir, { dataset_version: 6, converged: true });
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stdout).toMatch(/記録後の変更が全機能に影響する/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("版が古いだけで区間の affects に * が無ければ落とさない（交差判定は golden-dataset が正本）", () => {
  const { root, slugDir, metadataPath } = makeProject();
  writeStage(slugDir, { dataset_version: 6, converged: true });
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stdout).toMatch(/交差判定は golden-dataset の references\/versioning\.md が正本/);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("changes 履歴が欠けていれば影響なしに倒さない", () => {
  const { root, slugDir, metadataPath } = makeProject(undefined, { dataset: { version: 7 } });
  writeStage(slugDir, { dataset_version: 6, converged: true });
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stdout).toMatch(/changes 履歴が壊れている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("changes に欠番があれば影響なしに倒さない", () => {
  const { root, slugDir, metadataPath } = makeProject(undefined, {
    dataset: {
      version: 7,
      changes: [
        { version: 1, affects: ["orders"] },
        { version: 7, affects: ["orders"] },
      ],
    },
  });
  writeStage(slugDir, { dataset_version: 6, converged: true });
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stdout).toMatch(/changes 履歴が壊れている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("投入対象でない target は dataset_version: null ＋ 免除理由で通す", () => {
  const { root, slugDir, metadataPath } = makeProject();
  writeStage(slugDir, {
    dataset_version: null,
    dataset_version_exempt: "選択 target に db が無いため phase B との整合を免除",
    converged: true,
  });
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stdout).toMatch(/dataset_version を免除して判定/);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("dataset_version が空で免除理由も空なら落とす", () => {
  const { root, slugDir, metadataPath } = makeProject();
  writeStage(slugDir, { dataset_version: null, dataset_version_exempt: null, converged: true });
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stdout).toMatch(/dataset_version が空で dataset_version_exempt も空/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("記録済みの版が現在より新しければ落とす（巻き戻し・破損）", () => {
  const { root, slugDir, metadataPath } = makeProject();
  writeStage(slugDir, { dataset_version: 8, converged: true });
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stdout).toMatch(/dataset_version の範囲が不正/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("dataset_version_exempt が文字列でも null でもなければ型崩れ（exit 2）", () => {
  const { root, slugDir, metadataPath } = makeProject();
  writeStage(slugDir, { dataset_version: null, dataset_version_exempt: 1, converged: true });
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stderr).toMatch(/dataset_version_exempt が文字列でも null でもない/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("converged: false でも版が一致していれば落とさない", () => {
  const { root, slugDir, metadataPath } = makeProject();
  writeFileSync(
    join(slugDir, "new/local-dev/replace-metadata.json"),
    JSON.stringify({ suite: { new_green: true } }),
  );
  writeFileSync(
    join(slugDir, "new/local-dev/diff-metadata.json"),
    JSON.stringify({ dataset_version: 7, converged: false }),
  );
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("suite.new_green が真でなければ工程の節を判定しない", () => {
  const { root, slugDir, metadataPath } = makeProject();
  writeFileSync(
    join(slugDir, "new/local-dev/replace-metadata.json"),
    JSON.stringify({ suite: { new_green: false } }),
  );
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stdout).toMatch(/suite\.new_green が真でないため工程の節を判定しない/);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("後方互換: artifact_health / unmeasured をキーごと持たない旧成果物は判定しない", () => {
  const { root, metadataPath } = makeProject((m) => {
    delete m.artifact_health;
    delete m.unmeasured;
    delete m.suite.state_mutating;
    delete m.suite.repeat_run;
  });
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/artifact_health をキーごと持たない旧成果物/);
  expect(r.stdout).toMatch(/unmeasured をキーごと持たない旧成果物/);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("declared: false で reason が空なら型崩れ（exit 2）", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.artifact_health = { declared: false, reason: "" };
  });
  const r = run(metadataPath);
  expect(r.stderr).toMatch(/reason が空/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("宣言も実体も 0 件なら合格に倒さない", () => {
  const { root, slugDir, metadataPath } = makeProject((m) => {
    m.artifact_health.entries = [];
  });
  rmSync(join(slugDir, "baseline"), { recursive: true, force: true });
  mkdirSync(join(slugDir, "baseline"), { recursive: true });
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/採取物が 0 件/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("--stage suite では blocking の未測定を落とさない（書いた本人のゲートを止めない）", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.unmeasured.entries = [
      {
        item: "一覧の空状態",
        reason: "このパターンのシードが無い",
        disposition: "blocking",
        approved_by: null,
        approved_at: null,
      },
    ];
  });
  const r = run(metadataPath, ["--stage", "suite"]);
  expect(r.stdout).toMatch(/stage: suite のため blocking 1 件は落とさない/);
  expect(r.status).toBe(0);
  // 既定（diff）では同じ記録で落ちる——工程の指定だけが挙動を変えていることの対照。
  const strict = run(metadataPath);
  expect(strict.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("--stage suite でも記録の不備は落とす（測定待ちと壊れた記録を分ける）", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.unmeasured.entries = [
      {
        item: "一覧の空状態",
        reason: "このパターンのシードが無い",
        disposition: "accepted",
        approved_by: null,
        approved_at: null,
      },
    ];
  });
  const r = run(metadataPath, ["--stage", "suite"]);
  expect(r.stdout).toMatch(/approved_by \/ approved_at が空のため blocking として数える/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("--stage の語彙外は型崩れ（exit 2）", () => {
  const { root, metadataPath } = makeProject();
  const r = run(metadataPath, ["--stage", "replace"]);
  expect(r.stderr).toMatch(/--stage は diff \| suite のいずれか/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("suite キーごと無い旧成果物は反復実行の節を判定しない（型崩れに倒さない）", () => {
  const { root, metadataPath } = makeProject((m) => {
    delete m.suite;
    delete m.artifact_health;
    delete m.unmeasured;
  });
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/suite\.state_mutating をキーごと持たない旧成果物/);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("suite キーが無くても artifact_health を宣言していれば未検証として落とす（fail-open にしない）", () => {
  const { root, metadataPath } = makeProject((m) => {
    delete m.suite;
  });
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/suite\.state_mutating が無い/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("suite が配列など型崩れなら exit 2", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.suite = [];
  });
  const r = run(metadataPath);
  expect(r.stderr).toMatch(/suite がオブジェクトでない/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("陽性コントロール: 新側の版と反復が対応していれば工程の節を通す", () => {
  const { root, slugDir, metadataPath } = makeProject();
  writeStage(
    slugDir,
    { ...CORRELATED.diff, dataset_version: 7, converged: true },
    CORRELATED.replace,
  );
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("前の反復の diff-metadata.json は工程の成果物として通さない", () => {
  // データセットを変えずに parity-replace が作り直すと、dataset_version だけでは古さが出ない。
  const { root, slugDir, metadataPath } = makeProject();
  writeStage(
    slugDir,
    { ...CORRELATED.diff, iteration: 2, dataset_version: 7, converged: true },
    CORRELATED.replace,
  );
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stdout).toMatch(/前の反復のもの（iteration 2 ≠ .*loop\.iterations 3）/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("新側のコミットが変わった diff-metadata.json は通さない", () => {
  const { root, slugDir, metadataPath } = makeProject();
  writeStage(
    slugDir,
    {
      ...CORRELATED.diff,
      new: { target: "local-dev", commit: "b".repeat(40) },
      dataset_version: 7,
      converged: true,
    },
    CORRELATED.replace,
  );
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stdout).toMatch(/今の新側の版に対応していない/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("new.commit が none なら反復回数だけで判定する", () => {
  const { root, slugDir, metadataPath } = makeProject();
  writeStage(
    slugDir,
    {
      new: { target: "local-dev", commit: "none" },
      iteration: 3,
      dataset_version: 7,
      converged: true,
    },
    { new: { target: "local-dev", commit: "none" }, loop: { iterations: 3 } },
  );
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stdout).toMatch(/new\.commit が none/);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("new.dirty: true なら SHA が一致しても通さない（判定不能を合格に倒さない）", () => {
  const { root, slugDir, metadataPath } = makeProject();
  writeStage(
    slugDir,
    { ...CORRELATED.diff, dataset_version: 7, converged: true },
    {
      new: { target: "local-dev", commit: "a".repeat(40), dirty: true },
      loop: { iterations: 3 },
    },
  );
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stdout).toMatch(/新側の版を特定できない.*new\.dirty: true/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("対応づけの記録を片側が持たない旧成果物は判定しない（後方互換）", () => {
  const { root, slugDir, metadataPath } = makeProject();
  writeStage(slugDir, { dataset_version: 7, converged: true }, CORRELATED.replace);
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stdout).toMatch(/new\.commit を片側が持たないため/);
  expect(r.stdout).toMatch(/iteration \/ loop\.iterations を片側が持たないため/);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

/**
 * 状態を変えるスイートを 2 回緑で回した metadata を作る。
 * @param {string | null} fingerprint 記録する指紋（null なら記録しない＝旧成果物）
 * @returns {Record<string, unknown>}
 */
function mutatingSuite(fingerprint) {
  const runs = [
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

test("陽性コントロール: スイートの指紋が記録と一致すれば通す", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.suite = mutatingSuite("placeholder");
  });
  const fp = suiteFingerprint(
    { specs: "e2e/parity/order-list", expectations: "e2e/parity/lib/expectations.ts" },
    root,
  ).fingerprint;
  const meta = JSON.parse(readFileSync(metadataPath, "utf8"));
  for (const r of meta.suite.repeat_run.runs) r.suite_fingerprint = fp;
  writeFileSync(metadataPath, JSON.stringify(meta, null, 2));
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/スイートの指紋が記録と一致/);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("2 回緑を記録した後にスペックを変えたら落ちる（記録が今のスイートのものでない）", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.suite = mutatingSuite("placeholder");
  });
  const fp = suiteFingerprint(
    { specs: "e2e/parity/order-list", expectations: "e2e/parity/lib/expectations.ts" },
    root,
  ).fingerprint;
  const meta = JSON.parse(readFileSync(metadataPath, "utf8"));
  for (const r of meta.suite.repeat_run.runs) r.suite_fingerprint = fp;
  writeFileSync(metadataPath, JSON.stringify(meta, null, 2));
  // 記録した後に後始末を外す（スペックの中身が変わる）。
  writeFileSync(
    join(root, "e2e/parity/order-list/orders.spec.ts"),
    "// orders.default.desktop.png と orders.xlsx.json を読む（後始末を外した）\n",
  );
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/記録した 2 回は現在のスイートのものでない/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("連続する 2 回で指紋が違えば落ちる", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.suite = mutatingSuite("placeholder");
    m.suite.repeat_run.runs[0].suite_fingerprint = "sha256:aaa";
    m.suite.repeat_run.runs[1].suite_fingerprint = "sha256:bbb";
  });
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/suite_fingerprint が違う/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("片方だけ指紋を持てば落ちる", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.suite = mutatingSuite("placeholder");
    delete m.suite.repeat_run.runs[1].suite_fingerprint;
  });
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/片方だけ suite_fingerprint を持つ/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("指紋を持たない旧成果物はこの軸を判定しない（後方互換）", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.suite = mutatingSuite(null);
  });
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/suite_fingerprint を持たない旧成果物/);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("宣言したスイートの実体が無ければ合格に倒さない", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.suite = mutatingSuite("sha256:aaa");
    m.suite.specs = "e2e/parity/does-not-exist";
  });
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/現在のスイートの指紋を計算できない.*読めない .*（実体が無い）/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("new.commit が none でも dirty なら落とす（コミットの比較方法を選ぶ前に見る）", () => {
  const { root, slugDir, metadataPath } = makeProject();
  writeStage(
    slugDir,
    {
      new: { target: "local-dev", commit: "none" },
      iteration: 3,
      dataset_version: 7,
      converged: true,
    },
    { new: { target: "local-dev", commit: "none", dirty: true }, loop: { iterations: 3 } },
  );
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stdout).toMatch(/新側の版を特定できない.*new\.dirty: true/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("別の環境の成果物を写しただけなら落とす（new.target と --target の照合）", () => {
  // 同じコミット・同じ反復は環境をまたいで一致しうるので、版だけでは写しを見分けられない。
  const { root, slugDir, metadataPath } = makeProject();
  writeStage(
    slugDir,
    {
      ...CORRELATED.diff,
      new: { target: "preview", commit: "a".repeat(40) },
      dataset_version: 7,
      converged: true,
    },
    { ...CORRELATED.replace, new: { target: "preview", commit: "a".repeat(40), dirty: false } },
  );
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stdout).toMatch(
    /replace-metadata\.json が別の環境の成果物（new\.target preview ≠ --target local-dev）/,
  );
  expect(r.stdout).toMatch(/diff-metadata\.json が別の環境の成果物/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("new.target を持たない旧成果物は環境の対応を判定しない", () => {
  const { root, slugDir, metadataPath } = makeProject();
  writeStage(
    slugDir,
    { new: { commit: "a".repeat(40) }, iteration: 3, dataset_version: 7, converged: true },
    { new: { commit: "a".repeat(40), dirty: false }, loop: { iterations: 3 } },
  );
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stdout).toMatch(/new\.target を持たないため環境の対応を判定しない/);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("免除理由があっても dataset_version が null でなければ落とす（免除は対の記録）", () => {
  const { root, slugDir, metadataPath } = makeProject();
  writeStage(
    slugDir,
    {
      ...CORRELATED.diff,
      dataset_version: 3,
      dataset_version_exempt: "古い免除文字列が残っている",
      converged: true,
    },
    CORRELATED.replace,
  );
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stdout).toMatch(/dataset_version_exempt があるのに dataset_version が null でない/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("期待値解決層を書き換えても指紋が変わらなければ素通りする、を塞ぐ", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.suite = mutatingSuite("placeholder");
  });
  const fp = suiteFingerprint(
    { specs: "e2e/parity/order-list", expectations: "e2e/parity/lib/expectations.ts" },
    root,
  ).fingerprint;
  const meta = JSON.parse(readFileSync(metadataPath, "utf8"));
  for (const r of meta.suite.repeat_run.runs) r.suite_fingerprint = fp;
  writeFileSync(metadataPath, JSON.stringify(meta, null, 2));
  // 記録した後に期待値だけを変える（スペックには触らない）。
  writeFileSync(
    join(root, "e2e/parity/lib/expectations.ts"),
    "export const expected = { total: 4 };\n",
  );
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/記録した 2 回は現在のスイートのものでない/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

// Issue #405: resolveInside が文字列の解決だけで閉じ込めを判定していたため、baseline_dir に
// 置いた外向きのシンボリックリンクが finding を 1 件も出さずに通り、--root の外のファイルの
// 内容が sha256 照合に使われていた。
test("baseline_dir の外を指すシンボリックリンクを落とす（実パスで閉じ込める）", () => {
  const outside = mkdtempSync(join(tmpdir(), "artifact-health-outside-"));
  writeFileSync(join(outside, "secret.png"), "SECRET-CONTENT-OUTSIDE-SANDBOX");
  const { root, slugDir, metadataPath } = makeProject((m) => {
    m.artifact_health.entries.push({
      path: "linked.png",
      kind: "captured",
      read_by: [],
      unread_reason: "リンクの検査だけが目的",
      derived_from: null,
      freshness_unverified_reason: null,
    });
  });
  symlinkSync(join(outside, "secret.png"), join(slugDir, "baseline/linked.png"));
  const r = run(metadataPath, ["--root", root]);
  expect(r.stdout).toMatch(
    /採取物のパスが baseline_dir の外を指しているか実パスを解決できない: linked\.png/,
  );
  expect(r.status).toBe(1);
  rmSync(outside, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

test("baseline_dir の中を指すシンボリックリンクは落とさない（陽性コントロール）", () => {
  const { root, slugDir, metadataPath } = makeProject((m) => {
    m.artifact_health.entries.push({
      path: "linked.png",
      kind: "captured",
      read_by: [],
      unread_reason: "リンクの検査だけが目的",
      derived_from: null,
      freshness_unverified_reason: null,
    });
  });
  symlinkSync(
    join(slugDir, "baseline/orders.default.desktop.png"),
    join(slugDir, "baseline/linked.png"),
  );
  const r = run(metadataPath, ["--root", root]);
  expect(r.stdout).not.toMatch(/baseline_dir の外を指している/);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

// 閉じ込め拒否（実パスがルート外）と不在は原因が違う。同じ文言にすると、
// 実体が在るのに「無い」と報告され、書き手は閉じ込め拒否に辿り着けない。
test("read_by がルート外を指すリンクのとき、不在と別の理由で落とす", () => {
  const outside = mkdtempSync(join(tmpdir(), "artifact-health-outside-"));
  writeFileSync(
    join(outside, "linked.spec.ts"),
    "// orders.default.desktop.png と orders.xlsx.json を読む\n",
  );
  const { root, metadataPath } = makeProject((m) => {
    m.artifact_health.entries[0].read_by = ["e2e/parity/order-list/linked.spec.ts"];
  });
  symlinkSync(join(outside, "linked.spec.ts"), join(root, "e2e/parity/order-list/linked.spec.ts"));
  const r = run(metadataPath, ["--root", root]);
  expect(r.stdout).toMatch(
    /read_by が指すスペックがルートの外を指しているか実パスを解決できない: e2e\/parity\/order-list\/linked\.spec\.ts/,
  );
  expect(r.stdout).not.toMatch(/read_by が指すスペックが無い/);
  expect(r.status).toBe(1);
  rmSync(outside, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

test("read_by が本当に無いときは従来どおり「無い」と報告する（対照）", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.artifact_health.entries[0].read_by = ["e2e/parity/order-list/missing.spec.ts"];
  });
  const r = run(metadataPath, ["--root", root]);
  expect(r.stdout).toMatch(
    /read_by が指すスペックが無い: e2e\/parity\/order-list\/missing\.spec\.ts/,
  );
  expect(r.stdout).not.toMatch(/ルートの外を指しているか実パスを解決できない/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

// new.commit が none の枝は版の対応を反復回数へ委ねている。委ねた先も読めないと、
// 版の検査を 1 つも通らないまま古い成果物が素通りする（委譲先が無いことを合格に倒さない）。
test.each([
  ["記録側の iteration が無い", undefined, { iterations: 3 }],
  ["現在側の loop.iterations が無い", 3, {}],
  // テンプレートを置き換え忘れた形（プレースホルダ文字列）。数字列は toInteger が受けるので対象外。
  [
    "iteration がテンプレートのまま",
    "<replace-metadata.json の loop.iterations（数値）>",
    { iterations: 3 },
  ],
])("new.commit が none なのに反復回数も読めなければ落とす: %s", (_label, iteration, loop) => {
  const { root, slugDir, metadataPath } = makeProject();
  writeStage(
    slugDir,
    {
      new: { target: "local-dev", commit: "none" },
      ...(iteration === undefined ? {} : { iteration }),
      dataset_version: 7,
      converged: true,
    },
    { new: { target: "local-dev", commit: "none", dirty: false }, loop },
  );
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stdout).toMatch(/新側の版を対応づける指標が無い（new\.commit が none なのに/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("commit が実在の SHA なら反復回数の片側欠落は従来どおり旧成果物として扱う（対照）", () => {
  const { root, slugDir, metadataPath } = makeProject();
  writeStage(
    slugDir,
    { new: { target: "local-dev", commit: "a".repeat(40) }, dataset_version: 7, converged: true },
    { new: { target: "local-dev", commit: "a".repeat(40), dirty: false }, loop: {} },
  );
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stdout).toMatch(/反復の対応を判定しない（旧成果物）/);
  expect(r.stdout).not.toMatch(/新側の版を対応づける指標が無い/);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});
