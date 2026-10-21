import { afterEach, assert, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "skills/kaizen/scripts/kaizen-context-inject.sh");
const workdirs: string[] = [];

afterEach(() => {
  for (const dir of workdirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createRepo(summary: string) {
  const dir = makeTempDir("kaizen-context-inject-");
  workdirs.push(dir);
  mkdirSync(join(dir, ".kaizen"));
  const init = spawnSync("git", ["init", "-q", "."], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: dir,
    encoding: "utf8",
  });
  expect(init.status, init.stderr).toBe(0);
  writeFileSync(
    join(dir, ".kaizen", "2026-09-01-note.md"),
    `---\ndate: 2026-09-01\ntype: rule\npriority: high\nstatus: pending\n---\n\n# note\n\n## 提案\n\n${summary}\n`,
  );
  return dir;
}

// stdout は Buffer で受ける。encoding: "utf8" だと不正なバイト列も U+FFFD へ置換されてしまい、
// 「文字の途中で切れた」ことを検出できなくなる（この回帰テストで区別できなくなる）。
function inject(dir: string, locale = "C.UTF-8") {
  const result = spawnSync("bash", [script], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, LANG: locale, LC_ALL: locale },
    input: "",
  });
  expect(result.status, String(result.stderr)).toBe(0);
  return result.stdout;
}

// 注入行から要約部分（2 つ目の em dash 以降）だけを取り出す。
function summaryOf(stdout: Buffer) {
  const line = stdout
    .toString("utf8")
    .split("\n")
    .find((l) => l.startsWith("- `.kaizen/"));
  assert(line, stdout.toString("utf8"));
  return line.split(" — ").slice(2).join(" — ");
}

// 注入行の meta 部分（1 つ目と 2 つ目の em dash の間）を取り出す。
function metaOf(stdout: Buffer) {
  const line = stdout
    .toString("utf8")
    .split("\n")
    .find((l) => l.startsWith("- `.kaizen/"));
  assert(line, stdout.toString("utf8"));
  return line.split(" — ")[1] ?? "";
}

// 確信度の低い学びを、高い学びと同じ見え方で注入しない（Issue #727）。
// 欄が無い学びは、欄を足す前に書いたもので、確信度が分からないものとして unknown と出す。
test.each([
  ["high", "confidence: high\n", "confidence: high"],
  ["low", "confidence: low\n", "confidence: low"],
  ["欄が無い", "", "confidence: unknown"],
  ["値が空", "confidence:\n", "confidence: unknown"],
  // kaizen-status-check.sh が受け付ける書き方は、同じ値として出す
  ["引用符で囲んだキー", '"confidence": low\n', "confidence: low"],
  ["単引用符で囲んだキー", "'confidence': low\n", "confidence: low"],
  ["キーとコロンの間の空白", "confidence : low\n", "confidence: low"],
  ["行末のコメント", "confidence: low # 1 回の観測\n", "confidence: low"],
  ["引用符で囲んだ値", "confidence: 'medium'\n", "confidence: medium"],
  ["YAML の null", "confidence: null\n", "confidence: unknown"],
  ["YAML の ~", "confidence: ~\n", "confidence: unknown"],
])("注入の行に確信度を出す: %s", (_name, line, expected) => {
  const dir = createRepo("要約");
  const path = join(dir, ".kaizen", "2026-09-01-note.md");
  writeFileSync(
    path,
    readFileSync(path, "utf8").replace("status: pending\n", `status: pending\n${line}`),
  );
  const meta = metaOf(inject(dir));
  expect(meta).toBe(`date: 2026-09-01 type: rule priority: high ${expected}`);
});

// status・type・priority も confidence と同じ読み方で読む。行末のコメントがある pending の学びを、注入から外さない。
test("行末のコメントがある欄も、コメントを除いた値で読む", () => {
  const dir = createRepo("要約");
  const path = join(dir, ".kaizen", "2026-09-01-note.md");
  writeFileSync(
    path,
    readFileSync(path, "utf8")
      .replace("status: pending\n", "status: pending # メモ\n")
      .replace("type: rule\n", "type: rule # メモ\n")
      .replace("priority: high\n", "priority: 'high'\n"),
  );
  expect(metaOf(inject(dir))).toBe(
    "date: 2026-09-01 type: rule priority: high confidence: unknown",
  );
});

