// 学びのノートの frontmatter の読み方を、同梱のスクリプトの間でそろえることのテスト（Issue #744）。
//
// 参照の注入・忘却・週次の報告・KEDB 照合は、共通ライブラリの kaizen_frontmatter_values で欄を読む。
// 読み方は広げず、キーの直後にコロンを書いた行の、コロンより後ろをそのまま読む。
// 行末のコメント・引用符・YAML の記号を含む書き方は、kaizen-status-check.sh が止める。
// そこで、次の 3 つを確かめる。
//   - 共通の関数の読み方（キーの順・無い欄・重なったキー・frontmatter の範囲・前後の空白）
//   - kaizen-status-check.sh が通す書き方は、共通の関数が意図した値として読む（止める書き方の集合も閉じている）
//   - `status: pending # メモ` と `status: "pending"` を、status-check が止め、どのスクリプトも pending として扱わない
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";
import { coverageEnv } from "../../../lib/testing/coverage-env.ts";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";
import { kaizenEnv } from "../kaizen-config-env.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const scriptsDir = join(repoRoot, "skills/kaizen/scripts");
const lib = join(scriptsDir, "kaizen-hook-common.sh");
const NOTE_NAME = "2025-01-01-note.md";

const workdirs: string[] = [];
afterEach(() => {
  for (const dir of workdirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(content: string) {
  const dir = makeTempDir("kaizen-fm-");
  workdirs.push(dir);
  mkdirSync(join(dir, ".kaizen"));
  writeFileSync(join(dir, ".kaizen", NOTE_NAME), content);
  const init = spawnSync("git", ["init", "-q", "."], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: dir,
    encoding: "utf8",
  });
  expect(init.status, init.stderr).toBe(0);
  return dir;
}

/** 共通の関数を呼び、出力の行を返す（最後の改行の後の空の要素は落とす）。 */
function readValues(path: string, keys: string[]) {
  const res = spawnSync(
    "bash",
    ["-c", '. "$1"; shift; kaizen_frontmatter_values "$@"', "_", lib, path, ...keys],
    { encoding: "utf8", timeout: CHILD_TIMEOUT_MS, env: { ...process.env, ...coverageEnv() } },
  );
  expect(res.status, res.stderr).toBe(0);
  return res.stdout.split("\n").slice(0, -1);
}

function readNote(content: string, keys: string[]) {
  const dir = project(content);
  return readValues(join(dir, ".kaizen", NOTE_NAME), keys);
}

test.each([
  [
    "指定したキーの順に返す",
    "---\ndate: 2026-10-21\ntype: doc\nstatus: pending\n---\n",
    ["status", "date", "type"],
    ["pending", "2026-10-21", "doc"],
  ],
  [
    "無い欄は空行",
    "---\nstatus: pending\n---\n",
    ["priority", "status", "confidence"],
    ["", "pending", ""],
  ],
  [
    // 後ろに別のキーを置く。すべてのキーを読んだ時点で終えるので、後ろのキーが無いと最初の値で終わってしまう
    "重なったキーは最初の値",
    "---\nstatus: pending\nstatus: applied\ntype: doc\n---\n",
    ["status", "type"],
    ["pending", "doc"],
  ],
  [
    "本文の行は読まない",
    "---\ntype: doc\n---\n\nstatus: applied\n",
    ["status", "type"],
    ["", "doc"],
  ],
  [
    "2 つ目の frontmatter の区切りより後ろは読まない",
    "---\ntype: doc\n---\n---\nstatus: applied\n---\n",
    ["status"],
    [""],
  ],
  ["frontmatter が無い", "status: pending\n", ["status"], [""]],
  ["キーを前方に含む別のキー", "---\nstatuses: pending\n---\n", ["status"], [""]],
  ["前後の空白を落とす", "---\nstatus:    pending  \t\n---\n", ["status"], ["pending"]],
  ["CRLF の改行", "---\r\nstatus: pending\r\n---\r\n", ["status"], ["pending"]],
  ["コロンの後に空白が無い", "---\nstatus:pending\n---\n", ["status"], ["pending"]],
  // 読み方を広げない。次の書き方は、値の一部として読むか、読まない（kaizen-status-check.sh が止める）
  ["行末のコメント", "---\nstatus: pending # メモ\n---\n", ["status"], ["pending # メモ"]],
  ["引用符で囲んだ値", '---\nstatus: "pending"\n---\n', ["status"], ['"pending"']],
  ["引用符で囲んだキー", '---\n"status": pending\n---\n', ["status"], [""]],
  ["コロンの前の空白", "---\nstatus : pending\n---\n", ["status"], [""]],
  ["明示的なキー", "---\n? status\n: pending\n---\n", ["status"], [""]],
])("共通の関数が欄を読む: %s", (_name, content, keys, expected) => {
  expect(readNote(content, keys)).toStrictEqual(expected);
});

// キーのつなぎ方を、呼び出し側の IFS で変えない（IFS が , のままだと、すべての欄が空で返る）。
test("呼び出し側の IFS に関わらず、指定したキーを読む", () => {
  const dir = project("---\nstatus: pending\ntype: doc\n---\n");
  const res = spawnSync(
    "bash",
    [
      "-c",
      '. "$1"; IFS=,; kaizen_frontmatter_values "$2" status type',
      "_",
      lib,
      join(dir, ".kaizen", NOTE_NAME),
    ],
    { encoding: "utf8", timeout: CHILD_TIMEOUT_MS, env: { ...process.env, ...coverageEnv() } },
  );
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toBe("pending\ndoc\n");
});

// 共通ライブラリを読めないとき、注入は何も出さず、そのことを本番の構成と区別できる 1 行で stderr に出す。
test("共通ライブラリを読めないとき、注入は学びを出さず、注入しないことを stderr に出す", () => {
  const dir = project("---\nstatus: pending\n---\n\n## 提案\n\n要約\n");
  const solo = join(dir, "solo");
  mkdirSync(solo);
  copyFileSync(
    join(scriptsDir, "kaizen-context-inject.sh"),
    join(solo, "kaizen-context-inject.sh"),
  );
  const res = spawnSync("bash", [join(solo, "kaizen-context-inject.sh")], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...coverageEnv() },
    encoding: "utf8",
    input: "",
  });
  expect(res.status).toBe(0);
  expect(res.stdout).toBe("");
  expect(res.stderr).toContain(
    "kaizen-context-inject.sh: 学びの status を読めないため、学びを注入しません",
  );
});

