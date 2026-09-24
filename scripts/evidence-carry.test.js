// 証跡の持ち越し（skills/parity-suite/scripts/evidence-carry.mjs）の回帰テスト（Issue #454）。
//
// 共通部品を 1 行直すと、新側リポジトリ全体の SHA に結びついた証跡が全ページで古くなる。
// judgeCarry はページの描画入力（render_inputs）の差分と変更宣言・影響の再計算・amend-verify の記録から、
// 持ち越してよいときだけ ok を返す。fail-closed: 読めない入力はどれも持ち越さない。
//
// 状態空間（軸 × 「読めない」を含む値）:
//   render_inputs: 無い / 空 / プレースホルダ / 有効
//   リポジトリ: 渡さない / 無い / 最上位でない / 有効      コミット: 無い / 16 進でない / 有効
//   差分 D: 空（描画入力の外だけ変わった）/ 宣言の files に含まれる / 含まれないファイルがある / 宣言の後に宣言外の編集
//   evidence-carry.json: 無い / 壊れた JSON / 形が違う / 有効    変更宣言: 無い / 不正 / 有効
//   影響: 影響なし / 影響あり / 判定不能（capture_scope 無し・部品 metadata 無し）
//   amend-verify: null / 記録が無い / change_id 違い / 組が無い / pass でない / sha256 不一致 / 有効
// git は本物のリポジトリを一時ディレクトリに作って使う（fixture は scripts/evidence-carry-fixture.js）。

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import {
  judgeCarry,
  LEGACY_HINT,
  toPathspec,
} from "../skills/parity-suite/scripts/evidence-carry.mjs";
import { fingerprintOf } from "../skills/parity-suite/scripts/component-comparison-check.mjs";
import {
  AFFECTED_PAIR,
  CHANGE_ID,
  FEATURE,
  RENDER_INPUTS,
  TARGET,
  amendVerifyPair,
  changeDeclaration,
  commit,
  featureMetadata,
  makeCarryProject,
  writeJson,
} from "./evidence-carry-fixture.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @type {string[]} */
const cleanup = [];
afterEach(() => {
  while (cleanup.length > 0)
    rmSync(/** @type {string} */ (cleanup.pop()), { recursive: true, force: true });
});

/**
 * fixture を作り、後片付けに登録する。
 * @param {Parameters<typeof makeCarryProject>[0]} [options]
 */
function project(options) {
  const p = makeCarryProject(options);
  cleanup.push(p.root);
  return p;
}

/**
 * judgeCarry を fixture の既定値で呼ぶ。
 * @param {ReturnType<typeof project>} p
 * @param {Partial<Parameters<typeof judgeCarry>[0]>} [override]
 */
function judge(p, override = {}) {
  return judgeCarry({
    recordedCommit: p.commits.base,
    wantedCommit: p.commits.component,
    renderInputs: RENDER_INPUTS,
    repo: p.repo,
    evidenceCarryPath: p.evidenceCarryPath,
    featureSlug: FEATURE,
    replaceRoot: p.replaceRoot,
    ...override,
  });
}

/** 同梱テンプレートの render_inputs（プレースホルダ）。 */
const templateRenderInputs = JSON.parse(
  readFileSync(join(repoRoot, "skills/parity-replace/assets/metadata-template.json"), "utf8"),
).new.render_inputs;

test("toPathspec: magic の無い pathspec に :(glob) を付け、magic 付きはそのまま", () => {
  expect(toPathspec("src/**")).toBe(":(glob)src/**");
  expect(toPathspec(":(literal)src/*.ts")).toBe(":(literal)src/*.ts");
});

test.each([
  ["無い", undefined],
  ["null", null],
  ["空配列", []],
])(
  "render_inputs が%s: 判定せず legacy（呼び出し側が従来どおり落とす）",
  (_label, renderInputs) => {
    const p = project();
    const result = judge(p, { renderInputs });
    expect(result).toEqual({
      ok: false,
      legacy: true,
      findings: [],
      notes: [LEGACY_HINT],
      carried_by: [],
    });
  },
);

test("render_inputs が同梱テンプレートのプレースホルダのまま: legacy ではなく読めない入力として落とす", () => {
  expect(Array.isArray(templateRenderInputs)).toBe(true);
  const p = project();
  const result = judge(p, { renderInputs: templateRenderInputs });
  expect(result.ok).toBe(false);
  expect(result.legacy).toBe(false);
  expect(result.findings[0]).toContain("render_inputs");
});

