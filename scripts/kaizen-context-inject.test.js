import { afterEach, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "./lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/kaizen/scripts/kaizen-context-inject.sh");
const workdirs = [];

afterEach(() => {
  for (const dir of workdirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createRepo(summary) {
  const dir = makeTempDir("kaizen-context-inject-");
  workdirs.push(dir);
  mkdirSync(join(dir, ".kaizen"));
  const init = spawnSync("git", ["init", "-q", "."], { cwd: dir, encoding: "utf8" });
  expect(init.status, init.stderr).toBe(0);
  writeFileSync(
    join(dir, ".kaizen", "2026-09-01-note.md"),
    `---\ndate: 2026-09-01\ntype: rule\npriority: high\nstatus: pending\n---\n\n# note\n\n## 提案\n\n${summary}\n`,
  );
  return dir;
}

// stdout は Buffer で受ける。encoding: "utf8" だと壊れたバイト列も U+FFFD へ置換されてしまい、
// 「文字の途中で切れた」ことを検出できなくなる（この回帰テストの弁別力が消える）。
function inject(dir, locale = "C.UTF-8") {
  const result = spawnSync("bash", [script], {
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, LANG: locale, LC_ALL: locale },
    input: "",
  });
  expect(result.status, String(result.stderr)).toBe(0);
  return result.stdout;
}

// 注入行から要約部分（2 つ目の em dash 以降）だけを取り出す。
function summaryOf(stdout) {
  const line = stdout
    .toString("utf8")
    .split("\n")
    .find((l) => l.startsWith("- `.kaizen/"));
  expect(line, stdout.toString("utf8")).toBeTruthy();
  return line.split(" — ").slice(2).join(" — ");
}

function isValidUtf8(buffer) {
  return Buffer.from(buffer.toString("utf8"), "utf8").equals(buffer);
}

test("マルチバイトの長い要約をバイト境界で割らずに切り詰める", () => {
  // 先頭 2 バイトの ASCII に日本語が続くと 120 バイト目が 3 バイト文字の途中に落ちる。
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
  // C ロケールではパラメータ展開もバイト単位になるため、切り詰め自体を行わず安全側へ倒す。
  const summary = "あ".repeat(150);
  const stdout = inject(createRepo(summary), "C");

  expect(isValidUtf8(stdout), stdout.toString("latin1")).toBe(true);
  expect(summaryOf(stdout)).toBe(summary);
});

// `pipefail` の下でパイプラインの終了コードを**真偽値として読む**形は、読み手（`grep -q` /
// `head`）が一致した時点で抜けたときに書き手が SIGPIPE で死に、パイプライン全体が非 0 になる
// ——**一致しているのに「一致しなかった」と読む**（Issue #343）。発火は書き手の出力の形に依る
// 確率的な事象なので実行では固定できない。形そのものを固定する。
// `||`（論理和）や `head=` のような変数代入に当たらないよう、単一の `|` と command 位置だけを見る。
const PIPED_TRUTH_READ = /(?<!\|)\|(?!\|)\s*(grep\s+(?:-\S+\s+)*-\S*q\S*|head(?=\s|$))/;

test("kaizen のスクリプトはパイプラインの真偽を読まない（herestring で渡す）", () => {
  const scriptsDir = join(repoRoot, "skills", "kaizen", "scripts");
  const offenders = [];
  for (const name of readdirSync(scriptsDir)) {
    if (!name.endsWith(".sh")) continue;
    const lines = readFileSync(join(scriptsDir, name), "utf8").split("\n");
    lines.forEach((line, i) => {
      // コメント行は対象外（この落とし穴を説明している注記がある）。
      if (/^\s*#/.test(line)) return;
      if (PIPED_TRUTH_READ.test(line)) {
        offenders.push(`${name}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  expect(offenders).toEqual([]);
});

// 陽性コントロール: 検出器が実際に当たることを、既知の違反形で確かめる。
test.each([
  ["grep -q", `if ! printf '%s' "$x" | grep -Eq 'pat'; then`],
  ["grep -qi", `locale charmap 2>/dev/null | grep -qi 'utf-8'`],
  ["head", `value=$(sed -n '2p' "$f" | head -n 1)`],
])("パイプ越しの真偽読みを検出できる（%s）", (_label, line) => {
  expect(PIPED_TRUTH_READ.test(line)).toBe(true);
});

// 陰性コントロール: 修正後の形（herestring）は検出されない。
test.each([
  [`if ! grep -Eq 'pat' <<<"$x"; then`],
  [`grep -qi 'utf-8' <<<"$(locale charmap 2>/dev/null)"`],
  // `||`（論理和）と `head` という名前の変数代入は対象外。
  ['[ -n "${head}" ] || head=/'],
  ["x=$(cmd) || head=fallback"],
])("herestring 形・非パイプは検出しない（%s）", (line) => {
  expect(PIPED_TRUTH_READ.test(line)).toBe(false);
});