test("読めないファイルは、エラーにせず空の出力を返す", () => {
  const dir = makeTempDir("kaizen-fm-");
  workdirs.push(dir);
  expect(readValues(join(dir, "missing.md"), ["status"])).toStrictEqual([]);
});

// kaizen-status-check.sh が通す書き方は、共通の関数が意図した値として読む。
// 書き方の表は YAML の文法から挙げ、通す書き方の集合（値の後の空白を除けば `key: value` だけ）も固定する。
// 通す書き方が広がったのに読み方が追いつかないと、同じノートをスクリプトごとに別の値として読む。
type Key = "status" | "type" | "priority" | "date";
const KEYS: Key[] = ["status", "type", "priority", "date"];
const CANONICAL: Record<Key, string> = {
  status: "pending",
  type: "doc",
  priority: "high",
  date: "2026-10-21",
};

const FORMS: [string, (k: string, v: string) => string, boolean][] = [
  ["key: value", (k, v) => `${k}: ${v}`, true],
  ["値の後の空白", (k, v) => `${k}: ${v}   `, true],
  ["行末のコメント", (k, v) => `${k}: ${v} # メモ`, false],
  ["二重引用符で囲んだ値", (k, v) => `${k}: "${v}"`, false],
  ["単引用符で囲んだ値", (k, v) => `${k}: '${v}'`, false],
  ["二重引用符で囲んだキー", (k, v) => `"${k}": ${v}`, false],
  ["単引用符で囲んだキー", (k, v) => `'${k}': ${v}`, false],
  ["コロンの前の空白", (k, v) => `${k} : ${v}`, false],
  ["コロンの後に空白が無い", (k, v) => `${k}:${v}`, false],
  ["キーのアンカー", (k, v) => `&a ${k}: ${v}`, false],
  ["キーのタグ", (k, v) => `!!str ${k}: ${v}`, false],
  ["値のタグ", (k, v) => `${k}: !!str ${v}`, false],
  ["値のアンカー", (k, v) => `${k}: &x ${v}`, false],
  ["ブロックスカラー", (k, v) => `${k}: >-\n  ${v}`, false],
  ["明示的なキー", (k, v) => `? ${k}\n: ${v}`, false],
  ["重なったキー", (k, v) => `${k}: ${v}\n${k}: ${v}`, false],
];

function baseNote(key: Key, line: string) {
  const lines = KEYS.map((k) => (k === key ? line : `${k}: ${CANONICAL[k]}`));
  return `---\n${lines.join("\n")}\napplied-to: []\n---\n\n## 提案\n\n要約\n`;
}

function statusCheck(dir: string) {
  return spawnSync("bash", [join(scriptsDir, "kaizen-status-check.sh")], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...coverageEnv() },
    encoding: "utf8",
  });
}

const AGREEMENT_CASES = KEYS.flatMap((key) =>
  FORMS.map(([form, make, accepted]) => [key, form, make, accepted] as const),
);