test("evidence-carry.json が同梱テンプレートのプレースホルダのまま: 落とす", () => {
  const p = project({ scope: [["list", "default", "desktop"]] });
  writeFileSync(
    p.evidenceCarryPath,
    readFileSync(join(repoRoot, "skills/parity-suite/assets/evidence-carry-template.json")),
  );
  const result = judge(p);
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain("変更宣言 を読めない");
});

test("D が空（描画入力の外だけ変わった）: 持ち越す・注記を残す", () => {
  const p = project();
  const unrelated = commit(p.repo, { "README.md": "app v2\n" }, "readme");
  const result = judge(p, { recordedCommit: p.commits.component, wantedCommit: unrelated });
  expect(result.ok).toBe(true);
  expect(result.findings).toEqual([]);
  expect(result.carried_by).toEqual([]);
  expect(result.notes.join("\n")).toContain("描画入力");
  expect(result.notes.join("\n")).toContain("差分が無い");
});

test("D が空でも evidence-carry.json を読まない（壊れていても持ち越しの判定に使わない）", () => {
  const p = project();
  const unrelated = commit(p.repo, { "README.md": "app v2\n" }, "readme");
  writeFileSync(p.evidenceCarryPath, "{ broken");
  expect(judge(p, { recordedCommit: p.commits.component, wantedCommit: unrelated }).ok).toBe(true);
});

test("D ⊆ 変更宣言の files で機能に影響しない（宣言した状態を撮っていない）: 持ち越す", () => {
  const p = project({ scope: [["list", "default", "desktop"]] });
  const result = judge(p);
  expect(result.findings).toEqual([]);
  expect(result.ok).toBe(true);
  expect(result.carried_by).toEqual([CHANGE_ID]);
  expect(result.notes.join("\n")).toContain("この機能に影響しない");
});

test("D に変更宣言の files に無いファイルがある: そのファイルを挙げて落とす", () => {
  const p = project({ scope: [["list", "default", "desktop"]] });
  const both = commit(
    p.repo,
    {
      "src/components/Button.tsx": "export const Button = () => <button className='shadow2' />;\n",
      "src/theme.css": ":root { --accent: red; }\n",
    },
    "button and theme",
  );
  writeJson(
    join(p.root, p.changePath),
    changeDeclaration({ before: p.commits.component, after: both }),
  );
  const result = judge(p, { recordedCommit: p.commits.component, wantedCommit: both });
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain("src/theme.css");
  expect(result.findings.join("\n")).toContain("どの変更宣言の files にも無い");
});

test("evidence-carry.json が無く D が空でない: 宣言が無いので落とす", () => {
  const p = project({ scope: [["list", "default", "desktop"]] });
  rmSync(p.evidenceCarryPath);
  const result = judge(p);
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain("src/components/Button.tsx");
  expect(result.notes.join("\n")).toContain("が無い");
});

test("宣言の後に宣言外の編集がある（files に名前があるだけの古い宣言）: 落とす", () => {
  const p = project({ scope: [["list", "default", "desktop"]] });
  const later = commit(
    p.repo,
    { "src/components/Button.tsx": "export const Button = () => <button disabled />;\n" },
    "undeclared edit",
  );
  const result = judge(p, { wantedCommit: later });
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain("連鎖で説明できない");
});

test("2 つの宣言が連鎖して記録の版から今の版までを説明する: 持ち越す", () => {
  const p = project({ scope: [["list", "default", "desktop"]] });
  const later = commit(
    p.repo,
    {
      "src/components/Button.tsx":
        "export const Button = () => <button className='shadow focus' />;\n",
    },
    "focus ring",
  );
  const secondPath = ".replace/components/button/changes/focus-ring.json";
  writeJson(
    join(p.root, secondPath),
    changeDeclaration({ id: "focus-ring", before: p.commits.component, after: later }),
  );
  writeJson(p.evidenceCarryPath, {
    carries: [
      { change: p.changePath, amend_verify: null },
      { change: secondPath, amend_verify: null },
    ],
  });
  const result = judge(p, { wantedCommit: later });
  expect(result.findings).toEqual([]);
  expect(result.ok).toBe(true);
  expect(result.carried_by).toEqual([CHANGE_ID, "focus-ring"]);
});

test("影響あり・amend-verify が全組 pass・画像の sha256 が一致: 持ち越す", () => {
  const p = project();
  const result = judge(p);
  expect(result.findings).toEqual([]);
  expect(result.ok).toBe(true);
  expect(result.carried_by).toEqual([CHANGE_ID]);
  expect(result.notes.join("\n")).toContain("amend-verify で pass");
});

