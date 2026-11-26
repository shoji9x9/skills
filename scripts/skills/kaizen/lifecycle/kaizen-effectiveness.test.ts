import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";
import { kaizenEnv } from "../kaizen-config-env.ts";
import { gitInit } from "../../../lib/testing/repo-file.ts";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";

// kaizen-effectiveness.sh は、適用した学びごとに適用した日・再発の件数・手順の細かさを測り、
// 規約を消すか書き換えるかの候補を挙げる（references/housekeeping.md「適用した学びの効果の測り直し」）。
// 何も変更しないので、誤りは「候補に出ない」「別の学びに数える」の形で出る。どちらも終了コードには現れない。
//
// 状態の軸は次のとおり（各セルに 1 件以上の入力を置く）。
//
// | 軸 | 数える・候補になる | 数えない・候補にならない |
// | --- | --- | --- |
// | 学びの status | applied（.kaizen/ と archive/） | pending・rejected・forgotten |
// | recurrence-of の書き手 | pending・applied・forgotten・archive のノート | — |
// | recurrence-of の値 | 1 件・複数件・前後の空白・引用符で囲んだ要素 | flow 配列でない形（block 形式の配列を含む）・適用した学びに無い名前・pending の学びを指す名前 |
// | 適用した日 | 作成の後に applied にした commit・applied で作った commit・archive へ移した後 | git の外・浅い clone・commit していない適用 |
// | 手順の細かさ | 番号付き 3 行・箇条 5 行・行頭のコードスパンの後 | 番号付き 2 行・箇条 4 行・フェンス（字下げしたものを含む）の中・別の節・`## 提案の補足` の節 |
// | 表の行数 | 上限まで | 上限を超えた分（件数を出す） |
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const scriptDir = join(repoRoot, "skills/kaizen/scripts");
const script = join(scriptDir, "kaizen-effectiveness.sh");

type NoteOptions = {
  status?: string;
  date?: string;
  appliedTo?: string;
  recurrenceOf?: string;
  proposal?: string;
  body?: string;
};

function note({
  status = "applied",
  date = "2026-10-01",
  appliedTo = "[AGENTS.md]",
  recurrenceOf,
  proposal = "短い規則を 1 文で書く。",
  body = "",
}: NoteOptions = {}) {
  return [
    "---",
    `date: ${date}`,
    "type: doc",
    "priority: medium",
    `status: ${status}`,
    `applied-to: ${appliedTo}`,
    ...(recurrenceOf === undefined ? [] : [`recurrence-of: ${recurrenceOf}`]),
    "session: claude-code",
    "---",
    "",
    "# 見出し",
    "",
    "## 事象",
    "",
    "本文。",
    "",
    "## 提案",
    "",
    proposal,
    "",
    body,
  ].join("\n");
}

function makeProject(notes: Record<string, string>, archived: Record<string, string> = {}) {
  const dir = makeTempDir("kaizen-effectiveness-");
  mkdirSync(join(dir, ".kaizen", "archive"), { recursive: true });
  for (const [name, content] of Object.entries(notes)) {
    writeFileSync(join(dir, ".kaizen", name), content);
  }
  for (const [name, content] of Object.entries(archived)) {
    writeFileSync(join(dir, ".kaizen", "archive", name), content);
  }
  return dir;
}