test("キーを前方に含む別のキーは読まない", () => {
  const dir = createRepo("要約");
  const path = join(dir, ".kaizen", "2026-09-01-note.md");
  writeFileSync(path, readFileSync(path, "utf8").replace("type: rule\n", "types: x\ntype: rule\n"));
  expect(metaOf(inject(dir))).toBe(
    "date: 2026-09-01 type: rule priority: high confidence: unknown",
  );
});

function isValidUtf8(buffer: Buffer) {
  return Buffer.from(buffer.toString("utf8"), "utf8").equals(buffer);
}

test("マルチバイトの長い要約をバイト境界で割らずに切り詰める", () => {
  // 先頭 2 バイトの ASCII に日本語が続くと 120 バイト目が 3 バイト文字の途中になる。
  const summary = `**${"あ".repeat(150)}`;
  const stdout = inject(createRepo(summary));

  expect(isValidUtf8(stdout), stdout.toString("latin1")).toBe(true);
  const truncated = summaryOf(stdout);
  expect([...truncated]).toHaveLength(120);
  expect(truncated.endsWith("…")).toBe(true);
  expect(truncated.startsWith(`**${"あ".repeat(10)}`)).toBe(true);
});

test("120 文字以内の要約は切り詰めない", () => {
  const summary = "あ".repeat(120);
  const truncated = summaryOf(inject(createRepo(summary)));

  expect(truncated).toBe(summary);
});

test("非 UTF-8 ロケールでは切り詰めずに要約を保つ", () => {
  // C ロケールではパラメータ展開もバイト単位になるため、切り詰め自体を行わない（安全な側として扱う）。
  const summary = "あ".repeat(150);
  const stdout = inject(createRepo(summary), "C");

  expect(isValidUtf8(stdout), stdout.toString("latin1")).toBe(true);
  expect(summaryOf(stdout)).toBe(summary);
});

// `pipefail` の下でパイプラインの終了コードを**真偽値として読む**形は、読み手（`grep -q` /
// `head`）が一致した時点で抜けたときに書き手が SIGPIPE で死に、パイプライン全体が非 0 になる。
// その結果、**一致しているのに「一致しなかった」と読む**（Issue #343）。発火は書き手の出力の形に依る
// 確率的な事象なので実行では固定できない。形そのものを固定する。
// `||`（論理和）や `head=` のような変数代入に当たらないよう、単一の `|` と command 位置だけを見る。
const PIPED_TRUTH_READ = /(?<!\|)\|(?!\|)\s*(grep\s+(?:-\S+\s+)*-\S*q\S*|head(?=\s|$))/;

test("kaizen のスクリプトはパイプラインの真偽を読まない（herestring で渡す）", () => {
  const scriptsDir = join(repoRoot, "skills", "kaizen", "scripts");
  const offenders: string[] = [];
  for (const name of readdirSync(scriptsDir)) {
    if (!name.endsWith(".sh")) continue;
    const lines = readFileSync(join(scriptsDir, name), "utf8").split("\n");
    lines.forEach((line, i) => {
      // コメント行は対象外（この注意点を説明している注記がある）。
      if (/^\s*#/.test(line)) return;
      if (PIPED_TRUTH_READ.test(line)) {
        offenders.push(`${name}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  expect(offenders).toEqual([]);
});

// 既知の違反の形を置いて、検出の処理が実際に検出することを確かめる。
test.each([
  ["grep -q", `if ! printf '%s' "$x" | grep -Eq 'pat'; then`],
  ["grep -qi", `locale charmap 2>/dev/null | grep -qi 'utf-8'`],
  ["head", `value=$(sed -n '2p' "$f" | head -n 1)`],
])("パイプ越しの真偽読みを検出できる（%s）", (_label, line) => {
  expect(PIPED_TRUTH_READ.test(line)).toBe(true);
});

// 誤検知しないことの確認: 修正後の形（herestring）は検出されない。
test.each([
  [`if ! grep -Eq 'pat' <<<"$x"; then`],
  [`grep -qi 'utf-8' <<<"$(locale charmap 2>/dev/null)"`],
  // `||`（論理和）と `head` という名前の変数代入は対象外。
  ['[ -n "${head}" ] || head=/'],
  ["x=$(cmd) || head=fallback"],
])("herestring 形・非パイプは検出しない（%s）", (line) => {
  expect(PIPED_TRUTH_READ.test(line)).toBe(false);
});