test("影響あり・kind が new-appearance: amend-verify が全組 pass でも持ち越さない", () => {
  const p = project();
  const path = join(p.root, p.changePath);
  const change = JSON.parse(readFileSync(path, "utf8"));
  writeJson(path, { ...change, kind: "new-appearance" });
  const result = judge(p);
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain("機械判定で持ち越せるのは align-to-current だけ");
});

test("影響なし・kind が new-appearance: 影響しない機能は持ち越す（kind は影響する組の機械判定だけに効く）", () => {
  const p = project();
  const path = join(p.root, p.changePath);
  const change = JSON.parse(readFileSync(path, "utf8"));
  writeJson(path, { ...change, kind: "new-appearance" });
  const result = judge(p, { featureMetadata: featureMetadata([["list", "default", "desktop"]]) });
  expect(result.findings).toEqual([]);
  expect(result.ok).toBe(true);
});

test("機能の slug が空で metadata を渡していない: 別のパスへ潰さず slug が分からないとして落とす", () => {
  const p = project();
  const result = judge(p, { featureSlug: "" });
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain("機能の slug が分からない");
});

test.each([
  ["outside_scope_identical", { outside_scope_identical: false, inside_matches_current: true }],
  ["inside_matches_current", { outside_scope_identical: true, inside_matches_current: false }],
])(
  "変更宣言の catalog_verification.%s が false: 影響なしの機能でも持ち越さない",
  (_key, verification) => {
    const p = project();
    const path = join(p.root, p.changePath);
    const change = JSON.parse(readFileSync(path, "utf8"));
    writeJson(path, {
      ...change,
      catalog_verification: { ...change.catalog_verification, ...verification },
    });
    const result = judge(p, { featureMetadata: featureMetadata([["list", "default", "desktop"]]) });
    expect(result.ok).toBe(false);
    expect(result.findings.join("\n")).toContain("catalog_verification が合格していない");
  },
);

/**
 * 記録の組を書き換える。
 * @param {ReturnType<typeof project>} p
 * @param {(entry: Record<string, any>) => void} edit
 */
function editRecordPair(p, edit) {
  const record = JSON.parse(readFileSync(join(p.root, p.recordPath), "utf8"));
  edit(record.pairs[0]);
  writeJson(join(p.root, p.recordPath), record);
}

test("影響あり・記録の margin が変更宣言の margin_px と違う: 持ち越さない", () => {
  const p = project();
  editRecordPair(p, (entry) => {
    entry.margin = 400;
  });
  const result = judge(p);
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain("変更宣言の margin_px 4 と違う");
});

test("影響あり・記録の領域が traits.json の rect と違う（画面全体など）: 持ち越さない", () => {
  const p = project();
  editRecordPair(p, (entry) => {
    entry.declared_regions = [{ x: 0, y: 0, width: 1280, height: 800 }];
  });
  const result = judge(p);
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain(
    "declared_regions（0,0,1280,800）が新側の traits.json",
  );
});

test("影響あり・撮り直した組の traits.json が無い: 持ち越さない", () => {
  const p = project();
  const record = JSON.parse(readFileSync(join(p.root, p.recordPath), "utf8"));
  rmSync(join(p.root, dirname(record.pairs[0].inputs.new.path), "traits.json"));
  const result = judge(p);
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain("新側の traits.json を読めない");
});

test("影響あり・amend-verify の記録に影響する組が無い: 落とす", () => {
  const p = project();
  writeJson(join(p.root, p.recordPath), {
    tool: "amend-verify",
    version: "1",
    change_id: CHANGE_ID,
    pairs: [amendVerifyPair(p.root, "list|hover|mobile")],
  });
  const result = judge(p);
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain(`組 ${AFFECTED_PAIR} が 無い`);
});

test("影響あり・影響する組が pass でない: 落とす", () => {
  const p = project();
  writeJson(join(p.root, p.recordPath), {
    tool: "amend-verify",
    version: "1",
    change_id: CHANGE_ID,
    pairs: [amendVerifyPair(p.root, AFFECTED_PAIR, { pass: false })],
  });
  const result = judge(p);
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain("pass でない");
});

test("影響あり・判定後に画像を差し替えた（sha256 不一致）: 落とす", () => {
  const p = project();
  const record = JSON.parse(readFileSync(join(p.root, p.recordPath), "utf8"));
  writeFileSync(join(p.root, record.pairs[0].inputs.new.path), "PNG replaced\n");
  const result = judge(p);
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain("inputs.new が判定後に変わっている");
});

