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
    // 設定を読めたときは、読めないときの 1 行を出さない。
    expect(stdout).not.toContain("kaizen の設定を読めないので");
  });

  test("上限が件数より小さければ、並びの先頭から上限まで出し、省いた件数を priority ごとに示す", () => {
    const { stdout } = run(repoWith('{ "inject_max_entries": 3 }\n'));
    expect(injected(stdout)).toEqual(ordered.slice(0, 3));
    expect(stdout).toContain("## kaizen: 未適用の学び（5 件のうち 3 件）\n");
    expect(stdout).toContain(
      "ほか 2 件（medium 1 件・low 1 件）は、設定の inject_max_entries（3。読んだ層: repo）を超えたので省いた。",
    );
    expect(stdout).not.toContain("kaizen の設定を読めないので");
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
    expect(stdout).toContain("設定の inject_max_entries（2。読んだ層: local）");
  });

  // 設定を読めないときの 1 行。理由も同じ行に入れる（exit 0 の SessionStart の stderr は、エージェントの文脈に入らない）。
  const NOTE =
    "kaizen の設定を読めないので、inject_max_entries を設定していても件数の上限を当てずに全件を出す。理由: ";
  function noteLine(stdout: string) {
    return stdout.split("\n").find((l) => l.startsWith(NOTE)) ?? "";
  }

  test.each([
    ["0", '{ "inject_max_entries": 0 }\n', "inject_max_entries"],
    ["文字列", '{ "inject_max_entries": "20" }\n', "inject_max_entries"],
    // 上限と関係の無いキーの誤りでも、設定を読めないので同じ 1 行を出し、原因のキーを理由に書く。
    [
      "別のキーの誤り",
      '{ "inject_max_entries": 2, "forget_after_days": "x" }\n',
      "forget_after_days",
    ],
  ])(
    "設定が不正（%s）なら、上限を当てずに全件を出し、当てなかったことと理由を 1 行で示す",
    (_name, config, key) => {
      const { stdout } = run(repoWith(config));
      expect(injected(stdout)).toEqual(ordered);
      expect(noteLine(stdout)).toContain(key);
      expect(stdout).not.toContain("ほか ");
    },
  );

  test("設定ファイルがあって node が無ければ、上限を当てずに全件を出し、当てなかったことと理由を 1 行で示す", () => {
    const dir = repoWith('{ "inject_max_entries": 2 }\n');
    const { stdout } = run(dir, {
      PATH: pathWithout(dir, ["node"], process.env.PATH ?? ""),
    });
    expect(injected(stdout)).toEqual(ordered);
    expect(noteLine(stdout)).toContain("node が要る");
  });

  test("人ごとの層に置いた上限も当てる", () => {
    const dir = repoWith();
    const userDir = join(dir, ".test-xdg", "skills", "shoji9x9");
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, "kaizen.jsonc"), '{ "inject_max_entries": 4 }\n');
    const { stdout } = run(dir);
    expect(injected(stdout)).toEqual(ordered.slice(0, 4));
    expect(stdout).toContain(
      "ほか 1 件（low 1 件）は、設定の inject_max_entries（4。読んだ層: user）",
    );
  });

  // 索引はタブ区切りで、パスは最後の列にある。ファイル名にタブを含んでも、パスを途中で切らない。
  test("ファイル名にタブを含む学びも、パスを切らずに出す", () => {
    const dir = repoWith('{ "inject_max_entries": 1 }\n');
    writeFileSync(
      join(dir, ".kaizen", "a\tb.md"),
      "---\ndate: 2026-08-01\ntype: rule\npriority: high\nstatus: pending\n---\n\n## 提案\n\ntab\n",
    );
    const { stdout } = run(dir);
    expect(injected(stdout)).toEqual(["a\tb"]);
    expect(stdout).toContain("ほか 5 件（high 2 件・medium 2 件・low 1 件）");
  });

  test("ファイル名にタブを含む学びが省く側に入っても、priority ごとの件数に数える", () => {
    const dir = repoWith('{ "inject_max_entries": 2 }\n');
    writeFileSync(
      join(dir, ".kaizen", "z\tlow.md"),
      "---\ndate: 2026-09-09\ntype: rule\npriority: low\nstatus: pending\n---\n\n## 提案\n\ntab\n",
    );
    const { stdout } = run(dir);
    expect(injected(stdout)).toEqual(ordered.slice(0, 2));
    expect(stdout).toContain("ほか 4 件（medium 2 件・low 2 件）");
  });

  // 索引にはパスを入れず、配列の添字を入れる。パスがタブや改行を含んでも、索引の列はずれない。
  test("ファイル名に改行を含む学びも、改行を \\n と書いて 1 行に出し、並びどおりに件数に数える", () => {
    const dir = repoWith('{ "inject_max_entries": 2 }\n');
    // 改行の後ろに見出しを置き、別の行として出ないことを確かめる。
    const name = "n\n## 偽の見出し\nx[$(touch pwned)]\t9\tz";
    writeFileSync(
      join(dir, ".kaizen", `${name}.md`),
      "---\ndate: 2026-08-01\ntype: rule\npriority: high\nstatus: pending\n---\n\n## 提案\n\nnl\n",
    );
    const { stdout } = run(dir);
    // 日付がいちばん古い high なので先頭に出る。改行は \n と書かれる。
    const first = stdout.split("\n").find((l) => l.startsWith("- `"));
    expect(first).toBe(
      `- \`.kaizen/${name.replaceAll("\n", "\\n")}.md\` — date: 2026-08-01 type: rule priority: high confidence: unknown — nl`,
    );
    expect(stdout).not.toMatch(/^## 偽の見出し/m);
    expect(injected(stdout).at(-1)).toBe("b-high-old");
    expect(stdout).toContain("## kaizen: 未適用の学び（6 件のうち 2 件）");
    expect(stdout).toContain("ほか 4 件（high 1 件・medium 2 件・low 1 件）");
    expect(existsSync(join(dir, "pwned"))).toBe(false);
  });

  // 表示から元のパスを一意に戻せるように、\ も書き分ける。
  test("改行を含むファイル名と、\\ と n をそのまま含むファイル名を、表示で区別する", () => {
    const dir = repoWith('{ "inject_max_entries": 2 }\n');
    const note =
      "---\ndate: 2026-08-01\ntype: rule\npriority: high\nstatus: pending\n---\n\n## 提案\n\nx\n";
    writeFileSync(join(dir, ".kaizen", "a\nb.md"), note);
    writeFileSync(join(dir, ".kaizen", "a\\nb.md"), note);
    const { stdout } = run(dir);
    const lines = stdout.split("\n").filter((l) => l.startsWith("- `"));
    expect(lines.map((l) => l.split("` — ")[0])).toEqual([
      "- `.kaizen/a\\nb.md",
      "- `.kaizen/a\\\\nb.md",
    ]);
  });

  // printf %q はロケールが C だと日本語をバイトごとの 8 進で書く。書き分けはロケールに依存しない。
  test("ロケールが C でも、日本語を含むパスをそのまま出し、改行だけを \\n と書く", () => {
    const dir = repoWith('{ "inject_max_entries": 1 }\n');
    writeFileSync(
      join(dir, ".kaizen", "日本\nx.md"),
      "---\ndate: 2026-08-01\ntype: rule\npriority: high\nstatus: pending\n---\n\n## 提案\n\nx\n",
    );
    const { stdout } = run(dir, { LC_ALL: "C" });
    expect(stdout).toContain("- `.kaizen/日本\\nx.md` — ");
  });

  test("date にタブを含む学びも、パスを切らずに出し、日付の無い学びと同じく同じ priority の最後に置く", () => {
    const dir = repoWith();
    writeFileSync(
      join(dir, ".kaizen", "t-high-tabdate.md"),
      "---\ndate: 2026-08-01\tx\ntype: rule\npriority: high\nstatus: pending\n---\n\n## 提案\n\ntab\n",
    );
    const { stdout } = run(dir);
    expect(injected(stdout)).toEqual([
      "b-high-old",
      "a-high-new",
      "t-high-tabdate",
      ...ordered.slice(2),
    ]);
  });

  test.each([
    ["月の日数を超える日付", "2026-02-30"],
    ["引用符で囲んだ日付", '"2026-07-01"'],
    // 形は YYYY-MM-DD なので、形だけを見る判定では最も古い日付として先頭に並ぶ。
    ["暦に無い日付", "2026-00-01"],
  ])("date が暦の日付として読めない（%s）学びは、同じ priority の最後に置く", (_name, date) => {
    const dir = repoWith();
    writeFileSync(
      join(dir, ".kaizen", "t-high-baddate.md"),
      `---\ndate: ${date}\ntype: rule\npriority: high\nstatus: pending\n---\n\n## 提案\n\nbad\n`,
    );
    const { stdout } = run(dir);
    expect(injected(stdout).slice(0, 3)).toEqual(["b-high-old", "a-high-new", "t-high-baddate"]);
  });

  test("priority が無い学びは並びの最後に置き、省いたときは不明として数える", () => {
    const dir = repoWith('{ "inject_max_entries": 4 }\n');
    writeFileSync(
      join(dir, ".kaizen", "f-unknown.md"),
      "---\ndate: 2026-08-01\ntype: rule\nstatus: pending\n---\n\n## 提案\n\nf-unknown\n",
    );
    const { stdout } = run(dir);
    expect(injected(stdout)).toEqual(ordered.slice(0, 4));
    expect(stdout).toContain("ほか 2 件（low 1 件・不明 1 件）");
  });
});

