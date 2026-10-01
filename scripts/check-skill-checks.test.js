// 配布スキルの検査の配線宣言（checks.json）と、配線しない一覧の分類検査の回帰テスト。
//
// 判定は一時ディレクトリの fixture で測り、実リポジトリには「通ること」と「宣言が実在の検査を
// 名指していること」だけを当てる。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸                         | 値                                                                         |
// | -------------------------- | -------------------------------------------------------------------------- |
// | 検査スクリプト             | 0 本 / 1 本以上 / `*.test.*`（数えない）/ サブディレクトリ / シンボリックリンク / 祖先を指す循環リンク / リポジトリの外を指すリンク / 規約外の拡張子 / 名前が -check でない |
// | 分類                       | wire だけ / unwired だけ / 両方 / どちらにも無い                           |
// | checks.json                | 在る / 無い（検査あり・なし）/ JSON でない / 未知のキー / version・skill の誤り |
// | wire の項目                | 正しい / script 不在・絶対パス・. / .. / 空セグメント / command の形 / {script} の回数 / 未解決・未使用のプレースホルダ |
// | params                     | config_key / by_stage（stages と一致・不一致、値は value・resolve・素の文字列・併用・語彙外）/ 両方 / config_key の形 |
// | applies_when               | exists のみ / exists_at_base のみ / 両方 / どちらも無い / 無い / 空配列 / 配列でない / 未知のキー |
// | stages                     | pre-commit・ci / 空 / 語彙外 / 重複                                        |
// | unwired 一覧               | 在る / 無い / JSON でない / reason 空 / 実在しない検査 / 重複              |
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  UNWIRED_PATH,
  checkDeclaration,
  checkSkillChecks,
  findCheckScripts,
  main,
} from "./check-skill-checks.js";
import { makeTempDir } from "./lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "scripts/check-skill-checks.js");