test("amend-verify の inputs のパスはプロジェクトルートから解決する（記録のディレクトリからではない）", () => {
  const p = project();
  const record = JSON.parse(readFileSync(join(p.root, p.recordPath), "utf8"));
  // 記録のディレクトリ相対に書き換える。ファイルは実在するがプロジェクトルートからは解決できない。
  // inputs.new は traits.json を引く起点にもなるので書き換えず、画像の解決規則だけを測る
  for (const key of ["prev_new", "current"]) {
    const ref = record.pairs[0].inputs[key];
    ref.path = ref.path.replace(`.replace/parity/${FEATURE}/new/${TARGET}/`, "");
  }
  writeJson(join(p.root, p.recordPath), record);
  const result = judge(p);
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain("inputs.prev_new を読めない");
});

test.each([
  [
    "amend_verify が null",
    (p) =>
      writeJson(p.evidenceCarryPath, { carries: [{ change: p.changePath, amend_verify: null }] }),
    "amend_verify が null",
  ],
  ["記録が無い", (p) => rmSync(join(p.root, p.recordPath)), "amend-verify の記録 を読めない"],
  [
    "記録の change_id が違う",
    (p) => {
      const record = JSON.parse(readFileSync(join(p.root, p.recordPath), "utf8"));
      record.change_id = "other";
      writeJson(join(p.root, p.recordPath), record);
    },
    "change_id",
  ],
  [
    "記録の tool が違う",
    (p) => writeJson(join(p.root, p.recordPath), { tool: "other", pairs: [] }),
    "amend-verify の記録の形でない",
  ],
])("影響あり・%s: 落とす", (_label, mutate, expected) => {
  const p = project();
  mutate(p);
  const result = judge(p);
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain(expected);
});

test("影響あり・usages だけで一致し領域が分からない組: amend-verify では持ち越さない", () => {
  const p = project();
  const change = JSON.parse(readFileSync(join(p.root, p.changePath), "utf8"));
  change.instances = [];
  change.usages = ["/orders"];
  writeJson(join(p.root, p.changePath), change);
  const result = judge(p);
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain("領域が分からない");
});

test("影響が判定不能（機能の capture_scope が無い）: 落とす", () => {
  const p = project();
  const metadata = featureMetadata([["list", "hover", "desktop"]]);
  delete metadata.capture_conditions.capture_scope;
  writeJson(join(p.slugDir, "metadata.json"), metadata);
  const result = judge(p);
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain("影響を判定できない");
});

test("影響が判定不能（部品 metadata が無い）: 落とす", () => {
  const p = project({ scope: [["list", "default", "desktop"]] });
  rmSync(join(p.replaceRoot, "components/button/metadata.json"));
  const result = judge(p);
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain("部品 metadata.json を読めない");
});

test("featureMetadata を渡せばそれを使う（呼び出し側が読んだ機能の metadata）", () => {
  const p = project();
  // ファイル側は影響あり、渡す側は hover を撮っていない → 影響なしで持ち越す（amend-verify を見ない）。
  rmSync(join(p.root, p.recordPath));
  const result = judge(p, { featureMetadata: featureMetadata([["list", "default", "desktop"]]) });
  expect(result.findings).toEqual([]);
  expect(result.ok).toBe(true);
});

test.each([
  ["変更宣言が無い", (p) => rmSync(join(p.root, p.changePath)), "変更宣言 を読めない"],
  [
    "変更宣言が不正（states が空）",
    (p) => {
      const change = JSON.parse(readFileSync(join(p.root, p.changePath), "utf8"));
      change.states = [];
      writeJson(join(p.root, p.changePath), change);
    },
    "が不正",
  ],
  [
    "evidence-carry.json が壊れた JSON",
    (p) => writeFileSync(p.evidenceCarryPath, "{ broken"),
    "JSON として壊れている",
  ],
  [
    "evidence-carry.json の形が違う",
    (p) => writeJson(p.evidenceCarryPath, { carry: [] }),
    "carries 配列",
  ],
  [
    "carries の要素の形が違う",
    (p) => writeJson(p.evidenceCarryPath, { carries: [{ change: "" }] }),
    "carries[0]",
  ],
])("%s: 落とす", (_label, mutate, expected) => {
  const p = project({ scope: [["list", "default", "desktop"]] });
  mutate(p);
  const result = judge(p);
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain(expected);
});