test.each(AGREEMENT_CASES)(
  "status-check が通す書き方は、共通の関数が同じ値として読む: %s の %s",
  (key, _form, make, accepted) => {
    const dir = project(baseNote(key, make(key, CANONICAL[key])));
    const check = statusCheck(dir);
    expect(check.status, check.stderr).toBe(accepted ? 0 : 2);
    if (accepted) {
      expect(readValues(join(dir, ".kaizen", NOTE_NAME), [key])).toStrictEqual([CANONICAL[key]]);
    }
  },
);

// 受け入れ条件の 2 つ目。status-check が止め、どのスクリプトも pending として扱わない。
// 忘却の候補になる条件（古い日付・低い priority）と、KEDB 照合で一致する語をそろえる。
const AMBIGUOUS_STATUS = [
  ["行末のコメント", "status: pending # メモ"],
  ["二重引用符で囲んだ値", 'status: "pending"'],
] as const;

function ambiguousNote(statusLine: string) {
  return `---\ndate: 2025-01-01\ntype: doc\npriority: low\n${statusLine}\napplied-to: []\n---\n\n## 提案\n\nalpha と beta の学び\n`;
}

function run(dir: string, script: string, args: string[] = []) {
  return spawnSync("bash", [join(scriptsDir, script), ...args], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: dir,
    env: kaizenEnv(dir, { CLAUDE_PROJECT_DIR: dir, LC_ALL: "C.UTF-8", ...coverageEnv() }),
    encoding: "utf8",
    input: "",
  });
}

test.each(AMBIGUOUS_STATUS)(
  "pending と読めない status は、status-check が止め、どのスクリプトも pending として扱わない: %s",
  (_name, statusLine) => {
    const dir = project(ambiguousNote(statusLine));

    const check = statusCheck(dir);
    expect(check.stderr).toContain("status is not a plain word");
    expect(check.status).toBe(2);

    const inject = run(dir, "kaizen-context-inject.sh");
    expect(inject.status, inject.stderr).toBe(0);
    expect(inject.stdout).not.toContain(NOTE_NAME);

    const forget = run(dir, "kaizen-forget.sh", ["--list"]);
    expect(forget.status, forget.stderr).toBe(0);
    expect(forget.stdout).not.toContain(NOTE_NAME);

    const report = run(dir, "kaizen-schedule-report.sh", ["config"]);
    expect(report.status, report.stderr).toBe(0);
    expect(report.stdout).toContain("pending_count=0\n");

    const kedb = run(dir, "kaizen-kedb-match.sh", ["alpha", "beta"]);
    expect(kedb.status, kedb.stderr).toBe(0);
    expect(kedb.stdout).toContain(NOTE_NAME);
    expect(kedb.stdout).not.toContain("status=pending\n");
  },
);

// 誤検知しないことの確認。同じノートを `status: pending` で書くと、どのスクリプトも pending として扱う。
test("status: pending のノートは、どのスクリプトも pending として扱う（対照）", () => {
  const dir = project(ambiguousNote("status: pending"));

  const check = statusCheck(dir);
  expect(check.stderr).toBe("");
  expect(check.status).toBe(0);

  expect(run(dir, "kaizen-context-inject.sh").stdout).toContain(NOTE_NAME);
  expect(run(dir, "kaizen-forget.sh", ["--list"]).stdout).toContain(NOTE_NAME);
  expect(run(dir, "kaizen-schedule-report.sh", ["config"]).stdout).toContain("pending_count=1\n");
  expect(run(dir, "kaizen-kedb-match.sh", ["alpha", "beta"]).stdout).toContain("status=pending\n");
});

// 読み方が 1 か所にしか無いことを、同梱のスクリプトのソースで確かめる。
// frontmatter の欄を読むスクリプトが、共通の関数を呼ばずに自分の awk で読むと、読み方がまたずれる。
const READERS = [
  "kaizen-context-inject.sh",
  "kaizen-forget.sh",
  "kaizen-schedule-report.sh",
  "kaizen-kedb-match.sh",
];

test.each(READERS)(
  "実リポジトリの %s は、共通の関数で frontmatter を読み、自分の読み取りの関数を持たない",
  (name) => {
    const source = readFileSync(join(scriptsDir, name), "utf8");
    expect(source).toContain("kaizen_frontmatter_values ");
    // キーを引数に取る awk（`awk -v key=`）と、frontmatter_ で始まる関数は、読み取りの関数の形である。
    // kaizen-forget.sh が status の行を書き換える awk（`fm == 1 && index($0, "status:") == 1`）は書く側なので、ここでは数えない。
    expect(source).not.toMatch(/awk -v key=/);
    expect(source).not.toMatch(/^frontmatter_\w+\(\)/m);
  },
);

test("実リポジトリの共通ライブラリは、frontmatter を読む関数を 1 つだけ定義する", () => {
  const source = readFileSync(lib, "utf8");
  expect(source.match(/^kaizen_frontmatter_values\(\)/gm)).toHaveLength(1);
});
