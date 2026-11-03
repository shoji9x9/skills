import { afterEach, assert, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { kaizenEnv, pathWithout, writeKaizenConfig } from "./kaizen-config-env.ts";

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
  ["キーを前方に含む別のキーだけがある", "confidences: low\n", "confidence: unknown"],
  // 他の欄と同じく、共通ライブラリの kaizen_frontmatter_values の読み方で読む（Issue #744）。
  // 引用符で囲んだキーは読まず、行末のコメントは値の一部として出す。どちらも kaizen-status-check.sh が止める。
  ["引用符で囲んだキー", '"confidence": low\n', "confidence: unknown"],
  ["行末のコメント", "confidence: low # 1 回の観測\n", "confidence: low # 1 回の観測"],
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

function isValidUtf8(buffer: Buffer) {
  return Buffer.from(buffer.toString("utf8"), "utf8").equals(buffer);
}

test("マルチバイトの長い要約をバイト境界で割らずに切り詰める", () => {
  // 先頭 2 バイトの ASCII に日本語が続くと 120 バイト目が 3 バイト文字の途中になる。
  const summary = `**${"あ".repeat(150)}`;
  const stdout = inject(createRepo(summary));

  expect(isValidUtf8(stdout), stdout.toString("latin1")).toBe(true);
  const truncated = summaryOf(stdout);
  expect(Array.from(truncated)).toHaveLength(120);
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

// Copilot CLI は `.claude/settings.json` の SessionStart と `.github/hooks/` の sessionStart の両方を実行する（Issue #858）。
// `.claude/settings.json` の登録として呼ばれたら、マーカーを消さず、学びも出さずに終える。Copilot の処理は `.github/hooks/` の登録が行う。
// 入力の形は Copilot CLI 1.0.105 で記録したものに合わせる。PascalCase の登録だけが hook_event_name を持ち、timestamp は文字列になる。
describe("Copilot が呼んだとき", () => {
  function injectWith(dir: string, payload: Record<string, unknown>, copilotCli: string) {
    const result = spawnSync("bash", [script], {
      timeout: CHILD_TIMEOUT_MS,
      cwd: dir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, COPILOT_CLI: copilotCli },
      input: JSON.stringify({ cwd: dir, ...payload }),
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  }
  // key を持たない共有マーカー。通常の起動はこれを必ず消すので、何もせずに終えたかを区別できる。
  function withSharedMarker() {
    const dir = createRepo("要約");
    const marker = join(dir, ".kaizen", ".extract-done");
    writeFileSync(marker, "");
    return { dir, marker };
  }
  const pascal = {
    hook_event_name: "SessionStart",
    session_id: "cp-1",
    timestamp: "2026-11-02T11:47:38.429Z",
    source: "new",
  };
  const camel = { sessionId: "cp-1", timestamp: 1793620058429, source: "new" };

  test(".claude/settings.json の登録（PascalCase）なら、マーカーを消さず、何も出さずに exit 0", () => {
    const { dir, marker } = withSharedMarker();
    expect(injectWith(dir, pascal, "1")).toBe("");
    expect(existsSync(marker)).toBe(true);
  });

  test.each([
    [".github/hooks の登録（camelCase。hook_event_name が無い）", camel, "1"],
    ["COPILOT_CLI が空（Claude Code が呼んだ）", pascal, ""],
    [
      "timestamp が無い（Copilot のシェルから起動した Claude Code）",
      { hook_event_name: "SessionStart", session_id: "cc-1", source: "startup" },
      "1",
    ],
  ])("%s なら、マーカーを消して学びを出す", (_name, payload, copilotCli) => {
    const { dir, marker } = withSharedMarker();
    expect(injectWith(dir, payload, copilotCli)).toContain("## kaizen: 未適用の学び");
    expect(existsSync(marker)).toBe(false);
  });
});

// 注入する件数の上限（設定の inject_max_entries。Issue #867）。
// 状態の軸は、キーの有無・上限と件数の大小（小さい・等しい・大きい）・設定を読めるか（不正な値・node が無い）・置いた層である。
// 並びは priority の降順、同じ priority は日付の昇順なので、上限で省かれるのは低い priority と新しい学びになる。
describe("注入する件数の上限", () => {
  // high 2 件・medium 2 件・low 1 件。ファイル名の順と並びの順をずらし、並べ替えた後の先頭から取ることを区別する。
  const notes: [string, string, string][] = [
    ["a-high-new", "2026-09-03", "high"],
    ["b-high-old", "2026-09-01", "high"],
    ["c-medium-old", "2026-09-02", "medium"],
    ["d-low", "2026-09-05", "low"],
    ["e-medium-new", "2026-09-04", "medium"],
  ];
  const ordered = ["b-high-old", "a-high-new", "c-medium-old", "e-medium-new", "d-low"];

  function repoWith(config?: string) {
    const dir = makeTempDir("kaizen-context-inject-limit-");
    workdirs.push(dir);
    mkdirSync(join(dir, ".kaizen"));
    const init = spawnSync("git", ["init", "-q", "."], {
      timeout: CHILD_TIMEOUT_MS,
      cwd: dir,
      encoding: "utf8",
    });
    expect(init.status, init.stderr).toBe(0);
    for (const [name, date, priority] of notes) {
      writeFileSync(
        join(dir, ".kaizen", `${name}.md`),
        `---\ndate: ${date}\ntype: rule\npriority: ${priority}\nstatus: pending\n---\n\n## 提案\n\n${name}\n`,
      );
    }
    if (config !== undefined) writeKaizenConfig(dir, config);
    return dir;
  }

  function run(dir: string, extra: Record<string, string | undefined> = {}) {
    const result = spawnSync("bash", [script], {
      timeout: CHILD_TIMEOUT_MS,
      cwd: dir,
      env: kaizenEnv(dir, { CLAUDE_PROJECT_DIR: dir, LC_ALL: "C.UTF-8", ...extra }),
      input: "",
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    return { stdout: result.stdout, stderr: result.stderr };
  }

  function injected(stdout: string) {
    return stdout
      .split("\n")
      .filter((l) => l.startsWith("- `.kaizen/"))
      .map((l) => /^- `\.kaizen\/(.+)\.md`/.exec(l)?.[1]);
  }

  test("キーが無ければ、全件を出し、省いた行を出さない", () => {
    const { stdout } = run(repoWith('{ "forget_after_days": 30 }\n'));
    expect(injected(stdout)).toEqual(ordered);
    expect(stdout).toContain("## kaizen: 未適用の学び（5 件）\n");
    expect(stdout).not.toContain("ほか ");
  });

  test("上限が件数より小さければ、並びの先頭から上限まで出し、省いた件数を priority ごとに示す", () => {
    const { stdout } = run(repoWith('{ "inject_max_entries": 3 }\n'));
    expect(injected(stdout)).toEqual(ordered.slice(0, 3));
    expect(stdout).toContain("## kaizen: 未適用の学び（5 件のうち 3 件）\n");
    expect(stdout).toContain(
      "ほか 2 件（medium 1 件・low 1 件）は、設定の inject_max_entries（3）を超えたので省いた。",
    );
  });

  test("high も省くときは、省いた件数に high を含める", () => {
    const { stdout } = run(repoWith('{ "inject_max_entries": 1 }\n'));
    expect(injected(stdout)).toEqual(["b-high-old"]);
    expect(stdout).toContain("ほか 4 件（high 1 件・medium 2 件・low 1 件）");
  });

  test.each([
    ["件数と等しい", 5],
    ["件数より大きい", 6],
  ])("上限が%sなら、全件を出し、省いた行を出さない", (_name, max) => {
    const { stdout } = run(repoWith(`{ "inject_max_entries": ${max} }\n`));
    expect(injected(stdout)).toEqual(ordered);
    expect(stdout).toContain("## kaizen: 未適用の学び（5 件）\n");
    expect(stdout).not.toContain("ほか ");
  });

  test("人ごと・リポジトリ限定の層に置いた上限も当てる", () => {
    const dir = repoWith();
    const configDir = join(dir, ".config", "skills", "shoji9x9");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "kaizen.local.jsonc"), '{ "inject_max_entries": 2 }\n');
    writeFileSync(join(dir, ".gitignore"), "/.config/skills/shoji9x9/*.local.jsonc\n");
    const { stdout } = run(dir);
    expect(injected(stdout)).toEqual(ordered.slice(0, 2));
  });

  test.each([
    ["0", "0"],
    ["文字列", '"20"'],
  ])(
    "値が不正（%s）なら、上限を当てずに全件を出し、当てなかったことを 1 行で示す",
    (_name, value) => {
      const { stdout, stderr } = run(repoWith(`{ "inject_max_entries": ${value} }\n`));
      expect(injected(stdout)).toEqual(ordered);
      expect(stdout).toContain(
        "kaizen の設定を読めないので、件数の上限（inject_max_entries）を当てずに全件を出す。",
      );
      expect(stdout).not.toContain("ほか ");
      expect(stderr).toContain("inject_max_entries");
    },
  );

  test("設定ファイルがあって node が無ければ、上限を当てずに全件を出し、当てなかったことを 1 行で示す", () => {
    const dir = repoWith('{ "inject_max_entries": 2 }\n');
    const { stdout, stderr } = run(dir, {
      PATH: pathWithout(dir, ["node"], process.env.PATH ?? ""),
    });
    expect(injected(stdout)).toEqual(ordered);
    expect(stdout).toContain(
      "kaizen の設定を読めないので、件数の上限（inject_max_entries）を当てずに全件を出す。",
    );
    expect(stderr).toContain("node が要る");
  });
});