test("記録の版のコミットが新側リポジトリに無い: 落とす", () => {
  const p = project();
  const result = judge(p, { recordedCommit: "0123456789abcdef0123456789abcdef01234567" });
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain("記録した版 のコミット");
});

test("コミットが 16 進でない（git へオプションとして渡さない）: 落とす", () => {
  const p = project();
  const result = judge(p, { wantedCommit: "--output=/tmp/x" });
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain("16 進");
});

test("変更宣言の commits がリポジトリに無い: 落とす", () => {
  const p = project({ scope: [["list", "default", "desktop"]] });
  writeJson(
    join(p.root, p.changePath),
    changeDeclaration({ before: "abcdef0", after: p.commits.component }),
  );
  const result = judge(p);
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain("commits.before");
});

test.each([
  ["--new-repo を渡さない", () => null, "--new-repo"],
  ["リポジトリが無い", (p) => join(p.root, "missing"), "git を実行できない"],
  ["リポジトリの最上位でない", (p) => join(p.repo, "src"), "がリポジトリの最上位（"],
])("%s: 落とす", (_label, repoOf, expected) => {
  const p = project();
  const result = judge(p, { repo: repoOf(p) });
  expect(result.ok).toBe(false);
  expect(result.legacy).toBe(false);
  expect(result.findings.join("\n")).toContain(expected);
});

test("--replace-root を決められない: 落とす", () => {
  const p = project();
  const result = judge(p, { replaceRoot: null });
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain("--replace-root");
});

// 2 つの検査器が同じ fixture に同じ判定を出すこと（どちらも judgeCarry で判定する）。
const healthCheck = join(repoRoot, "skills/parity-suite/scripts/artifact-health-check.mjs");
const comparisonCheck = join(
  repoRoot,
  "skills/parity-suite/scripts/component-comparison-check.mjs",
);

/**
 * 両方の検査器が読む成果物を、記録の版 recorded・今の版 wanted で書く。
 * @param {ReturnType<typeof project>} p
 * @param {string} recorded
 * @param {string} wanted
 */
function writeCheckerInputs(p, recorded, wanted) {
  // artifact-health-check の他の節（採取物・反復実行・未測定）はキーごと持たない旧成果物として判定させない
  // （雛形のプレースホルダで落ちると、持ち越しの判定と区別できない）。
  const metadata = JSON.parse(readFileSync(join(p.slugDir, "metadata.json"), "utf8"));
  delete metadata.artifact_health;
  delete metadata.unmeasured;
  delete metadata.suite.state_mutating;
  writeJson(join(p.slugDir, "metadata.json"), metadata);
  writeJson(join(p.stageDir, "replace-metadata.json"), {
    suite: { new_green: true },
    new: { target: TARGET, commit: wanted, dirty: false, render_inputs: RENDER_INPUTS },
    loop: { iterations: 2 },
  });
  writeJson(join(p.stageDir, "diff-metadata.json"), {
    new: { target: TARGET, commit: recorded },
    iteration: 2,
    dataset_version: null,
    dataset_version_exempt: "投入対象でない target",
    converged: true,
  });
  const keys = ["grid|sort|grid@list"];
  writeJson(join(p.slugDir, "component-coverage.json"), {
    slug: FEATURE,
    measured_target: "current",
    cells: [
      {
        component: "grid",
        item: "sort",
        instance: "grid@list",
        value: "present",
        evidence: "読了",
      },
    ],
  });
  writeJson(join(p.stageDir, "component-comparison.json"), {
    slug: FEATURE,
    target: TARGET,
    source_coverage: { path: "component-coverage.json", fingerprint: fingerprintOf(keys) },
    new_implementation: { commit: recorded, dirty: false },
    cells: [
      {
        component: "grid",
        item: "sort",
        instance: "grid@list",
        compared: true,
        evidence: { entry: "押せた", hit_area: "見出し全体", completion: "並んだ" },
      },
    ],
  });
}

/**
 * 両検査器を CLI として回す。
 * @param {ReturnType<typeof project>} p
 */