function write(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

const entry = (over = {}) => ({
  id: "a-wait",
  script: "scripts/a-check.mjs",
  command: ["node", "{script}", "{dir}/parity/"],
  params: { dir: { config_key: "skills.s.dir", default: "e2e/" } },
  applies_when: { exists: ["{dir}/parity/"] },
  appears_after: "feature モードの後",
  run_from: "リポジトリのルート",
  stages: ["pre-commit", "ci"],
  ...over,
});

/**
 * skills/s に a-check.mjs（配線）と b-check.mjs（配線しない）を置いた一時リポジトリ。
 * `decl` が null なら checks.json を置かない。
 */
function makeRepo({ decl, unwired, extraFiles = {} } = {}) {
  const root = makeTempDir("skill-checks-");
  write(root, "skills/s/SKILL.md", "---\nname: s\n---\n");
  write(root, "skills/s/scripts/a-check.mjs", "");
  write(root, "skills/s/scripts/b-check.mjs", "");
  for (const [p, t] of Object.entries(extraFiles)) write(root, p, t);
  const d = decl === undefined ? { version: 1, skill: "s", wire: [entry()] } : decl;
  if (d !== null)
    write(root, "skills/s/checks.json", typeof d === "string" ? d : JSON.stringify(d));
  const u =
    unwired === undefined
      ? { unwired: [{ script: "skills/s/scripts/b-check.mjs", reason: "工程の判定" }] }
      : unwired;
  if (u !== null) write(root, UNWIRED_PATH, typeof u === "string" ? u : JSON.stringify(u));
  return root;
}

const violationsOf = (root) => checkSkillChecks(root).violations;
const declWith = (over) => ({ version: 1, skill: "s", wire: [entry(over)] });

// ---- 陰性コントロール（通さねばならない入力）----

test("陰性: 全検査が wire か unwired の一方にだけ載っていれば通し、件数を数える", () => {
  expect(checkSkillChecks(makeRepo())).toEqual({
    checks: 2,
    wired: 1,
    unwired: 1,
    declarations: 1,
    violations: [],
  });
});

test("陰性: applies_when は比較元の版の条件（exists_at_base）だけでもよい（削除を検出する検査向け）", () => {
  const root = makeRepo({
    decl: declWith({
      command: ["node", "{script}"],
      params: undefined,
      applies_when: { exists_at_base: [".replace/features.md"] },
    }),
  });
  expect(violationsOf(root)).toEqual([]);
});

test("陰性: 配線する検査が無いスキルは wire: [] で宣言できる", () => {
  const root = makeRepo({
    decl: { version: 1, skill: "s", wire: [] },
    unwired: {
      unwired: [
        { script: "skills/s/scripts/a-check.mjs", reason: "r" },
        { script: "skills/s/scripts/b-check.mjs", reason: "r" },
      ],
    },
  });
  expect(violationsOf(root)).toEqual([]);
});

test("陰性: by_stage・optional_args・exists_at_base・notes を持つ項目を通す", () => {
  const root = makeRepo({
    decl: declWith({
      command: ["node", "{script}", "--base", "{base}"],
      params: {
        base: {
          by_stage: { "pre-commit": { value: "HEAD" }, ci: { resolve: "merge-base を求める" } },
        },
      },
      optional_args: [{ args: ["--v", "x.md"], when_exists: "x.md" }],
      applies_when: { exists: ["f.md"], exists_at_base: ["f.md"] },
      notes: "補足",
    }),
  });
  expect(violationsOf(root)).toEqual([]);
});

test("陰性: 検査を持たないスキルは checks.json が無くてよく、*.test.* と -check でない名前は数えない", () => {
  const root = makeRepo({
    extraFiles: {
      "skills/t/SKILL.md": "",
      "skills/t/scripts/capture.mjs": "",
      "skills/s/scripts/a-check.test.mjs": "",
    },
  });
  expect(checkSkillChecks(root).checks).toBe(2);
  expect(violationsOf(root)).toEqual([]);
});

test("陰性: scripts/ のサブディレクトリにある検査も拾う", () => {
  const root = makeTempDir("skill-checks-");
  write(root, "skills/s/scripts/sub/c-check.sh", "");
  expect(findCheckScripts(root)).toEqual(["skills/s/scripts/sub/c-check.sh"]);
});

test("陰性: シンボリックリンクの検査・ディレクトリも拾う（リンクを黙って走査から外さない）", () => {
  const root = makeTempDir("skill-checks-");
  write(root, "shared/d-check.mjs", "");
  write(root, "shared/dir/e-check.mjs", "");
  mkdirSync(join(root, "skills/s/scripts"), { recursive: true });
  symlinkSync(join(root, "shared/d-check.mjs"), join(root, "skills/s/scripts/d-check.mjs"));
  symlinkSync(join(root, "shared/dir"), join(root, "skills/s/scripts/linked"));
  expect(findCheckScripts(root)).toEqual([
    "skills/s/scripts/d-check.mjs",
    "skills/s/scripts/linked/e-check.mjs",
  ]);
});

test("陰性: 祖先を指すディレクトリのリンクは辿り直さず、判定できないに倒さない", () => {
  const root = makeRepo();
  symlinkSync("..", join(root, "skills/s/scripts/up"));
  expect(findCheckScripts(root)).toEqual([
    "skills/s/scripts/a-check.mjs",
    "skills/s/scripts/b-check.mjs",
  ]);
  expect(main([root])).toBe(0);
});

test("陽性: リポジトリの外を指すリンクは辿らず判定できない（exit 2。CI のファイルシステムを走査しない）", () => {
  const root = makeRepo();
  const outside = makeTempDir("skill-checks-outside-");
  write(outside, "x-check.mjs", "");
  symlinkSync(outside, join(root, "skills/s/scripts/external"));
  expect(() => checkSkillChecks(root)).toThrow("リポジトリの外");
  expect(main([root])).toBe(2);
});

test("陽性: 宣言した script がリンクでスキルの外を指していたら落とす（配布されない）", () => {
  const root = makeRepo({
    extraFiles: { "shared/c-check.mjs": "" },
    unwired: {
      unwired: [
        { script: "skills/s/scripts/b-check.mjs", reason: "r" },
        { script: "skills/s/scripts/c-check.mjs", reason: "r" },
      ],
    },
  });
  symlinkSync(join(root, "shared/c-check.mjs"), join(root, "skills/s/scripts/c-check.mjs"));
  const { violations } = checkDeclaration(root, "s");
  expect(violations).toEqual([]);
  writeFileSync(
    join(root, "skills/s/checks.json"),
    JSON.stringify({ version: 1, skill: "s", wire: [entry({ script: "scripts/c-check.mjs" })] }),
  );
  expect(checkDeclaration(root, "s").violations).toContainEqual(
    expect.stringContaining("script scripts/c-check.mjs がスキルのディレクトリの外を指している"),
  );
});

test("陽性: 規約外の拡張子の検査も拾い、分類を問う（拡張子で分類から漏らさない）", () => {
  const root = makeRepo({ extraFiles: { "skills/s/scripts/c-check.py": "" } });
  expect(violationsOf(root)).toEqual([
    expect.stringContaining("skills/s/scripts/c-check.py: 配線するか決まっていない"),
  ]);
});

// ---- 陽性（落とす入力）----

test("陽性: どちらにも載っていない検査は「配線するか決まっていない」で落とす", () => {
  const root = makeRepo({ unwired: { unwired: [] } });
  expect(violationsOf(root)).toEqual([
    expect.stringContaining("skills/s/scripts/b-check.mjs: 配線するか決まっていない"),
  ]);
});

test("陽性: wire と unwired の両方に載っている検査を落とす", () => {
  const root = makeRepo({
    unwired: {
      unwired: [
        { script: "skills/s/scripts/a-check.mjs", reason: "r" },
        { script: "skills/s/scripts/b-check.mjs", reason: "r" },
      ],
    },
  });
  expect(violationsOf(root)).toEqual([
    expect.stringContaining("skills/s/scripts/a-check.mjs: checks.json と"),
  ]);
});

test("陽性: 検査を持つのに checks.json が無いスキルを落とす", () => {
  const root = makeRepo({ decl: null });
  expect(violationsOf(root)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("skills/s: 検査を持つのに checks.json が無い"),
    ]),
  );
});