function run(dir: string, args: string[], target = script) {
  const result = spawnSync("bash", [target, ...args], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: dir,
    env: kaizenEnv(dir, { CLAUDE_PROJECT_DIR: dir, LC_ALL: "C.UTF-8" }),
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

type Row = Record<string, string>;

function listRows(dir: string): Row[] {
  const { status, stdout, stderr } = run(dir, ["list"]);
  expect(status, stderr).toBe(0);
  const [header, ...lines] = stdout.trimEnd().split("\n");
  const keys = (header ?? "").split("\t");
  return lines.map((l) => Object.fromEntries(l.split("\t").map((v, i) => [keys[i] ?? "", v])));
}

function rowOf(rows: Row[], note: string): Row {
  const row = rows.find((r) => r.note === note);
  if (row === undefined) throw new Error(`行が無い: ${note}`);
  return row;
}

function git(dir: string, args: string[], date?: string) {
  const env = kaizenEnv(dir, {
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.invalid",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.invalid",
    ...(date === undefined
      ? {}
      : { GIT_AUTHOR_DATE: `${date}T00:00:00Z`, GIT_COMMITTER_DATE: `${date}T00:00:00Z` }),
  });
  const result = spawnSync("git", args, {
    timeout: CHILD_TIMEOUT_MS,
    cwd: dir,
    env,
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
}

function commitAll(dir: string, date: string) {
  git(dir, ["add", "-A"]);
  git(dir, ["com" + "mit", "-q", "--no-verify", "-m", `at ${date}`], date);
}

describe("適用した学びの一覧（list）", () => {
  test("applied の学びだけを、.kaizen/ と archive/ の両方から挙げる", () => {
    const dir = makeProject(
      {
        "a.md": note(),
        "p.md": note({ status: "pending", appliedTo: "[]" }),
        "r.md": note({ status: "rejected", appliedTo: '["rejected: 見送る"]' }),
        "f.md": note({ status: "forgotten", appliedTo: "[]" }),
      },
      { "old.md": note() },
    );
    try {
      const notes = listRows(dir).map((r) => r.note);
      expect(notes.sort()).toStrictEqual([".kaizen/a.md", ".kaizen/archive/old.md"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("recurrence-of を、書いたノートの status に関わらず数える", () => {
    const dir = makeProject(
      {
        "target.md": note(),
        "other.md": note(),
        "rec-pending.md": note({ status: "pending", recurrenceOf: "[target.md]" }),
        "rec-applied.md": note({ recurrenceOf: "[ target.md ,other.md ]" }),
        "rec-forgotten.md": note({ status: "forgotten", recurrenceOf: "[target.md]" }),
      },
      { "rec-archived.md": note({ recurrenceOf: "[target.md]", date: "2026-11-02" }) },
    );
    try {
      const rows = listRows(dir);
      const target = rowOf(rows, ".kaizen/target.md");
      expect(target.recurrences).toBe("4");
      expect(target.recurrence_notes).toContain(".kaizen/archive/rec-archived.md（2026-11-02）");
      expect(target.candidate).toBe("recurring");
      expect(rowOf(rows, ".kaizen/other.md").recurrences).toBe("1");
      // 再発を記録したノートが applied でも、そのノート自身の再発には数えない。
      expect(rowOf(rows, ".kaizen/rec-applied.md").recurrences).toBe("0");
      expect(rowOf(rows, ".kaizen/rec-applied.md").candidate).toBe("-");
      expect(rowOf(rows, ".kaizen/rec-applied.md").recurrence_notes).toBe("-");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("recurrence-of の引用符で囲んだ要素も同じファイル名として数える", () => {
    const dir = makeProject({
      "target.md": note(),
      "rec.md": note({ status: "pending", recurrenceOf: `["target.md", 'target.md']` }),
    });
    try {
      expect(rowOf(listRows(dir), ".kaizen/target.md").recurrences).toBe("2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("読めない recurrence-of と、適用した学びに無い名前は数えずに件数を残す", () => {
    const dir = makeProject({
      "target.md": note(),
      "pending-target.md": note({ status: "pending", appliedTo: "[]" }),
      "block.md": note({ status: "pending", recurrenceOf: "target.md" }),
      "block-list.md": note({ status: "pending", recurrenceOf: "\n  - target.md" }),
      "typo.md": note({ status: "pending", recurrenceOf: "[targt.md]" }),
      "to-pending.md": note({ status: "pending", recurrenceOf: "[pending-target.md]" }),
    });
    try {
      expect(rowOf(listRows(dir), ".kaizen/target.md").recurrences).toBe("0");
      const { status, stdout, stderr } = run(dir, ["candidates"]);
      expect(status).toBe(0);
      expect(stdout).toContain("適用した学びに無いファイル名 2 件・読めない書き方 2 件");
      expect(stderr).toContain("targt.md");
      expect(stderr).toContain(".kaizen/block.md");
      expect(stderr).toContain(".kaizen/block-list.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test.each([
    ["番号付きの手順 3 行", "1. 一つ目\n2. 二つ目\n3. 三つ目", "procedural"],
    ["番号付きの手順 2 行", "1. 一つ目\n2. 二つ目", "-"],
    ["箇条書き 5 行", "- a\n- b\n  - c\n* d\n+ e", "procedural"],
    ["箇条書き 4 行", "- a\n- b\n- c\n- d", "-"],
    ["フェンスの中の箇条", "```text\n- a\n- b\n- c\n- d\n- e\n```", "-"],
    ["長いフェンスの中の短い閉じ", "````md\n```\n- a\n- b\n- c\n- d\n- e\n````", "-"],
    ["字下げしたフェンスの中の箇条", "   ~~~\n- a\n- b\n- c\n- d\n- e\n   ~~~", "-"],
    [
      "行頭のコードスパンはフェンスを開かない",
      "```a``` の後\n- a\n- b\n- c\n- d\n- e",
      "procedural",
    ],
  ])("## 提案 の形: %s", (_label, proposal, expected) => {
    const dir = makeProject({ "a.md": note({ proposal }) });
    try {
      expect(rowOf(listRows(dir), ".kaizen/a.md").candidate).toBe(expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("## 提案 の外の箇条は数えない", () => {
    const bullets = "- a\n- b\n- c\n- d\n- e";
    const dir = makeProject({
      "a.md": note({ body: `## 根拠\n\n${bullets}\n` }),
      "b.md": note({ body: `## 提案の補足\n\n${bullets}\n` }),
    });
    try {
      const rows = listRows(dir);
      expect(rowOf(rows, ".kaizen/a.md").proposal_bullets).toBe("0");
      expect(rowOf(rows, ".kaizen/b.md").proposal_bullets).toBe("0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("適用した日", () => {
  test("status: applied の行が最初に入った commit の日付を使い、archive への移動では変えない", () => {
    const dir = makeProject({ "later.md": note({ status: "pending", appliedTo: "[]" }) });
    try {
      gitInit(dir);
      commitAll(dir, "2026-09-01");
      writeFileSync(join(dir, ".kaizen", "later.md"), note());
      writeFileSync(join(dir, ".kaizen", "born.md"), note());
      commitAll(dir, "2026-09-10");
      renameSync(join(dir, ".kaizen", "later.md"), join(dir, ".kaizen", "archive", "later.md"));
      commitAll(dir, "2026-10-20");
      // commit していない適用は日付を求めない。
      writeFileSync(join(dir, ".kaizen", "fresh.md"), note());
      const rows = listRows(dir);
      expect(rowOf(rows, ".kaizen/archive/later.md").applied_date).toBe("2026-09-10");
      expect(rowOf(rows, ".kaizen/born.md").applied_date).toBe("2026-09-10");
      expect(rowOf(rows, ".kaizen/fresh.md").applied_date).toBe("unknown");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("git の外では日付を unknown にし、理由を出す", () => {
    const dir = makeProject({ "a.md": note() });
    try {
      const { stdout, stderr } = run(dir, ["candidates"]);
      expect(stderr).toContain("git の作業ツリーの外");
      expect(stdout).toContain("適用した日は求めていません");
      expect(rowOf(listRows(dir), ".kaizen/a.md").applied_date).toBe("unknown");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("浅い clone では、残った commit の日付を付けずに unknown にする", () => {
    const origin = makeProject({ "a.md": note() });
    const clone = makeTempDir("kaizen-effectiveness-clone-");
    try {
      gitInit(origin);
      commitAll(origin, "2026-09-01");
      writeFileSync(join(origin, "x.txt"), "x");
      commitAll(origin, "2026-09-05");
      rmSync(clone, { recursive: true, force: true });
      git(dirname(clone), ["clone", "-q", "--depth=1", `file://${origin}`, clone]);
      const { stderr } = run(clone, ["list"]);
      expect(stderr).toContain("履歴が浅い clone");
      expect(rowOf(listRows(clone), ".kaizen/a.md").applied_date).toBe("unknown");
    } finally {
      rmSync(origin, { recursive: true, force: true });
      rmSync(clone, { recursive: true, force: true });
    }
  });
});

describe("候補の表（candidates）", () => {
  test("候補だけを再発の多い順に並べ、根拠の記録と適用先を載せる", () => {
    const dir = makeProject({
      "a-plain.md": note(),
      "b-once.md": note({ appliedTo: "[docs/x.md]" }),
      "c-twice.md": note(),
      "d-steps.md": note({ proposal: "1. a\n2. b\n3. c" }),
      "r1.md": note({ status: "pending", recurrenceOf: "[c-twice.md, b-once.md]" }),
      "r2.md": note({ status: "pending", recurrenceOf: "[c-twice.md]" }),
    });
    try {
      const { status, stdout } = run(dir, ["candidates"]);
      expect(status).toBe(0);
      expect(stdout).toContain("適用した学び 4 件のうち、3 件が候補です。");
      expect(stdout).not.toContain("a-plain.md");
      const order = ["c-twice", "b-once", "d-steps"].map((n) => stdout.indexOf(`.kaizen/${n}.md`));
      expect(order.every((i) => i > -1)).toBe(true);
      expect(order).toStrictEqual([...order].sort((x, y) => x - y));
      expect(stdout).toContain("再発 2 件。機構への置き換えを検討する");
      expect(stdout).toContain(
        "手順 3 行・箇条 0 行。短い「〜しない」の規則への書き換えを検討する",
      );
      expect(stdout).toMatch(
        /b-once\.md` \| unknown \| 再発 1 件.*\| \.kaizen\/r1\.md（2026-10-01） \| \[docs\/x\.md\] \|/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("再発の記録は 5 件まで載せ、残りは件数だけを書く", () => {
    const notes: Record<string, string> = { "target.md": note() };
    for (let i = 1; i <= 6; i++)
      notes[`r${i}.md`] = note({ status: "pending", recurrenceOf: "[target.md]" });
    const dir = makeProject(notes);
    try {
      const { stdout } = run(dir, ["candidates"]);
      expect(stdout).toContain(".kaizen/r5.md（2026-10-01）、ほか 1 件");
      expect(stdout).not.toContain(".kaizen/r6.md");
      expect(rowOf(listRows(dir), ".kaizen/target.md").recurrence_notes).toContain(".kaizen/r6.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("候補が 0 件なら表を出さない", () => {
    const dir = makeProject({ "a.md": note() });
    try {
      const { stdout } = run(dir, ["candidates"]);
      expect(stdout).toContain("1 件のうち、0 件が候補です。");
      expect(stdout).not.toContain("| 学び |");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("表は 30 行までにし、残りの件数を出す", () => {
    const notes: Record<string, string> = {};
    for (let i = 0; i < 31; i++)
      notes[`n${String(i).padStart(2, "0")}.md`] = note({ proposal: "1. a\n2. b\n3. c" });
    const dir = makeProject(notes);
    try {
      const { stdout } = run(dir, ["candidates"]);
      expect(stdout.split("\n").filter((l) => l.startsWith("| `.kaizen/")).length).toBe(30);
      expect(stdout).toContain("残り 1 件");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("適用先の `|` は列の区切りにしない", () => {
    const dir = makeProject({
      "a.md": note({ appliedTo: '["a|b.md"]', proposal: "1. a\n2. b\n3. c" }),
    });
    try {
      expect(run(dir, ["candidates"]).stdout).toContain('["a\\|b.md"]');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("呼び出し方と機能を減らした実行", () => {
  test("モードが無ければ使い方を出して exit 2", () => {
    const dir = makeProject({});
    try {
      const { status, stderr } = run(dir, []);
      expect(status).toBe(2);
      expect(stderr).toContain("使い方");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("共通ライブラリを読めなければ、0 件と区別できるよう exit 1", () => {
    const dir = makeProject({ "a.md": note() });
    try {
      const solo = join(dir, "solo");
      mkdirSync(solo);
      const target = join(solo, "kaizen-effectiveness.sh");
      copyFileSync(script, target);
      const { status, stdout, stderr } = run(dir, ["list"], target);
      expect(status).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toContain("kaizen-hook-common.sh を読めない");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("週次の報告（kaizen-schedule-report.sh issue）", () => {
  const report = join(scriptDir, "kaizen-schedule-report.sh");

  test("本文に候補の節を入れる", () => {
    const dir = makeProject({
      "a.md": note(),
      "r.md": note({ status: "pending", recurrenceOf: "[a.md]" }),
    });
    try {
      const { status, stdout } = run(dir, ["issue"], report);
      expect(status).toBe(0);
      expect(stdout).toContain("## 効果を測り直す規約の候補");
      expect(stdout).toContain("| `.kaizen/a.md` |");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("kaizen-effectiveness.sh が無ければ、節を省かずに測れなかったと書く", () => {
    const dir = makeProject({ "a.md": note() });
    try {
      const partial = join(dir, "partial");
      mkdirSync(partial);
      for (const f of ["kaizen-schedule-report.sh", "kaizen-hook-common.sh"]) {
        copyFileSync(join(scriptDir, f), join(partial, f));
      }
      const { status, stdout, stderr } = run(
        dir,
        ["issue"],
        join(partial, "kaizen-schedule-report.sh"),
      );
      expect(status).toBe(0);
      expect(stdout).toContain("## 効果を測り直す規約の候補");
      expect(stdout).toContain("測れませんでした");
      expect(stderr).toContain("kaizen-effectiveness.sh を読めない");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