function runBoth(p) {
  const health = spawnSync(
    process.execPath,
    [
      healthCheck,
      "--metadata",
      join(p.slugDir, "metadata.json"),
      "--target",
      TARGET,
      "--new-repo",
      p.repo,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const comparison = spawnSync(
    process.execPath,
    [
      comparisonCheck,
      "--coverage",
      join(p.slugDir, "component-coverage.json"),
      "--comparison",
      join(p.stageDir, "component-comparison.json"),
      "--target",
      TARGET,
      "--replace-metadata",
      join(p.stageDir, "replace-metadata.json"),
      "--new-repo",
      p.repo,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return { health, comparison, comparisonResult: JSON.parse(comparison.stdout) };
}

test("両検査器の一致: 持ち越せる fixture では両方とも合格", () => {
  const p = project();
  writeCheckerInputs(p, p.commits.base, p.commits.component);
  const { health, comparison, comparisonResult } = runBoth(p);
  expect(health.stdout).toContain("証跡を持ち越す");
  expect(health.stdout).not.toContain("今の新側の版に対応していない");
  expect(comparisonResult.findings).toEqual([]);
  expect(comparisonResult.notes.join("\n")).toContain("証跡を持ち越す");
  expect(comparison.status).toBe(0);
  expect(health.status).toBe(comparison.status);
});

test("両検査器の一致: 宣言外のファイルが変わった fixture では両方とも落とす", () => {
  const p = project();
  const theme = commit(p.repo, { "src/theme.css": ":root { --accent: red; }\n" }, "theme");
  writeCheckerInputs(p, p.commits.base, theme);
  const { health, comparison, comparisonResult } = runBoth(p);
  expect(health.status).toBe(1);
  expect(health.stdout).toContain("今の新側の版に対応していない");
  expect(health.stdout).toContain("証跡を持ち越せない");
  expect(health.stdout).toContain("src/theme.css");
  expect(comparison.status).toBe(1);
  const codes = comparisonResult.findings.map((f) => f.code);
  expect(codes).toContain("comparison-implementation-stale");
  expect(codes).toContain("evidence-carry-rejected");
  expect(comparisonResult.findings.map((f) => f.message).join("\n")).toContain("src/theme.css");
});

test("render_inputs の pathspec がどちらの版のファイルにも当たらない: D が空でも持ち越さない", () => {
  const p = project();
  const unrelated = commit(p.repo, { "README.md": "app v2\n" }, "readme");
  const result = judge(p, {
    recordedCommit: p.commits.component,
    wantedCommit: unrelated,
    renderInputs: [...RENDER_INPUTS, "src/compnents/**"],
  });
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain("src/compnents/**");
  expect(result.findings.join("\n")).toContain("当たらない");
});

test("影響インスタンスのページがどの機能のページとも一致しない: この機能が影響なしでも持ち越さない", () => {
  const p = project({ scope: [["list", "default", "desktop"]] });
  const component = JSON.parse(
    readFileSync(join(p.replaceRoot, "components/button/metadata.json"), "utf8"),
  );
  // 書き方の食い違い（末尾スラッシュ）: どの機能の capture_conditions.pages[].path とも一致しない
  component.instances[0].page = "/orders/";
  writeJson(join(p.replaceRoot, "components/button/metadata.json"), component);
  const change = JSON.parse(readFileSync(join(p.root, p.changePath), "utf8"));
  // usages は機能のページと一致させ、一致しないのはインスタンスだけにする（usages の検査と区別する）
  change.usages = ["/orders"];
  writeJson(join(p.root, p.changePath), change);
  const result = judge(p);
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain("影響インスタンスがどの機能のページとも一致しない");
});

test("変更宣言の usages がどの機能のページとも一致しない: 持ち越さない", () => {
  const p = project();
  const path = join(p.root, p.changePath);
  const change = JSON.parse(readFileSync(path, "utf8"));
  writeJson(path, { ...change, usages: [...change.usages, "/ordres"] });
  const result = judge(p);
  expect(result.ok).toBe(false);
  expect(result.findings.join("\n")).toContain("usages がどの機能のページとも一致しない: /ordres");
});

test("影響インスタンスのページが別の機能のページにある: 一致しないに数えず持ち越す", () => {
  const p = project({ scope: [["list", "default", "desktop"]] });
  const change = JSON.parse(readFileSync(join(p.root, p.changePath), "utf8"));
  change.instances = ["pager-next", "search-submit"];
  writeJson(join(p.root, p.changePath), change);
  const other = featureMetadata([["search", "default", "desktop"]]);
  other.capture_conditions.pages = [
    { ...other.capture_conditions.pages[0], name: "search", path: "/search" },
  ];
  writeJson(join(p.replaceRoot, "parity/search/metadata.json"), other);
  const result = judge(p);
  expect(result.findings).toEqual([]);
  expect(result.ok).toBe(true);
});