test("陽性: unwired に実在しない検査・重複があれば落とす", () => {
  const root = makeRepo({
    unwired: {
      unwired: [
        { script: "skills/s/scripts/b-check.mjs", reason: "r" },
        { script: "skills/s/scripts/b-check.mjs", reason: "r" },
        { script: "skills/s/scripts/gone-check.mjs", reason: "r" },
      ],
    },
  });
  const v = violationsOf(root);
  expect(v).toContainEqual(expect.stringContaining("b-check.mjs が重複している"));
  expect(v).toContainEqual(expect.stringContaining("gone-check.mjs は検査として存在しない"));
});

test("陽性: checks.json のトップレベルの誤り（JSON でない・未知のキー・version・skill・wire）を落とす", () => {
  expect(violationsOf(makeRepo({ decl: "{" }))).toContainEqual(
    expect.stringContaining("JSON として読めない"),
  );
  const v = violationsOf(makeRepo({ decl: { version: 2, skill: "x", wire: {}, extra: 1 } }));
  expect(v).toContainEqual(expect.stringContaining("未知のキー extra"));
  expect(v).toContainEqual(expect.stringContaining("version は 1"));
  expect(v).toContainEqual(expect.stringContaining("skill がディレクトリ名"));
  expect(v).toContainEqual(expect.stringContaining("wire は配列"));
});

