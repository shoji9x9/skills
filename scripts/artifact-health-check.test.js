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
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  RENDER_INPUTS,
  amendVerifyPair,
  commit as commitFiles,
  featureMetadata,
  makeCarryProject,
  writeJson,
} from "./evidence-carry-fixture.js";
import { makeTempDir } from "./lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-suite/scripts/artifact-health-check.mjs");
// 期待値はスクリプトと同じ関数から取る（テスト側で計算規則を複製すると、両方が同時に間違っても緑になる）。
const { main, suiteFingerprint, stripJsComments } = await import(pathToFileURL(script).href);

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
 * main を同じプロセスで呼ぶ（子プロセスの起動を省く。変異実証が変異ごとにこのファイルを丸ごと回すため、Issue #478）。
 * CLI として起動できること（エントリ判定・引数と出力の受け渡し）は cli() の陽性コントロールが持つ。
 * @param {string} metadataPath
 * @param {string[]} [extra]
 */
function run(metadataPath, extra = []) {
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
function cli(metadataPath, extra = []) {
  const r = spawnSync(process.execPath, [script, "--metadata", metadataPath, ...extra], {
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("陽性コントロール（CLI）: 子プロセスとして起動しても、健全な成果物は exit 0 で ok を stdout に出す", () => {
  const { root, metadataPath } = makeProject();
  const r = cli(metadataPath);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("陽性コントロール（CLI）: 子プロセスとして起動しても、使い方の誤りは exit 2 で usage を stderr に出す", () => {
  const { root, metadataPath } = makeProject();
  const r = cli(metadataPath, ["--stage", "bogus"]);
  expect(r.stderr).toMatch(/--stage は diff \| suite のいずれか/);
  expect(r.stderr).toMatch(/^usage: artifact-health-check\.mjs/m);
  expect(r.stdout).toBe("");
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

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
  // 記録した後に後始末を外す（スペックのコードが変わる。コメントだけの書き換えは #457 で指紋に効かない）。
  writeFileSync(
    join(root, "e2e/parity/order-list/orders.spec.ts"),
    "// orders.default.desktop.png と orders.xlsx.json を読む\nconst cleanup = false;\n",
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

// Issue #457: 指紋がコメントを含むと、注記を書き換えただけで現行での 2 回の実行を取り直すことになる。
// 新方式（sha256-nc:）は JS / TS 系のコメントを除いて数え、旧方式（sha256:）の記録は旧方式で照合する。

/** 指紋の対象（mutatingSuite と同じ宣言）。 */
const FP_SUITE = { specs: "e2e/parity/order-list", expectations: "e2e/parity/lib/expectations.ts" };

/**
 * 状態を変えるスイートを、いまのスイートの指紋で 2 回緑として記録したプロジェクトを作る。
 * @param {{ specBody?: string, legacy?: boolean }} [opts]
 */
function recordedProject(opts = {}) {
  const project = makeProject(
    (m) => {
      m.suite = mutatingSuite("placeholder");
    },
    opts.specBody === undefined ? {} : { specBody: opts.specBody },
  );
  const fp = suiteFingerprint(FP_SUITE, project.root, { legacy: opts.legacy === true }).fingerprint;
  const meta = JSON.parse(readFileSync(project.metadataPath, "utf8"));
  for (const r of meta.suite.repeat_run.runs) r.suite_fingerprint = fp;
  writeFileSync(project.metadataPath, JSON.stringify(meta, null, 2));
  return { ...project, fp, specPath: join(project.root, "e2e/parity/order-list/orders.spec.ts") };
}

const SPEC_WITH_NOTE = [
  "// orders.default.desktop.png と orders.xlsx.json を読む",
  "// intentional_diffs.keep の項目",
  "test('orders', async () => {",
  "  await expect(page).toHaveURL(/orders\\/list/); /* 一覧へ */",
  "});",
  "",
].join("\n");

test("#457 再現: スペックの 1 行コメントだけを書き換えても exit 0（新方式の指紋）", () => {
  const { root, metadataPath, fp, specPath } = recordedProject({ specBody: SPEC_WITH_NOTE });
  expect(fp).toMatch(/^sha256-nc:[0-9a-f]{64}$/);
  writeFileSync(
    specPath,
    SPEC_WITH_NOTE.replace("// intentional_diffs.keep", "// intentional_diffs.may_change"),
  );
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/スイートの指紋が記録と一致.*コメントを除いて照合/);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("#457: 行・ブロック・JSDoc のコメントの書き換え（行数の増減を含む）では指紋が変わらない", () => {
  const { root, fp, specPath } = recordedProject({ specBody: SPEC_WITH_NOTE });
  writeFileSync(
    specPath,
    [
      "/**",
      " * JSDoc を足した（2 行目）",
      " * @see intentional_diffs.may_change",
      " */",
      "// orders.default.desktop.png と orders.xlsx.json を読む（書き換えた）",
      "test('orders', async () => { // 行末にも注記",
      "  await expect(page).toHaveURL(/orders\\/list/); /* 別の注記 */",
      "});",
      "",
    ].join("\n"),
  );
  expect(suiteFingerprint(FP_SUITE, root).fingerprint).toBe(fp);
  rmSync(root, { recursive: true, force: true });
});

test("#457: コードを変えれば指紋が変わり exit 1（新方式でも変更を見逃さない）", () => {
  const { root, metadataPath, fp, specPath } = recordedProject({ specBody: SPEC_WITH_NOTE });
  writeFileSync(specPath, SPEC_WITH_NOTE.replace("orders\\/list", "orders\\/detail"));
  expect(suiteFingerprint(FP_SUITE, root).fingerprint).not.toBe(fp);
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/記録した 2 回は現在のスイートのものでない/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("#457: 文字列・テンプレート・正規表現の中の // や /* はコメントとして除かない", () => {
  const src = [
    "const a = 'x // in single';",
    'const b = "y /* in double */";',
    "const c = `t // ${`nested // ${d /* real */}` + '}'} // tail`; // real",
    "const e = /a\\/\\/b[/]/g; // real",
    "const r = /a\\//; // real",
    "const f = g / h / i; // real",
    "",
  ].join("\n");
  const out = stripJsComments(src);
  expect(out).toContain("'x // in single'");
  expect(out).toContain('"y /* in double */"');
  expect(out).toContain("`t // ${`nested // ${d}` + '}'} // tail`");
  expect(out).toContain("/a\\/\\/b[/]/g");
  // 正規表現を除算と読み違えると、\/ の直後の / と閉じの / が // に見えて行の残りを捨てる。
  expect(out).toContain("/a\\//;");
  expect(out).toContain("g / h / i");
  expect(out).not.toContain("real");
  // 陽性コントロール: 文字列・テンプレート・正規表現の中の // の後ろを変えれば正規形が変わる。
  for (const [from, to] of [
    ["in single", "in SINGLE"],
    ["in double", "in DOUBLE"],
    ["// tail", "// TAIL"],
    ["nested //", "NESTED //"],
    ["b[/]/g", "B[/]/g"],
  ]) {
    expect(stripJsComments(src.replace(from, to)), from).not.toBe(out);
  }
});

test("#457: 文字列の中の // の後ろを変えれば指紋が変わる（ファイル経由の陽性コントロール）", () => {
  const body =
    "test.skip(true, 'https://example.test // 理由');\n// orders.default.desktop.png と orders.xlsx.json\n";
  const { root, fp, specPath } = recordedProject({ specBody: body });
  writeFileSync(specPath, body.replace("// 理由", "// 別の理由"));
  expect(suiteFingerprint(FP_SUITE, root).fingerprint).not.toBe(fp);
  rmSync(root, { recursive: true, force: true });
});

test("#457: 旧方式 sha256: の記録は旧方式で照合する（変えていなければ通る）", () => {
  const { root, metadataPath, fp } = recordedProject({ specBody: SPEC_WITH_NOTE, legacy: true });
  expect(fp).toMatch(/^sha256:[0-9a-f]{64}$/);
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/スイートの指紋が記録と一致.*旧方式 sha256:/);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("#457: 旧方式 sha256: の記録はコメントの書き換えも従来どおり差として落とす", () => {
  const { root, metadataPath, specPath } = recordedProject({
    specBody: SPEC_WITH_NOTE,
    legacy: true,
  });
  writeFileSync(
    specPath,
    SPEC_WITH_NOTE.replace("// intentional_diffs.keep", "// intentional_diffs.may_change"),
  );
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/記録した 2 回は現在のスイートのものでない.*旧方式 sha256:/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("#457: 接頭辞を読めない指紋は不一致として落とす", () => {
  const { root, metadataPath } = makeProject((m) => {
    m.suite = mutatingSuite("md5:0123");
  });
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/suite_fingerprint の方式を読めない/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("#457: JS / TS 系以外のファイルは生バイトで数える（コメント風の行の書き換えも差になる）", () => {
  const root = makeTempDir("artifact-health-fp-");
  writeFileSync(join(root, "locators.json"), '{"a": "// x"}\n');
  writeFileSync(join(root, "notes.yaml"), "# keep\n// keep\nkey: 1\n");
  const suite = { locator_map: "locators.json", interactions: "notes.yaml" };
  const before = suiteFingerprint(suite, root).fingerprint;
  // JS の行コメントに見える行の書き換えも差にする（JS / TS 系の正規形を当てると消える）。
  writeFileSync(join(root, "notes.yaml"), "# keep\n// may_change\nkey: 1\n");
  expect(suiteFingerprint(suite, root).fingerprint).not.toBe(before);
  rmSync(root, { recursive: true, force: true });
});

test.each([".js", ".mjs", ".cjs"])(
  "#457: %s も生バイトで数える（トランスパイルで JSX を書ける。テキストの // を見逃さない）",
  (ext) => {
    const root = makeTempDir("artifact-health-fp-");
    writeFileSync(join(root, `view${ext}`), "export const X = () => <p>http://old.example</p>;\n");
    const suite = { specs: `view${ext}` };
    const before = suiteFingerprint(suite, root).fingerprint;
    writeFileSync(join(root, `view${ext}`), "export const X = () => <p>http://new.example</p>;\n");
    expect(suiteFingerprint(suite, root).fingerprint).not.toBe(before);
    rmSync(root, { recursive: true, force: true });
  },
);

test("#457: .tsx / .jsx は生バイトで数える（JSX のテキストの // をコメントと読んで書き換えを見逃さない）", () => {
  const root = makeTempDir("artifact-health-fp-");
  writeFileSync(join(root, "view.tsx"), "export const V = () => <p>http://old.example</p>;\n");
  const suite = { specs: "view.tsx" };
  const before = suiteFingerprint(suite, root).fingerprint;
  writeFileSync(join(root, "view.tsx"), "export const V = () => <p>http://new.example</p>;\n");
  expect(suiteFingerprint(suite, root).fingerprint).not.toBe(before);
  rmSync(root, { recursive: true, force: true });
});

test.each([
  ["// @ts-expect-error", "// @ts-ignore"],
  ['/// <reference types="a" />', '/// <reference types="b" />'],
  ["//# sourceMappingURL=a.map", "//# sourceMappingURL=b.map"],
  ["/* @vite-ignore */", "/* @vite-ignore-x */"],
  ["/** @jsx h */", "/** @jsx preact */"],
  ["/*#__PURE__*/", "/*@__NOINLINE__*/"],
  ["// eslint-disable-next-line", "// eslint-disable-next-line no-x"],
  ["/* istanbul ignore next */", "/* istanbul ignore else */"],
  ["/*! license a */", "/*! license b */"],
])("#457: 指示コメント %s は除かない（書き換えれば正規形が変わる）", (from, to) => {
  const src = `${from}\nfoo();\n`;
  expect(stripJsComments(src)).toContain(from);
  expect(stripJsComments(src.replace(from, to))).not.toBe(stripJsComments(src));
});

test("#457: ) の後の / が正規表現にも読める形で同じ行に // があれば、読めないとして生バイトに倒す（null）", () => {
  // 除算と読むと正規表現の中の // を行コメントとして捨て、後ろのコードの変更を見逃す
  expect(stripJsComments("if (enabled) /[//]/.test(value); cleanupOld();\n")).toBeNull();
});

test("#457: ) の後の / でも同じ行に // /* が無い除算は従来どおり正規形にする（陽性コントロール）", () => {
  expect(stripJsComments("const h = (a + b) / 2;\n// note\nx();\n")).toBe(
    "const h = (a + b) / 2;\nx();",
  );
});

test("#457: 指示コメントでない行コメント・ブロックコメントは従来どおり除く", () => {
  const src =
    "// plain note\nfoo(); /* note */ bar();\n/**\n * JSDoc の説明\n * @param x 説明\n */\nbaz();\n";
  expect(stripJsComments(src)).toBe("foo(); bar();\nbaz();");
});

test("#457: 字句解析が閉じない JS / TS 系のファイルは生バイトで数え、その旨を残す", () => {
  const { root, metadataPath, fp, specPath } = recordedProject({
    specBody: "// orders.default.desktop.png と orders.xlsx.json\nconst s = 'unterminated\n",
  });
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/コメントを除けず生バイトで数えたファイル.*orders\.spec\.ts/);
  expect(r.status).toBe(0);
  // 生バイトなのでコメントの書き換えも差になる（除けないときに変更を見逃す側へ倒さない）。
  writeFileSync(
    specPath,
    "// orders.default.desktop.png と orders.xlsx.json（書き換え）\nconst s = 'unterminated\n",
  );
  expect(suiteFingerprint(FP_SUITE, root).fingerprint).not.toBe(fp);
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
  const outside = makeTempDir("artifact-health-outside-");
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
  const outside = makeTempDir("artifact-health-outside-");
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

// 反復回数へ委ねてよいのは両側とも none のときだけ。片側だけ none は別の版なので、
// 反復回数が一致しても合格に倒さない（component-comparison-check.mjs と同じ規則）。
test.each([
  ["記録が none・現在が SHA", "none", "a".repeat(40)],
  ["記録が SHA・現在が none", "a".repeat(40), "none"],
])("片側だけ none で反復回数が一致しても合格に倒さない: %s", (_label, recorded, now) => {
  const { root, slugDir, metadataPath } = makeProject();
  writeStage(
    slugDir,
    {
      new: { target: "local-dev", commit: recorded },
      iteration: 3,
      dataset_version: 7,
      converged: true,
    },
    { new: { target: "local-dev", commit: now, dirty: false }, loop: { iterations: 3 } },
  );
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stdout).toMatch(/今の新側の版に対応していない/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

// 同じ loop.iterations を読む component-comparison-check.mjs は数値だけを受ける。
// 片方だけ数字列を受けると、同じ記録に 2 つの検査器が矛盾した判定を出す。
test("反復回数は数字列を受けない（姉妹の検査器と判定を揃える）", () => {
  const { root, slugDir, metadataPath } = makeProject();
  writeStage(
    slugDir,
    {
      new: { target: "local-dev", commit: "none" },
      iteration: "3",
      dataset_version: 7,
      converged: true,
    },
    { new: { target: "local-dev", commit: "none", dirty: false }, loop: { iterations: 3 } },
  );
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stdout).toMatch(/新側の版を対応づける指標が無い/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

// 証跡の持ち越し（Issue #454）。new.commit が食い違っても、replace-metadata.json の new.render_inputs の差分が
// 変更宣言と amend-verify で説明できれば持ち越す（判定の正本は evidence-carry.mjs。
// 状態空間は scripts/evidence-carry.test.js が持つ。ここは checkStage への組み込みの両側と legacy を測る）。

/**
 * makeProject に持ち越しの fixture（新側 git リポジトリ・変更宣言・部品 metadata・amend-verify の記録）を足す。
 * @param {[string, string, string][]} scope 機能が撮った組
 * @param {Record<string, unknown>} [replaceNewExtra] replace-metadata.json の new へ足す値
 */
function carryProject(scope, replaceNewExtra = { render_inputs: RENDER_INPUTS }) {
  const conditions = featureMetadata(scope);
  const made = makeProject((m) => {
    Object.assign(m, { mode: "feature", capture_conditions: conditions.capture_conditions });
    // makeCarryProject が現側の基準（baseline_dir の下）に置く amend-verify の current 画像を採取物として宣言する
    m.artifact_health.entries.push({
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

test("持ち越し: 描画入力の差分が変更宣言で説明でき機能に影響しなければ exit 0（注記付き）", () => {
  const { root, metadataPath, carry } = carryProject([["list", "default", "desktop"]]);
  const r = run(metadataPath, ["--target", "local-dev", "--new-repo", carry.repo]);
  expect(r.stdout).not.toMatch(/今の新側の版に対応していない/);
  expect(r.stdout).toMatch(/^note: .*証跡を持ち越す/m);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("持ち越し: 影響する組が amend-verify で pass なら exit 0", () => {
  const { root, metadataPath, carry } = carryProject([
    ["list", "default", "desktop"],
    ["list", "hover", "desktop"],
  ]);
  const r = run(metadataPath, ["--target", "local-dev", "--new-repo", carry.repo]);
  expect(r.stdout).toMatch(/amend-verify で pass なので証跡を持ち越す/);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("持ち越し: 影響する組が amend-verify で pass でなければ従来の不一致に理由を添えて落とす", () => {
  const { root, metadataPath, carry } = carryProject([["list", "hover", "desktop"]]);
  writeJson(join(root, carry.recordPath), {
    tool: "amend-verify",
    version: "1",
    change_id: "hover-shadow",
    pairs: [amendVerifyPair(root, "list|hover|desktop", { pass: false })],
  });
  const r = run(metadataPath, ["--target", "local-dev", "--new-repo", carry.repo]);
  expect(r.stdout).toMatch(/今の新側の版に対応していない/);
  expect(r.stdout).toMatch(/^warn: 証跡を持ち越せない: .*pass でない/m);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("持ち越し: 宣言外のファイルが変わっていれば落とす（ファイル名を出す）", () => {
  const { root, slugDir, metadataPath, carry } = carryProject([["list", "default", "desktop"]]);
  const theme = commitFiles(carry.repo, { "src/theme.css": ":root { --accent: red; }\n" }, "theme");
  const replacePath = join(slugDir, "new/local-dev/replace-metadata.json");
  const replace = JSON.parse(readFileSync(replacePath, "utf8"));
  replace.new.commit = theme;
  writeFileSync(replacePath, JSON.stringify(replace));
  const r = run(metadataPath, ["--target", "local-dev", "--new-repo", carry.repo]);
  expect(r.stdout).toMatch(/今の新側の版に対応していない/);
  expect(r.stdout).toMatch(/証跡を持ち越せない: .*src\/theme\.css/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("持ち越し: --new-repo が無ければ持ち越さない（判定不能を合格にしない）", () => {
  const { root, metadataPath } = carryProject([["list", "default", "desktop"]]);
  const r = run(metadataPath, ["--target", "local-dev"]);
  expect(r.stdout).toMatch(/今の新側の版に対応していない/);
  expect(r.stdout).toMatch(/証跡を持ち越せない: --new-repo/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("持ち越し: --replace-root が別の場所なら変更宣言を引けず落とす（既定は <root>/.replace）", () => {
  const { root, metadataPath, carry } = carryProject([["list", "default", "desktop"]]);
  const elsewhere = join(root, "elsewhere/.replace");
  mkdirSync(elsewhere, { recursive: true });
  const r = run(metadataPath, [
    "--target",
    "local-dev",
    "--new-repo",
    carry.repo,
    "--replace-root",
    elsewhere,
  ]);
  expect(r.stdout).toMatch(/証跡を持ち越せない: 変更宣言 を読めない/);
  expect(r.status).toBe(1);
  const ok = run(metadataPath, [
    "--target",
    "local-dev",
    "--new-repo",
    carry.repo,
    "--replace-root",
    join(root, ".replace"),
  ]);
  expect(ok.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("持ち越し: render_inputs が無ければ従来のメッセージのまま落とし、持ち越せない理由を注記する", () => {
  const { root, metadataPath, carry } = carryProject([["list", "default", "desktop"]], {});
  const r = run(metadataPath, ["--target", "local-dev", "--new-repo", carry.repo]);
  expect(r.stdout).toContain(
    `warn: diff-metadata.json が今の新側の版に対応していない（new.commit ${carry.commits.base} ≠ replace-metadata.json の ${carry.commits.component}）`,
  );
  expect(r.stdout).not.toMatch(/証跡を持ち越せない/);
  expect(r.stdout).toMatch(/^note: .*render_inputs.*持ち越せない/m);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

// Issue #473: 2 回の記録をスイート全体の 1 つの指紋に結びつけると、状態を変えないスペックを 1 行変えただけで
// 状態を変えるスペックまで現行へ 2 回回し直すことになる。repeat_run.specs（スペックごとの分類）を持つ成果物は、
// 状態を変えるスペックごとに「そのスペックを含む直近 2 回」を、スペックの指紋と共有の土台の指紋で照合する。

const SPEC_DIR = "e2e/parity/order-list";
const LOCALE = `${SPEC_DIR}/locale.spec.ts`;
const ORDERS = `${SPEC_DIR}/orders.spec.ts`;

/**
 * スペック単位の分類表を持つプロジェクトを作る（locale.spec.ts が状態を変え、orders.spec.ts は変えない）。
 * runs は空。記録は recordRuns で --fingerprint の出力から書く。
 * @param {(m: Record<string, any>) => void} [mutate]
 */
function perSpecProject(mutate) {
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
    if (mutate) mutate(m);
  });
  writeFileSync(join(project.root, LOCALE), "test('locale', async () => { save('ja'); });\n");
  writeFileSync(join(project.root, SPEC_DIR, "helpers.ts"), "export const open = () => 1;\n");
  return project;
}

/** --fingerprint の出力を読む。 */
function fingerprints(metadataPath) {
  const r = run(metadataPath, ["--fingerprint"]);
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout);
}

/**
 * 回したスペックを 2 回緑で記録する（--fingerprint の出力から写す）。
 * @param {string} metadataPath
 * @param {string[]} ranSpecs
 * @param {string} day - started_at の日付部分（記録を足すたびに後の日付を渡す）
 * @param {number} [times] - 回数（状態を変えないスペックだけを回すなら 1）
 */
function recordRuns(metadataPath, ranSpecs, day, times = 2) {
  const fp = fingerprints(metadataPath);
  const meta = JSON.parse(readFileSync(metadataPath, "utf8"));
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

/** @param {string} metadataPath @param {(m: Record<string, any>) => void} mutate */
function editMetadata(metadataPath, mutate) {
  const meta = JSON.parse(readFileSync(metadataPath, "utf8"));
  mutate(meta);
  writeFileSync(metadataPath, JSON.stringify(meta, null, 2));
}

test("#473 陽性コントロール: 状態を変えるスペックを 2 回続けて緑で記録すれば通す（状態を変えないスペックは 1 回で足りる）", () => {
  const { root, metadataPath } = perSpecProject();
  recordRuns(metadataPath, [LOCALE], "2026-09-20");
  recordRuns(metadataPath, [ORDERS], "2026-09-21", 1);
  const r = run(metadataPath);
  expect(r.stdout).toMatch(
    /スペック単位で判定: 状態を変えるスペック 1 件.*状態を変えないスペック 1 件/,
  );
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("#473 再現: 状態を変えないスペックを変えても、そのスペックを 1 回回して足せば通る（状態を変えるスペックの 2 回は取り直さない）", () => {
  const { root, metadataPath } = perSpecProject();
  recordRuns(metadataPath, [LOCALE, ORDERS], "2026-09-20");
  writeFileSync(
    join(root, ORDERS),
    "// orders.default.desktop.png と orders.xlsx.json を読む\nconst extra = 1;\n",
  );
  const stale = run(metadataPath);
  expect(stale.stdout).toContain(
    `状態を変えないスペック ${ORDERS} の直近の緑は現在のスペック・土台のものでない`,
  );
  expect(stale.stdout).not.toContain(LOCALE + " の 2 回の記録");
  expect(stale.status).toBe(1);
  recordRuns(metadataPath, [ORDERS], "2026-09-21", 1);
  const r = run(metadataPath);
  expect(r.stdout).not.toMatch(/^warn: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.each([
  ["記録が無い", () => {}, `状態を変えないスペック ${ORDERS} の実行記録が 0 件`],
  [
    "直近の記録が赤",
    (m) =>
      m.suite.repeat_run.runs.push({
        ...m.suite.repeat_run.runs[1],
        started_at: "2026-09-22T01:00:00Z",
        result: "red",
      }),
    `状態を変えないスペック ${ORDERS} の直近の記録が緑でない`,
  ],
])(
  "#473: 状態を変えないスペックの 1 回の緑が現在の版に結びつかなければ落とす: %s",
  (name, mutate, needle) => {
    const { root, metadataPath } = perSpecProject();
    recordRuns(metadataPath, name === "記録が無い" ? [LOCALE] : [LOCALE, ORDERS], "2026-09-20");
    editMetadata(metadataPath, mutate);
    const r = run(metadataPath);
    expect(r.stdout).toContain(needle);
    expect(r.status).toBe(1);
    rmSync(root, { recursive: true, force: true });
  },
);

test.each([
  ["共有の宣言パス（expectations）", "e2e/parity/lib/expectations.ts"],
  ["共有の宣言パスの祖先", "e2e/parity/lib"],
  ["suite.specs そのもの", SPEC_DIR],
])("#473: current_excluded は suite.specs の下のスペックの置き場所に限る: %s", (_name, path) => {
  const { root, metadataPath } = perSpecProject((m) => {
    m.suite.repeat_run.current_excluded.push({ path, reason: "current で走らせない" });
  });
  recordRuns(metadataPath, [LOCALE, ORDERS], "2026-09-20");
  writeFileSync(join(root, "e2e/parity/lib/expectations.ts"), "export const changed = 2;\n");
  const r = run(metadataPath);
  expect(r.stdout).toContain(`current_excluded の ${path} が suite.specs（${SPEC_DIR}）の下でない`);
  expect(r.stdout).toContain(`スペック ${LOCALE} の 2 回の記録は現在の土台のものでない`);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("#473: 状態を変えるスペックを変えたら落ち、そのスペックだけを 2 回回し直せば通る", () => {
  const { root, metadataPath } = perSpecProject((m) => {
    m.suite.repeat_run.specs.push({
      path: `${SPEC_DIR}/grid.spec.ts`,
      state_mutating: true,
      reason: "グリッド設定を保存し、同じテストで Reset する",
    });
  });
  writeFileSync(
    join(root, SPEC_DIR, "grid.spec.ts"),
    "test('grid', async () => { save(); reset(); });\n",
  );
  recordRuns(metadataPath, [LOCALE, `${SPEC_DIR}/grid.spec.ts`, ORDERS], "2026-09-20");
  writeFileSync(join(root, LOCALE), "test('locale', async () => { save('en'); });\n");
  const stale = run(metadataPath);
  expect(stale.stdout).toContain(
    `状態を変えるスペック ${LOCALE} の 2 回の記録は現在のスペックのものでない`,
  );
  expect(stale.stdout).not.toContain("grid.spec.ts の 2 回の記録");
  expect(stale.status).toBe(1);
  recordRuns(metadataPath, [LOCALE], "2026-09-21");
  const r = run(metadataPath);
  expect(r.stdout).not.toMatch(/^warn: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.each([
  ["suite.specs の下のスペック以外（共通の関数）", `${SPEC_DIR}/helpers.ts`],
  ["共有の宣言パス（expectations）", "e2e/parity/lib/expectations.ts"],
])("#473: 共有の土台を変えたら状態を変えるスペックの記録が失効する: %s", (_name, file) => {
  const { root, metadataPath } = perSpecProject();
  recordRuns(metadataPath, [LOCALE], "2026-09-20");
  writeFileSync(join(root, file), "export const changed = 2;\n");
  const r = run(metadataPath);
  expect(r.stdout).toContain(`スペック ${LOCALE} の 2 回の記録は現在の土台のものでない`);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("#473: current_excluded の下（新側専用スペック）に足しても記録は失効せず、分類も要らない", () => {
  const { root, metadataPath } = perSpecProject();
  recordRuns(metadataPath, [LOCALE, ORDERS], "2026-09-20");
  mkdirSync(join(root, SPEC_DIR, "new-only"), { recursive: true });
  writeFileSync(
    join(root, SPEC_DIR, "new-only/capture-new.spec.ts"),
    "test('capture', () => {});\n",
  );
  const r = run(metadataPath);
  expect(r.stdout).not.toMatch(/^warn: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("#473: reason の無い current_excluded は外さずに数える（無根拠の緩和を通さない）", () => {
  const { root, metadataPath } = perSpecProject((m) => {
    m.suite.repeat_run.current_excluded[0].reason = "";
  });
  recordRuns(metadataPath, [LOCALE], "2026-09-20");
  mkdirSync(join(root, SPEC_DIR, "new-only"), { recursive: true });
  writeFileSync(
    join(root, SPEC_DIR, "new-only/capture-new.spec.ts"),
    "test('capture', () => {});\n",
  );
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/current_excluded の .*new-only に reason が無い/);
  expect(r.stdout).toContain(`分類されていないスペック: ${SPEC_DIR}/new-only/capture-new.spec.ts`);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.each([
  [
    "分類されていないスペックがある",
    (root) => writeFileSync(join(root, SPEC_DIR, "extra.spec.ts"), "test('x', () => {});\n"),
    () => {},
    `分類されていないスペック: ${SPEC_DIR}/extra.spec.ts`,
  ],
  [
    "分類の reason が空",
    () => {},
    (m) => (m.suite.repeat_run.specs[0].reason = " "),
    `repeat_run.specs の ${ORDERS} に reason が無い`,
  ],
  [
    "分類が重複している",
    () => {},
    (m) =>
      m.suite.repeat_run.specs.push({ path: `./${ORDERS}`, state_mutating: true, reason: "x" }),
    `repeat_run.specs に ${ORDERS} が重複している`,
  ],
  [
    "分類表のスペックが suite.specs の下に無い",
    () => {},
    (m) =>
      m.suite.repeat_run.specs.push({
        path: "e2e/other/a.spec.ts",
        state_mutating: false,
        reason: "x",
      }),
    "repeat_run.specs のスペックが suite.specs の下に無い: e2e/other/a.spec.ts",
  ],
  [
    "状態を変えるスペックが 1 件も無い",
    () => {},
    (m) => (m.suite.repeat_run.specs[1].state_mutating = false),
    "状態を変えるスペックが 1 件も無い",
  ],
  [
    "状態を変えるスペックの記録に shared_fingerprint が無い",
    () => {},
    (m) => m.suite.repeat_run.runs.forEach((r) => delete r.shared_fingerprint),
    `スペック ${LOCALE} の記録に shared_fingerprint が無い`,
  ],
  [
    "状態を変えるスペックを含む直近 2 回の後の回が赤",
    () => {},
    (m) => (m.suite.repeat_run.runs[1].result = "red"),
    `スペック ${LOCALE}: 連続する 2 回のうち 2 回目が緑でない`,
  ],
  [
    "状態を変えるスペックを含む 2 回の started_at が同じ",
    () => {},
    (m) => (m.suite.repeat_run.runs[1].started_at = m.suite.repeat_run.runs[0].started_at),
    `スペック ${LOCALE}: 連続する 2 回の started_at が同じ`,
  ],
  [
    "状態を変えるスペックを含む記録が 1 回だけ（もう 1 回は別のスペックだけ）",
    () => {},
    (m) => (m.suite.repeat_run.runs[1].spec_fingerprints = { [ORDERS]: "sha256-nc:x" }),
    `状態を変えるスペック ${LOCALE} の実行記録が 1 件`,
  ],
])("#473: スペック単位の記録の不備は exit 1: %s", (_name, prepare, mutate, needle) => {
  const { root, metadataPath } = perSpecProject();
  recordRuns(metadataPath, [LOCALE], "2026-09-20");
  prepare(root);
  editMetadata(metadataPath, mutate);
  const r = run(metadataPath);
  expect(r.stdout).toContain(needle);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("#473: suite.state_mutating: false なのに状態を変えるスペックを分類していたら落とす", () => {
  const { root, metadataPath } = perSpecProject((m) => {
    m.suite.state_mutating = false;
    m.suite.repeat_run.reason = "読み取りだけ";
  });
  const r = run(metadataPath);
  expect(r.stdout).toMatch(
    /state_mutating: false なのに repeat_run\.specs に状態を変えるスペックがある/,
  );
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test.each([
  ["specs が配列でない", (m) => (m.suite.repeat_run.specs = {}), "repeat_run.specs が配列でない"],
  [
    "state_mutating が真偽値でない",
    (m) => (m.suite.repeat_run.specs[0].state_mutating = "no"),
    "state_mutating が真偽値でない",
  ],
  [
    "spec_fingerprints がオブジェクトでない",
    (m) => (m.suite.repeat_run.runs[0].spec_fingerprints = [LOCALE]),
    "spec_fingerprints が",
  ],
  [
    "spec_fingerprints に正規化すると同じスペックになるキーが 2 つある",
    (m) => {
      const prints = m.suite.repeat_run.runs[0].spec_fingerprints;
      prints[`./${LOCALE}`] = "sha256-nc:stale";
    },
    `spec_fingerprints に同じスペック ${LOCALE} を指すキーが複数ある`,
  ],
  [
    "shared_files が配列でない",
    (m) => (m.suite.repeat_run.shared_files = "helpers.ts"),
    "shared_files が配列でない",
  ],
  [
    "current_excluded が配列でない",
    (m) => (m.suite.repeat_run.current_excluded = "new-only"),
    "current_excluded が配列でない",
  ],
])("#473: スペック単位の記録の型崩れは exit 2: %s", (_name, mutate, needle) => {
  const { root, metadataPath } = perSpecProject();
  recordRuns(metadataPath, [LOCALE], "2026-09-20");
  editMetadata(metadataPath, mutate);
  const r = run(metadataPath);
  expect(r.stderr).toContain(needle);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("#473: repeat_run.specs を持たない成果物は従来どおりスイート全体の指紋で判定する（状態を変えないスペックの変更でも落ちる）", () => {
  const { root, metadataPath, fp, specPath } = recordedProject({ specBody: SPEC_WITH_NOTE });
  expect(fp).toMatch(/^sha256-nc:/);
  writeFileSync(specPath, SPEC_WITH_NOTE.replace("orders\\/list", "orders\\/detail"));
  const r = run(metadataPath);
  expect(r.stdout).toMatch(/記録した 2 回は現在のスイートのものでない/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("#473: --fingerprint は suite_fingerprint と、分類表を反映したスペック・土台の指紋を出す", () => {
  const { root, metadataPath } = perSpecProject();
  mkdirSync(join(root, SPEC_DIR, "new-only"), { recursive: true });
  writeFileSync(
    join(root, SPEC_DIR, "new-only/capture-new.spec.ts"),
    "test('capture', () => {});\n",
  );
  const fp = fingerprints(metadataPath);
  expect(fp.suite_fingerprint).toBe(
    suiteFingerprint({ specs: SPEC_DIR, expectations: "e2e/parity/lib/expectations.ts" }, root)
      .fingerprint,
  );
  expect(Object.keys(fp.spec_fingerprints).sort()).toEqual([LOCALE, ORDERS]);
  expect(fp.shared_fingerprint).toMatch(/^sha256-nc:[0-9a-f]{64}$/);
  expect(fp.spec_fingerprints[LOCALE]).not.toBe(fp.spec_fingerprints[ORDERS]);
  rmSync(root, { recursive: true, force: true });
});

test("#473 再現（Codex レビュー）: 命名規則に当たらないファイルは、別名で test を呼んでいても宣言が無ければ落とす", () => {
  const { root, metadataPath } = perSpecProject();
  writeFileSync(
    join(root, SPEC_DIR, "bulk-delete.pw.ts"),
    "import { test as it } from '@playwright/test';\nit('delete', async () => { save(); });\n",
  );
  recordRuns(metadataPath, [LOCALE, ORDERS], "2026-09-20");
  const r = run(metadataPath);
  expect(r.stdout).toContain(
    `repeat_run.specs にも repeat_run.shared_files にも無いファイル: ${SPEC_DIR}/bulk-delete.pw.ts`,
  );
  expect(r.status).toBe(1);
  // 分類表に書けば、スペックとして 2 回続けての緑を求められる
  editMetadata(metadataPath, (m) =>
    m.suite.repeat_run.specs.push({
      path: `${SPEC_DIR}/bulk-delete.pw.ts`,
      state_mutating: true,
      reason: "一括削除し、同じテストで戻す",
    }),
  );
  const declared = run(metadataPath);
  expect(declared.stdout).toContain(
    `状態を変えるスペック ${SPEC_DIR}/bulk-delete.pw.ts の実行記録が 0 件`,
  );
  expect(declared.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("#473: 共通の関数・fixture は shared_files に宣言すれば土台として通る（宣言しなければ落ちる）", () => {
  const { root, metadataPath } = perSpecProject();
  writeFileSync(
    join(root, SPEC_DIR, "fixtures.ts"),
    "export const test = base.extend({ page: async ({}, use) => use(1) });\n",
  );
  writeFileSync(join(root, SPEC_DIR, "data.json"), "{}\n");
  recordRuns(metadataPath, [LOCALE, ORDERS], "2026-09-20");
  const undeclared = run(metadataPath);
  expect(undeclared.stdout).toContain(`shared_files にも無いファイル: ${SPEC_DIR}/fixtures.ts`);
  // JS / TS 系でないファイル（データ等）は宣言を求めない
  expect(undeclared.stdout).not.toContain("data.json");
  expect(undeclared.status).toBe(1);
  editMetadata(metadataPath, (m) =>
    m.suite.repeat_run.shared_files.push({
      path: `${SPEC_DIR}/fixtures.ts`,
      reason: "fixture の定義だけでテストを定義しない",
    }),
  );
  const r = run(metadataPath);
  expect(r.stdout).not.toMatch(/^warn: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test.each([
  [
    "reason が空",
    (m) => (m.suite.repeat_run.shared_files[0].reason = ""),
    `repeat_run.shared_files の ${SPEC_DIR}/helpers.ts に reason が無い`,
  ],
  [
    "specs と両方にある",
    (m) => m.suite.repeat_run.shared_files.push({ path: LOCALE, reason: "共通関数" }),
    `${LOCALE} が repeat_run.specs と repeat_run.shared_files の両方にある`,
  ],
  [
    "実体が無い",
    (m) =>
      m.suite.repeat_run.shared_files.push({ path: `${SPEC_DIR}/gone.ts`, reason: "共通関数" }),
    `repeat_run.shared_files のファイルが suite.specs の下の土台に無い: ${SPEC_DIR}/gone.ts`,
  ],
])("#473: shared_files の記録の不備は exit 1: %s", (_name, mutate, needle) => {
  const { root, metadataPath } = perSpecProject();
  recordRuns(metadataPath, [LOCALE, ORDERS], "2026-09-20");
  editMetadata(metadataPath, mutate);
  const r = run(metadataPath);
  expect(r.stdout).toContain(needle);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("#473: suite.state_mutating: false でも repeat_run.specs の型崩れは exit 2", () => {
  const { root, metadataPath } = perSpecProject((m) => {
    m.suite.state_mutating = false;
    m.suite.repeat_run.reason = "読み取りだけ";
    m.suite.repeat_run.specs = {};
  });
  const r = run(metadataPath);
  expect(r.stderr).toContain("repeat_run.specs が配列でない");
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("#473: current_excluded の下にあっても、土台の宣言パス（interactions 等）は指紋から外さない", () => {
  const adapter = `${SPEC_DIR}/new-only/adapter.ts`;
  const { root, metadataPath } = perSpecProject((m) => {
    m.suite.interactions = adapter;
  });
  mkdirSync(join(root, SPEC_DIR, "new-only"), { recursive: true });
  writeFileSync(join(root, adapter), "export const click = () => 1;\n");
  recordRuns(metadataPath, [LOCALE, ORDERS], "2026-09-20");
  writeFileSync(join(root, adapter), "export const click = () => 2;\n");
  const r = run(metadataPath);
  expect(r.stdout).toContain(`スペック ${LOCALE} の 2 回の記録は現在の土台のものでない`);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});