// 既存の規約や指示と食い違い、利用者がどちらを残すかを決めていない学び（## 食い違い の 判断 が 判断待ち）は、
// 要約をそのまま出すと従う対象に見えるので、印を付けて出す（Issue #930。references/extract.md「食い違いの確認」）。
describe("食い違いの判断待ち", () => {
  const MARK = "判断待ち（既存の規約や指示と食い違う。利用者が決めるまで、この提案に従わない）: ";
  const conflict = (judgement: string) =>
    `## 食い違い\n\n- 相手: AGENTS.md「依存の管理」\n- 内容: 範囲で足すか、固定するか\n- 判断: ${judgement}\n\n`;

  function summaryWithBody(body: string) {
    const dir = createRepo("依存は範囲で足す。");
    const note = join(dir, ".kaizen", "2026-09-01-note.md");
    writeFileSync(note, readFileSync(note, "utf8").replace("## 提案", `${body}## 提案`));
    return summaryOf(inject(dir));
  }

  test.each([
    ["判断待ち", conflict("判断待ち")],
    ["引用符で囲んだ判断待ち", conflict("`判断待ち`")],
    ["行末に空白と CR がある", conflict("判断待ち  \r")],
    [
      "相手が複数あり、2 つ目の組だけが判断待ち",
      "## 食い違い\n\n- 相手: なし\n- 判断: なし\n- 相手: .kaizen/other.md\n- 判断: 判断待ち\n\n",
    ],
    [
      "4 つのバッククォートのフェンスが、中に ``` の行を持って閉じた後にある",
      `\`\`\`\`markdown\n\`\`\`\n\`\`\`\`\n\n${conflict("判断待ち")}`,
    ],
    ["字下げした閉じる行でフェンスが閉じた後にある", `~~~\nx\n   ~~~\n\n${conflict("判断待ち")}`],
    [
      "開いた行より長い閉じる行でフェンスが閉じた後にある",
      `\`\`\`\nx\n\`\`\`\`\n\n${conflict("判断待ち")}`,
    ],
    [
      "行頭のコードスパン（後ろにもバッククォートがある行）の後にある",
      `\`\`\`ts\`\`\` のように書く。\n\n${conflict("判断待ち")}`,
    ],
  ])("印を付ける: %s", (_name, body) => {
    expect(summaryWithBody(body)).toBe(`${MARK}依存は範囲で足す。`);
  });

  test.each([
    ["節が無い", ""],
    ["判断が なし", conflict("なし")],
    ["判断を利用者が決めた（新しい学び）", conflict("新しい学び")],
    ["判断待ちの行が別の節にある", "## 根拠\n\n- 判断: 判断待ち\n\n"],
    ["見出しが前方一致するだけの別の節", "## 食い違いの経緯\n\n- 判断: 判断待ち\n\n"],
    ["判断待ちを前方に含む別の値", conflict("判断待ちだったが、新しい学びに決めた")],
    ["コードフェンスの中にある", `\`\`\`markdown\n${conflict("判断待ち")}\`\`\`\n\n`],
    [
      "4 つのバッククォートのフェンスの中で、``` の行の後にある",
      `\`\`\`\`markdown\n\`\`\`\n${conflict("判断待ち")}\`\`\`\n\`\`\`\`\n\n`,
    ],
    [
      "``` のフェンスの中で、~~~ の行の後にある",
      `\`\`\`\n~~~\n${conflict("判断待ち")}~~~\n\`\`\`\n\n`,
    ],
    [
      "``` のフェンスの中で、情報文字列付きの ``` の行の後にある",
      `\`\`\`\n\`\`\`js\n${conflict("判断待ち")}\`\`\`\n\n`,
    ],
    ["3 文字まで字下げしたフェンスの中にある", `   \`\`\`\n${conflict("判断待ち")}   \`\`\`\n\n`],
  ])("印を付けない: %s", (_name, body) => {
    expect(summaryWithBody(body)).toBe("依存は範囲で足す。");
  });

  test("長い要約を切り詰めても、印は欠けない", () => {
    const dir = createRepo("あ".repeat(200));
    const note = join(dir, ".kaizen", "2026-09-01-note.md");
    writeFileSync(
      note,
      readFileSync(note, "utf8").replace("## 提案", `${conflict("判断待ち")}## 提案`),
    );
    expect(summaryOf(inject(dir))).toBe(`${MARK}${"あ".repeat(119)}…`);
  });

  test("ノートを読めないときは、判断待ちとして扱い、理由を stderr に出す", () => {
    const lib = join(repoRoot, "skills/kaizen/scripts/kaizen-hook-common.sh");
    // ディレクトリを渡す。gawk はディレクトリを警告だけで読み飛ばすので、awk の終了コードでは読めないことを判定できない。
    const missing = makeTempDir("kaizen-pending-");
    const res = spawnSync(
      "bash",
      ["-c", '. "$1"; kaizen_has_pending_decision "$2"', "_", lib, missing],
      {
        encoding: "utf8",
        timeout: CHILD_TIMEOUT_MS,
      },
    );
    expect(res.status, res.stderr).toBe(0);
    expect(res.stderr).toContain(
      `kaizen: 食い違いの判断を読めないため、判断待ちとして扱う（通常のファイルとして読めない）: ${missing}`,
    );
  });

  test("awk が 0・1 以外で終わったときは、判断待ちとして扱い、awk の stderr を添える", () => {
    const lib = join(repoRoot, "skills/kaizen/scripts/kaizen-hook-common.sh");
    const dir = createRepo("依存は範囲で足す。");
    const note = join(dir, ".kaizen", "2026-09-01-note.md");
    // 読める通常のファイルを渡し、PATH の先頭に終了コード 2 で終わる偽の awk を置く。
    const fakeBin = makeTempDir("kaizen-fake-awk-");
    writeFileSync(join(fakeBin, "awk"), "#!/bin/sh\necho 'fake awk failed' >&2\nexit 2\n", {
      mode: 0o755,
    });
    const res = spawnSync(
      "bash",
      ["-c", '. "$1"; PATH="$3:$PATH" kaizen_has_pending_decision "$2"', "_", lib, note, fakeBin],
      { encoding: "utf8", timeout: CHILD_TIMEOUT_MS },
    );
    expect(res.status, res.stderr).toBe(0);
    expect(res.stderr).toContain("（awk の終了コード 2: fake awk failed）");
  });
});