test.each([
  ["未知のキー", { extra: 1 }, "未知のキー extra"],
  ["id の形", { id: "A_B" }, "id は小文字英数字"],
  ["script の不在", { script: "scripts/none-check.mjs" }, "script scripts/none-check.mjs が無い"],
  ["script の絶対パス", { script: "/etc/passwd" }, "script はスキル直下からの相対パス"],
  ["script の ..", { script: "../t/scripts/a-check.mjs" }, "script はスキル直下からの相対パス"],
  ["script の .", { script: "./scripts/a-check.mjs" }, "script はスキル直下からの相対パス"],
  [
    "script の空セグメント",
    { script: "scripts//a-check.mjs" },
    "script はスキル直下からの相対パス",
  ],
  ["command が空", { command: [] }, "command は空でない文字列の配列"],
  ["command の実行系", { command: ["python", "{script}", "{dir}"] }, "command[0] は node か bash"],
  ["{script} が無い", { command: ["node", "x.mjs", "{dir}"] }, "{script} をちょうど 1 回"],
  [
    "{script} が 2 回",
    { command: ["node", "{script}", "{script}", "{dir}"] },
    "{script} をちょうど 1 回",
  ],
  [
    "未解決のプレースホルダ",
    { command: ["node", "{script}", "{nope}", "{dir}"] },
    "{nope} が params に無い",
  ],
  [
    "applies_when の {script}",
    { applies_when: { exists: ["{script}"] } },
    "{script} が params に無い",
  ],
  [
    "未使用の params",
    { params: { dir: { config_key: "skills.s.dir" }, other: { config_key: "skills.s.o" } } },
    "params.other がどこからも参照されていない",
  ],
  [
    "config_key の形",
    { params: { dir: { config_key: "dir" } } },
    "config_key は skills.<スキル名>.<キー>",
  ],
  [
    "default の型",
    { params: { dir: { config_key: "skills.s.dir", default: "" } } },
    "default は空でない",
  ],
  [
    "params の未知のキー",
    { params: { dir: { config_key: "skills.s.dir", x: 1 } } },
    "params.dir: 未知のキー x",
  ],
  ["params 名に script", { params: { script: { config_key: "skills.s.dir" } } }, "script は予約語"],
  [
    "by_stage と config_key の併用",
    {
      params: {
        dir: {
          config_key: "skills.s.dir",
          by_stage: { "pre-commit": { value: "a" }, ci: { value: "b" } },
        },
      },
    },
    "by_stage は他のキーと併用しない",
  ],
  [
    "by_stage のキーが stages と不一致",
    { params: { dir: { by_stage: { "pre-commit": { value: "a" } } } } },
    "by_stage のキーが stages と一致しない",
  ],
  [
    "by_stage の空値",
    { params: { dir: { by_stage: { "pre-commit": { value: "" }, ci: { value: "b" } } } } },
    "どちらか一方にする",
  ],
  [
    "by_stage の値が素の文字列（説明文がそのまま引数に渡る）",
    { params: { dir: { by_stage: { "pre-commit": "HEAD", ci: { value: "b" } } } } },
    "どちらか一方にする",
  ],
  [
    "by_stage の value と resolve の併用",
    {
      params: {
        dir: { by_stage: { "pre-commit": { value: "a", resolve: "r" }, ci: { value: "b" } } },
      },
    },
    "どちらか一方にする",
  ],
  [
    "by_stage の語彙外のキー",
    { params: { dir: { by_stage: { "pre-commit": { text: "a" }, ci: { value: "b" } } } } },
    "どちらか一方にする",
  ],
  ["optional_args の形", { optional_args: [{ args: [] }] }, "optional_args[0] は args"],
  ["optional_args が空", { optional_args: [] }, "optional_args は空でない配列"],
  ["applies_when が無い", { applies_when: undefined }, "applies_when に対象が現れた"],
  [
    "applies_when に exists も exists_at_base も無い",
    { applies_when: {} },
    "applies_when に対象が現れた",
  ],
  [
    "applies_when.exists が空",
    { applies_when: { exists: [] } },
    "applies_when.exists は空でない配列",
  ],
  [
    "applies_when の未知のキー",
    { applies_when: { exists: ["{dir}"], when: 1 } },
    "applies_when の未知のキー when",
  ],
  [
    "exists_at_base が空",
    { applies_when: { exists: ["{dir}"], exists_at_base: [] } },
    "exists_at_base は空でない配列",
  ],
  [
    "exists_at_base が配列でない（展開できない値）",
    { applies_when: { exists: ["{dir}"], exists_at_base: true } },
    "exists_at_base は空でない配列",
  ],
  ["appears_after が無い", { appears_after: " " }, "appears_after（対象が現れる工程）が無い"],
  ["run_from が無い", { run_from: undefined }, "run_from（起動するディレクトリ）が無い"],
  ["notes の型", { notes: "" }, "notes は空でない文字列"],
  ["stages が空", { stages: [] }, "stages は pre-commit / ci"],
  ["stages の語彙外", { stages: ["push"] }, "stages は pre-commit / ci"],
  ["stages の重複", { stages: ["ci", "ci"] }, "stages が重複している"],
])("陽性: wire の項目の誤り（%s）を落とす", (_name, over, message) => {
  const { violations } = checkDeclaration(makeRepo({ decl: declWith(over) }), "s");
  expect(violations).toContainEqual(expect.stringContaining(message));
});

test("陽性: 同じ id・同じ script を 2 項目に宣言したら落とす", () => {
  const root = makeRepo({ decl: { version: 1, skill: "s", wire: [entry(), entry()] } });
  const v = violationsOf(root);
  expect(v).toContainEqual(expect.stringContaining("id a-wait が重複している"));
  expect(v).toContainEqual(expect.stringContaining("checks.json に重複して宣言されている"));
});

test("陽性: 検査が 0 本なら判定できない（exit 2。走査が届いていないのを合格に倒さない）", () => {
  const root = makeTempDir("skill-checks-");
  write(root, "skills/s/SKILL.md", "");
  write(root, UNWIRED_PATH, JSON.stringify({ unwired: [] }));
  expect(() => checkSkillChecks(root)).toThrow("0 本");
  expect(main([root])).toBe(2);
});

test.each([
  ["無い", null, "が無い"],
  ["JSON でない", "{", "JSON"],
  ["unwired が配列でない", { unwired: {} }, "unwired は配列"],
  [
    "reason が空白だけ",
    { unwired: [{ script: "skills/s/scripts/b-check.mjs", reason: " " }] },
    "reason が無い",
  ],
])("陽性: 配線しない一覧が読めない（%s）なら exit 2", (_name, unwired, message) => {
  const root = makeRepo({ unwired });
  expect(() => checkSkillChecks(root)).toThrow(message);
  expect(main([root])).toBe(2);
});

test("陽性コントロール（CLI）: 子プロセスとして起動しても、違反は exit 1、合格なら exit 0", () => {
  const run = (root) => spawnSync(process.execPath, [script, root], { encoding: "utf8" });
  const bad = run(makeRepo({ unwired: { unwired: [] } }));
  expect(bad.status).toBe(1);
  expect(bad.stderr).toContain("配線するか決まっていない");
  const ok = run(makeRepo());
  expect(ok.status).toBe(0);
  expect(ok.stdout).toContain(
    "skill-checks: OK（検査 2 本: 配線 1 本・配線しない 1 本、宣言 1 ファイル）",
  );
});

// ---- 実リポジトリ ----

test("実リポジトリ: 全検査が分類済みで、配線する検査が 1 本以上ある", () => {
  const r = checkSkillChecks(repoRoot);
  expect(r.violations).toEqual([]);
  expect(r.wired).toBeGreaterThan(0);
  expect(r.wired + r.unwired).toBe(r.checks);
});
