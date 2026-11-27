// kaizen-learnings.ts（kaizen の学びの適用・再発・忘却の件数）のテスト。
//
// | 軸 | 値 |
// | --- | --- |
// | frontmatter | 無い / 閉じない / status が無い・知らない値・2 回 / 本文の status の行 |
// | recurrence-of | 無い / `[]` / 1 件 / 2 件 / 引用符 / パス付き / カンマを含む名前 / ブロック / 2 回 |
// | 学びのディレクトリ | 無い / top-level と archive / 学びでない名前（INDEX.md）/ 同じ名前が両方 / symlink（dir・archive・学び） |
// | git の履歴の commit | 新しいファイル / status の変更 / 名前の変更 / 消して足す（移動）/ 消す / 学びでないパス / 日時が読めない |
// | 履歴の status の行 | frontmatter の範囲の内・外 / 1 つの commit で 2 回 / 知らない値 |
// | 履歴の recurrence-of | 無い / `[]` / 空でない（足した commit から再発に数える） |
// | git | 履歴が浅い / 呼び出しの引数（first-parent・-m・--text） |
// | 履歴と作業ツリー | 一致 / status が違う / 履歴で生きているのにファイルが無い |
// | 期間 | 始まりちょうど（外）/ 終わりちょうど（内）/ 外 |
// | 適用までの日数 | 0 件 / 奇数件 / 偶数件 |
// | 古い pending | ちょうど stale_days / 1 日足りない / pending でない |
// | 再発 | 正しい / 無い学び / 適用していない学び / 再発の後に適用した学び / 期間の内・外 / 既にある学びに後から足した |
// | 閾値 | 上限ちょうど（挙げない）/ 上限を超える（挙げる） |
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { gitAt, initRepo } from "../../lib/testing/git-at.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { defaultRunner } from "./check-cost-metrics.ts";
import {
  collectKaizen,
  kaizenFindings,
  kaizenMetrics,
  kaizenTable,
  type KaizenConfig,
  type Note,
  parseNote,
  parseStatusLog,
  readNotes,
  type Runner,
  type Status,
  type StatusEvent,
  statusLog,
  unquotePath,
} from "./kaizen-learnings.ts";

const NOW = new Date("2026-11-20T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number): number => NOW.getTime() - days * DAY;
const isoAgo = (days: number): string => new Date(ago(days)).toISOString();

const config: KaizenConfig = { dir: ".kaizen", days: 7, staleDays: 30, maxPending: 2, maxStale: 0 };

function noteText(status: string, extra: string[] = []): string {
  return [
    "---",
    "date: 2026-10-01",
    "type: doc",
    "priority: medium",
    `status: ${status}`,
    "applied-to: []",
    ...extra,
    "session: claude-code",
    "---",
    "",
    "# 学び",
    "",
  ].join("\n");
}

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

describe("学びの frontmatter", () => {
  test("status と recurrence-of を読む。本文の status の行は読まない", () => {
    const text = `${noteText("applied", ["recurrence-of: [2026-09-01-a.md, 2026-09-02-b.md]"])}status: pending\n`;
    expect(parseNote(text, "n.md")).toEqual({
      status: "applied",
      recurrenceOf: ["2026-09-01-a.md", "2026-09-02-b.md"],
    });
  });

  test.each([
    ["欄が無い", []],
    ["空の配列", ["recurrence-of: []"]],
  ])("recurrence-of が%sなら再発でない", (_name, extra) => {
    expect(parseNote(noteText("pending", extra), "n.md").recurrenceOf).toEqual([]);
  });

  test.each(STATUS_VALUES())("status: %s を読む", (status) => {
    expect(parseNote(noteText(status), "n.md").status).toBe(status);
  });

  test.each([
    ["frontmatter が無い", "# 学び\n", "frontmatter を読めない"],
    ["frontmatter が閉じない", "---\nstatus: pending\n", "frontmatter を読めない"],
    ["status が無い", "---\ndate: 2026-10-01\n---\n", "status が無いか、知らない値"],
    ["status が知らない値", noteText("done"), "status が無いか、知らない値"],
    ["status が 2 回", noteText("pending", ["status: applied"]), "status が 2 回以上ある"],
    [
      "recurrence-of が引用符",
      noteText("pending", ['recurrence-of: ["2026-09-01-a.md"]']),
      "学びのファイル名でない要素",
    ],
    [
      "recurrence-of がパス付き",
      noteText("pending", ["recurrence-of: [archive/2026-09-01-a.md]"]),
      "学びのファイル名でない要素",
    ],
    [
      "recurrence-of がカンマを含む名前",
      noteText("pending", ["recurrence-of: [2026-09-01-a,b.md]"]),
      "カンマを含む名前は挙げられない",
    ],
    [
      "recurrence-of がブロック",
      noteText("pending", ["recurrence-of:", "  - 2026-09-01-a.md"]),
      "1 行の flow 配列でない",
    ],
    [
      "recurrence-of が 2 回",
      noteText("pending", ["recurrence-of: [2026-09-01-a.md]", "recurrence-of: []"]),
      "recurrence-of が 2 回以上ある",
    ],
  ])("%s は例外", (_name, text, message) => {
    expect(() => parseNote(text, "n.md")).toThrow(message);
  });
});

function STATUS_VALUES(): Status[] {
  return ["pending", "applied", "forgotten", "rejected"];
}

describe("学びのディレクトリ", () => {
  test("無ければ null", () => {
    expect(readNotes(makeTempDir("kaizen-learnings-"), ".kaizen")).toBeNull();
  });

  test("top-level と archive の学びを読み、学びでない名前は読まない", () => {
    const root = makeTempDir("kaizen-learnings-");
    writeFiles(root, {
      ".kaizen/2026-10-01-a.md": noteText("pending"),
      ".kaizen/archive/2026-09-01-b.md": noteText("applied"),
      ".kaizen/archive/INDEX.md": "# 索引\n",
      ".kaizen/README.md": "# 説明\n",
      ".kaizen/archive/nested/2026-09-02-c.md": noteText("applied"),
    });
    expect(Object.fromEntries(readNotes(root, ".kaizen") ?? [])).toEqual({
      "2026-10-01-a.md": { status: "pending", recurrenceOf: [] },
      "2026-09-01-b.md": { status: "applied", recurrenceOf: [] },
    });
  });

  test("archive が無くても top-level を読む", () => {
    const root = makeTempDir("kaizen-learnings-");
    writeFiles(root, { ".kaizen/2026-10-01-a.md": noteText("pending") });
    expect(readNotes(root, ".kaizen")?.size).toBe(1);
  });

  test("同じ名前が top-level と archive にあれば例外", () => {
    const root = makeTempDir("kaizen-learnings-");
    writeFiles(root, {
      ".kaizen/2026-10-01-a.md": noteText("pending"),
      ".kaizen/archive/2026-10-01-a.md": noteText("applied"),
    });
    expect(() => readNotes(root, ".kaizen")).toThrow(
      "同じ名前の学びが top-level と archive にある",
    );
  });

  test.each([
    ["学びのディレクトリ", ".kaizen", "outside"],
    ["archive", ".kaizen/archive", "outside"],
    ["学び", ".kaizen/2026-10-02-b.md", "outside/2026-10-02-b.md"],
  ])("%sが symlink なら、リンク先を読まずに例外", (_name, link, target) => {
    const root = makeTempDir("kaizen-learnings-");
    writeFiles(root, {
      "outside/2026-10-02-b.md": noteText("pending"),
      ...(link === ".kaizen" ? {} : { ".kaizen/2026-10-01-a.md": noteText("pending") }),
    });
    symlinkSync(join(root, target), join(root, link));
    expect(() => readNotes(root, ".kaizen")).toThrow("symlink なので、学びとして読まない");
  });
});

// ---- git の履歴（実際の `git log --first-parent -m -M -p --unified=0` の形）

type Change =
  | { kind: "add"; path: string; status: string; line?: number }
  | { kind: "modify"; path: string; status: string; line?: number; extra?: string[] }
  | { kind: "rename"; from: string; to: string }
  | { kind: "delete"; path: string; status: string }
  | { kind: "body"; path: string }
  | { kind: "partial"; path: string; status: string };

/** 変更したファイルの差分の見出し（実物の `git log -p` の形）。 */
const modified = (path: string): string[] => [
  `diff --git a/${path} b/${path}`,
  "index 1dec528dc..ebd725c66 100644",
  `--- a/${path}`,
  `+++ b/${path}`,
];

const added = (path: string, status: string, line = 3): string[] => [
  `diff --git a/${path} b/${path}`,
  "new file mode 100644",
  "index 000000000..9453543f5",
  "--- /dev/null",
  `+++ b/${path}`,
  "@@ -0,0 +1,6 @@",
  "+---",
  ...Array.from({ length: line - 2 }, (_, i) => `+key${i}: x`),
  `+status: ${status}`,
  "+---",
];

const deleted = (path: string, status: string): string[] => [
  `diff --git a/${path} b/${path}`,
  "deleted file mode 100644",
  "index 9453543f5..000000000",
  `--- a/${path}`,
  "+++ /dev/null",
  "@@ -1,3 +0,0 @@",
  "----",
  `-status: ${status}`,
  "----",
];

function changeText(c: Change): string[] {
  switch (c.kind) {
    case "add":
      return added(c.path, c.status, c.line);
    case "modify": {
      // 文脈を十分に取った差分なので、hunk は 1 行目から始まり、変更の後の全文を含む。status は line 行目にある。
      const keys = Array.from({ length: (c.line ?? 3) - 2 }, (_, i) => ` key${i}: x`);
      const extra = (c.extra ?? []).map((l) => ` ${l}`);
      const size = keys.length + extra.length + 5;
      return [
        ...modified(c.path),
        `@@ -1,${size} +1,${size} @@`,
        " ---",
        ...keys,
        "-status: pending",
        `+status: ${c.status}`,
        ...extra,
        " ---",
        " ",
        " # 学び",
      ];
    }
    case "partial":
      return [...modified(c.path), "@@ -5,1 +5,1 @@", "-status: pending", `+status: ${c.status}`];
    case "rename":
      return [
        `diff --git a/${c.from} b/${c.to}`,
        "similarity index 100%",
        `rename from ${c.from}`,
        `rename to ${c.to}`,
      ];
    case "delete":
      return deleted(c.path, c.status);
    case "body":
      // 本文に、桁 0 の `status:` の行（frontmatter の例など）を足した変更。
      return [
        ...modified(c.path),
        "@@ -1,4 +1,6 @@",
        " ---",
        " status: pending",
        " ---",
        " ",
        "+例:",
        "+status: applied",
      ];
  }
}

/** commit を古い順に渡すと、git log と同じ新しい順の出力を返す。 */
function gitLog(commits: { daysAgo: number; changes: Change[] }[]): string {
  return [...commits]
    .reverse()
    .map(({ daysAgo, changes }, i) =>
      [
        `@@C ${String(i).padStart(40, "0")} ${isoAgo(daysAgo)}`,
        "",
        ...changes.flatMap(changeText),
      ].join("\n"),
    )
    .join("\n");
}

const statuses = (events: StatusEvent[] | undefined) => events?.map((e) => e.status);

describe("git の履歴", () => {
  test("学びごとに、status の事象を古い順に返す", () => {
    const log = gitLog([
      {
        daysAgo: 10,
        changes: [{ kind: "add", path: ".kaizen/2026-10-01-a.md", status: "pending" }],
      },
      {
        daysAgo: 5,
        changes: [{ kind: "modify", path: ".kaizen/2026-10-01-a.md", status: "applied" }],
      },
    ]);
    const { events } = parseStatusLog(log, ".kaizen");
    expect(events.get("2026-10-01-a.md")).toEqual([
      { at: ago(10), status: "pending" },
      { at: ago(5), status: "applied" },
    ]);
  });

  test("空でない recurrence-of を書いた commit の事象だけに印を付ける", () => {
    const path = ".kaizen/2026-10-01-a.md";
    const log = gitLog([
      { daysAgo: 10, changes: [{ kind: "add", path, status: "pending" }] },
      {
        daysAgo: 6,
        changes: [{ kind: "modify", path, status: "pending", extra: ["recurrence-of: []"] }],
      },
      {
        daysAgo: 4,
        changes: [
          { kind: "modify", path, status: "pending", extra: ["recurrence-of: [2026-09-01-b.md]"] },
        ],
      },
    ]);
    expect(parseStatusLog(log, ".kaizen").events.get("2026-10-01-a.md")).toEqual([
      { at: ago(10), status: "pending" },
      { at: ago(6), status: "pending" },
      { at: ago(4), status: "pending", recurrence: true },
    ]);
  });

  test("名前を変えた学びは、前の名前の事象を新しい名前に付け替える", () => {
    const log = gitLog([
      {
        daysAgo: 10,
        changes: [{ kind: "add", path: ".kaizen/2026-10-02-a.md", status: "pending" }],
      },
      {
        daysAgo: 8,
        changes: [
          { kind: "rename", from: ".kaizen/2026-10-02-a.md", to: ".kaizen/2026-10-01-a.md" },
        ],
      },
      {
        daysAgo: 6,
        changes: [
          {
            kind: "rename",
            from: ".kaizen/2026-10-01-a.md",
            to: ".kaizen/archive/2026-10-01-a.md",
          },
        ],
      },
      {
        daysAgo: 5,
        changes: [{ kind: "modify", path: ".kaizen/archive/2026-10-01-a.md", status: "applied" }],
      },
    ]);
    const { events } = parseStatusLog(log, ".kaizen");
    expect([...events.keys()]).toEqual(["2026-10-01-a.md"]);
    expect(statuses(events.get("2026-10-01-a.md"))).toEqual(["pending", "applied"]);
  });

  test("同じ commit で消して足した学び（archive への移動）は生きたまま残る", () => {
    const log = gitLog([
      {
        daysAgo: 10,
        changes: [{ kind: "add", path: ".kaizen/2026-10-01-a.md", status: "applied" }],
      },
      {
        daysAgo: 5,
        changes: [
          { kind: "add", path: ".kaizen/archive/2026-10-01-a.md", status: "applied" },
          { kind: "delete", path: ".kaizen/2026-10-01-a.md", status: "applied" },
        ],
      },
    ]);
    expect(statuses(parseStatusLog(log, ".kaizen").events.get("2026-10-01-a.md"))).toEqual([
      "applied",
      "applied",
    ]);
  });

  test("消した学びは status が null の事象になる", () => {
    const log = gitLog([
      {
        daysAgo: 10,
        changes: [{ kind: "add", path: ".kaizen/2026-10-01-a.md", status: "pending" }],
      },
      {
        daysAgo: 5,
        changes: [{ kind: "delete", path: ".kaizen/2026-10-01-a.md", status: "pending" }],
      },
    ]);
    expect(statuses(parseStatusLog(log, ".kaizen").events.get("2026-10-01-a.md"))).toEqual([
      "pending",
      null,
    ]);
  });

  test("引用符で囲んだ見出しのファイルに足した行を、前の学びの status として読まない", () => {
    const quoted = '".kaizen/archive/索引.md"';
    const log = [
      `@@C ${"0".repeat(40)} ${isoAgo(10)}`,
      "",
      ...added(".kaizen/2026-10-01-a.md", "pending"),
      `diff --git "a/${quoted.slice(1)} "b/${quoted.slice(1)}`,
      "new file mode 100644",
      "@@ -0,0 +1 @@",
      "+status: applied",
    ].join("\n");
    expect(statuses(parseStatusLog(log, ".kaizen").events.get("2026-10-01-a.md"))).toEqual([
      "pending",
    ]);
  });

  test.each([
    ["囲んでいない", ".kaizen/a.md", ".kaizen/a.md"],
    ["ASCII 以外の 8 進数", '".kaizen/2026-10-01-\\346\\227\\245.md"', ".kaizen/2026-10-01-日.md"],
    ["引用符と \\", '".kaizen/2026-10-01-\\"q\\\\.md"', '.kaizen/2026-10-01-"q\\.md'],
    ["制御文字", '".kaizen/2026-10-01-\\t.md"', ".kaizen/2026-10-01-\t.md"],
  ])("引用符で囲んだパスを戻す: %s", (_name, quoted, expected) => {
    expect(unquotePath(quoted)).toBe(expected);
  });

  test("引用符で囲んだ見出しと名前の変更の学びも数える（期間の中で記録して消した学びを含む）", () => {
    const top = '".kaizen/2026-10-01-\\346\\227\\245.md"';
    const archived = '".kaizen/archive/2026-10-01-\\346\\227\\245.md"';
    const gone = '".kaizen/2026-10-02-\\346\\266\\210.md"';
    const header = (path: string) => `diff --git "a/${path.slice(1)} "b/${path.slice(1)}`;
    const log = [
      `@@C ${"2".repeat(40)} ${isoAgo(1)}`,
      "",
      `diff --git "a/${top.slice(1)} "b/${archived.slice(1)}`,
      "similarity index 100%",
      `rename from ${top}`,
      `rename to ${archived}`,
      header(gone),
      "deleted file mode 100644",
      "@@ -1,3 +0,0 @@",
      "-status: pending",
      `@@C ${"1".repeat(40)} ${isoAgo(3)}`,
      "",
      header(top),
      "new file mode 100644",
      "@@ -0,0 +1,3 @@",
      "+---",
      "+status: pending",
      "+---",
      header(gone),
      "new file mode 100644",
      "@@ -0,0 +1,3 @@",
      "+---",
      "+status: pending",
      "+---",
    ].join("\n");
    const { events } = parseStatusLog(log, ".kaizen");
    expect(statuses(events.get("2026-10-01-日.md"))).toEqual(["pending"]);
    expect(statuses(events.get("2026-10-02-消.md"))).toEqual(["pending", null]);
    expect([...events.keys()].sort()).toEqual(["2026-10-01-日.md", "2026-10-02-消.md"]);
  });

  test("前に消した学びの名前へ名前を変えたときは、事象を時刻の順に並べる", () => {
    const log = gitLog([
      {
        daysAgo: 10,
        changes: [{ kind: "add", path: ".kaizen/2026-10-01-a.md", status: "pending" }],
      },
      {
        daysAgo: 9,
        changes: [{ kind: "add", path: ".kaizen/2026-10-02-a.md", status: "pending" }],
      },
      {
        daysAgo: 8,
        changes: [{ kind: "delete", path: ".kaizen/2026-10-01-a.md", status: "pending" }],
      },
      {
        daysAgo: 6,
        changes: [
          { kind: "rename", from: ".kaizen/2026-10-02-a.md", to: ".kaizen/2026-10-01-a.md" },
        ],
      },
      {
        daysAgo: 5,
        changes: [{ kind: "modify", path: ".kaizen/2026-10-01-a.md", status: "applied" }],
      },
    ]);
    const { events } = parseStatusLog(log, ".kaizen");
    expect(events.get("2026-10-01-a.md")?.map((e) => e.at)).toEqual([
      ago(10),
      ago(9),
      ago(8),
      ago(5),
    ]);
    expect(events.get("2026-10-01-a.md")?.at(-1)?.status).toBe("applied");
  });

  test("学びでないパスは数えず、本文に足した status の行は frontmatter の status と取り違えない", () => {
    const log = gitLog([
      {
        daysAgo: 10,
        changes: [
          { kind: "add", path: ".kaizen/archive/INDEX.md", status: "pending" },
          { kind: "add", path: "docs/2026-10-01-a.md", status: "pending" },
          { kind: "add", path: ".kaizen/2026-10-01-a.md", status: "pending" },
        ],
      },
      { daysAgo: 5, changes: [{ kind: "body", path: ".kaizen/2026-10-01-a.md" }] },
    ]);
    const { events, skipped } = parseStatusLog(log, ".kaizen");
    expect([...events.keys()]).toEqual(["2026-10-01-a.md"]);
    // 本文の `status: applied` は frontmatter の外にあるので、5 日前の status は frontmatter の pending のままである。
    expect(statuses(events.get("2026-10-01-a.md"))).toEqual(["pending", "pending"]);
    expect(skipped).toBe(0);
  });

  test("frontmatter が長い学び（status が 45 行目）の status も読む", () => {
    const log = gitLog([
      {
        daysAgo: 1,
        changes: [{ kind: "modify", path: ".kaizen/2026-10-01-a.md", status: "applied", line: 45 }],
      },
    ]);
    const { events, skipped } = parseStatusLog(log, ".kaizen");
    expect(statuses(events.get("2026-10-01-a.md"))).toEqual(["applied"]);
    expect(skipped).toBe(0);
  });

  const A = ".kaizen/2026-10-01-a.md";
  // git の履歴は後から直せないので、status を読めない変更は例外にせず、読み飛ばして件数に数える。
  const skippedLogs: { name: string; changes: Change[] }[] = [
    { name: "status が知らない値", changes: [{ kind: "modify", path: A, status: "done" }] },
    {
      name: "frontmatter に status が 2 回ある",
      changes: [{ kind: "modify", path: A, status: "applied", extra: ["status: forgotten"] }],
    },
    {
      name: "hunk が 1 行目から始まらず、全文を組み立てられない",
      changes: [{ kind: "partial", path: A, status: "applied" }],
    },
  ];
  test.each(skippedLogs)("$name ときは、その変更を読み飛ばして数える", ({ changes }) => {
    const { events, skipped } = parseStatusLog(gitLog([{ daysAgo: 1, changes }]), ".kaizen");
    expect(events.get("2026-10-01-a.md")).toBeUndefined();
    expect(skipped).toBe(1);
  });

  test("読み飛ばす変更が無ければ 0 件", () => {
    const log = gitLog([{ daysAgo: 1, changes: [{ kind: "add", path: A, status: "pending" }] }]);
    expect(parseStatusLog(log, ".kaizen").skipped).toBe(0);
  });

  test("消した学びの差分は status として読まない", () => {
    const log = gitLog([
      { daysAgo: 2, changes: [{ kind: "add", path: A, status: "applied" }] },
      { daysAgo: 1, changes: [{ kind: "delete", path: A, status: "applied" }] },
    ]);
    const { events, skipped } = parseStatusLog(log, ".kaizen");
    expect(statuses(events.get("2026-10-01-a.md"))).toEqual(["applied", null]);
    expect(skipped).toBe(0);
  });

  test("commit の日時を読めなければ例外", () => {
    expect(() => parseStatusLog("@@C abc not-a-date\n", ".kaizen")).toThrow(
      "commit の日時を読めない",
    );
  });

  test("履歴が浅ければ log を呼ぶ前に例外", async () => {
    const calls: string[][] = [];
    const run: Runner = async (_command, args) => {
      calls.push([...args]);
      return "true\n";
    };
    await expect(statusLog(run, "/r", ".kaizen")).rejects.toThrow("git の履歴が浅い");
    expect(calls).toHaveLength(1);
  });

  test("first-parent で merge の差分を含め、binary と判定されるファイルも差分を出させる", async () => {
    const calls: string[][] = [];
    const run: Runner = async (_command, args) => {
      calls.push([...args]);
      return args.includes("rev-parse") ? "false\n" : "";
    };
    await statusLog(run, "/r", ".kaizen");
    const log = calls[1] ?? [];
    expect(log.slice(0, 5)).toEqual(["-C", "/r", "-c", "core.quotePath=false", "log"]);
    expect(log).toEqual(
      expect.arrayContaining([
        "--first-parent",
        "--diff-merges=first-parent",
        "-M",
        "--text",
        "-p",
      ]),
    );
    expect(log.slice(-2)).toEqual(["--", ".kaizen"]);
  });
});

// ---- 数える

const note = (status: Status, recurrenceOf: string[] = []): Note => ({ status, recurrenceOf });
const ev = (daysAgo: number, status: Status | null): StatusEvent => ({ at: ago(daysAgo), status });

function metrics(
  notes: Record<string, Note>,
  history: Record<string, StatusEvent[]>,
  cfg = config,
) {
  return kaizenMetrics(new Map(Object.entries(notes)), new Map(Object.entries(history)), {
    now: NOW,
    config: cfg,
  });
}

describe("数える", () => {
  test("今の件数と期間の始まりの件数、期間の中の記録・適用・忘却を数える", () => {
    const m = metrics(
      {
        "a.md": note("applied"),
        "b.md": note("forgotten"),
        "c.md": note("pending"),
        "d.md": note("rejected"),
      },
      {
        "a.md": [ev(20, "pending"), ev(3, "applied")],
        // 忘却から呼び戻して、また忘却した。期間の中で 1 件と数える。
        "b.md": [ev(40, "pending"), ev(6, "forgotten"), ev(5, "pending"), ev(4, "forgotten")],
        "c.md": [ev(2, "pending")],
        "d.md": [ev(10, "rejected")],
        // 期間の中で消した学びは、今の件数に入らず、期間の始まりの件数に入る。
        "e.md": [ev(30, "applied"), ev(1, null)],
        // 期間の中で記録してから消した学びは、期間の中の記録に数える。
        "f.md": [ev(3, "pending"), ev(2, null)],
      },
    );
    expect(m.counts).toEqual({ pending: 1, applied: 1, forgotten: 1, rejected: 1 });
    expect(m.previous).toEqual({ pending: 2, applied: 1, forgotten: 0, rejected: 1 });
    expect({ extracted: m.extracted, applied: m.applied, forgotten: m.forgotten }).toEqual({
      extracted: 2,
      applied: 1,
      forgotten: 1,
    });
  });

  test("期間は始まりちょうどを含めず、終わりちょうどを含める", () => {
    const m = metrics(
      { "start.md": note("applied"), "end.md": note("applied") },
      {
        "start.md": [ev(7, "applied")],
        "end.md": [ev(0, "applied")],
      },
    );
    expect(m.extracted).toBe(1);
    expect(m.applied).toBe(1);
    expect(m.previous.applied).toBe(1);
  });

  test("applied から applied へ移しただけ（archive への移動）は、期間の中の適用に数えない", () => {
    const m = metrics(
      { "a.md": note("applied") },
      { "a.md": [ev(20, "applied"), ev(3, "applied")] },
    );
    expect(m.applied).toBe(0);
  });

  type MedianCase = {
    name: string;
    notes: Record<string, Note>;
    history: Record<string, StatusEvent[]>;
    expected: { median: number | null; notes: number };
  };
  const medianCases: MedianCase[] = [
    { name: "applied が無い", notes: {}, history: {}, expected: { median: null, notes: 0 } },
    {
      name: "奇数件",
      notes: { "a.md": note("applied"), "b.md": note("applied"), "c.md": note("applied") },
      history: {
        "a.md": [ev(10, "pending"), ev(9, "applied")],
        "b.md": [ev(10, "pending"), ev(7, "applied")],
        "c.md": [ev(10, "applied")],
      },
      expected: { median: 1, notes: 3 },
    },
    {
      name: "偶数件",
      notes: { "a.md": note("applied"), "b.md": note("applied"), "p.md": note("pending") },
      history: {
        "a.md": [ev(10, "pending"), ev(9, "applied")],
        "b.md": [ev(10, "pending"), ev(6, "applied")],
        // pending に戻した学びは数えない。
        "p.md": [ev(10, "pending"), ev(9, "applied"), ev(8, "pending")],
      },
      expected: { median: 2.5, notes: 2 },
    },
  ];
  test.each(medianCases)("適用までの日数の中央値: $name", ({ notes, history, expected }) => {
    expect(metrics(notes, history).daysToApply).toEqual(expected);
  });

  test("pending のまま stale_days 日を過ぎた学びを、名前の順に挙げる", () => {
    const m = metrics(
      {
        "z.md": note("pending"),
        "a.md": note("pending"),
        "young.md": note("pending"),
        "done.md": note("applied"),
      },
      {
        "z.md": [ev(31, "pending")],
        "a.md": [ev(30, "pending")],
        "young.md": [ev(29, "pending")],
        "done.md": [ev(60, "applied")],
      },
    );
    expect(m.stale).toEqual(["a.md", "z.md"]);
  });

  test.each([
    ["status が作業ツリーと違う", { "a.md": note("applied") }, { "a.md": [ev(1, "pending")] }],
    ["履歴に無い", { "a.md": note("pending") }, {}],
    ["履歴で生きているのにファイルが無い", {}, { "a.md": [ev(1, "pending")] }],
  ])("%s なら例外", (_name, notes, history) => {
    expect(() => metrics(notes, history)).toThrow("履歴の最後の status が作業ツリーと違う");
  });

  test("履歴で消した学びは、ファイルが無くてよい", () => {
    expect(metrics({}, { "a.md": [ev(5, "pending"), ev(1, null)] }).counts.pending).toBe(0);
  });

  test("recurrence-of を書いた学びを、記録した順に再発として挙げる", () => {
    const m = metrics(
      {
        "base.md": note("applied"),
        "other.md": note("applied"),
        "late.md": note("pending", ["base.md", "other.md"]),
        "early.md": note("pending", ["base.md"]),
      },
      {
        "base.md": [ev(20, "pending"), ev(15, "applied")],
        "other.md": [ev(10, "applied")],
        "late.md": [ev(2, "pending")],
        "early.md": [ev(15, "pending")],
      },
    );
    expect(m.recurrences).toEqual([
      { name: "early.md", of: ["base.md"], at: ago(15) },
      { name: "late.md", of: ["base.md", "other.md"], at: ago(2) },
    ]);
  });

  test.each([
    ["履歴に無い学び", { "r.md": note("pending", ["gone.md"]) }, { "r.md": [ev(2, "pending")] }],
    [
      "適用していない学び",
      { "r.md": note("pending", ["base.md"]), "base.md": note("pending") },
      { "r.md": [ev(2, "pending")], "base.md": [ev(10, "pending")] },
    ],
    [
      "再発を書いた後に適用した学び",
      { "r.md": note("pending", ["base.md"]), "base.md": note("applied") },
      { "r.md": [ev(5, "pending")], "base.md": [ev(10, "pending"), ev(2, "applied")] },
    ],
  ])("recurrence-of が%sを挙げていれば例外", (_name, notes, history) => {
    expect(() => metrics(notes, history)).toThrow("recurrence-of の");
  });

  test("既にある学びに後から recurrence-of を足したら、足した commit の時刻を再発の時刻にする", () => {
    const m = metrics(
      { "r.md": note("pending", ["base.md"]), "base.md": note("applied") },
      {
        "r.md": [ev(20, "pending"), { at: ago(2), status: "pending", recurrence: true }],
        "base.md": [ev(30, "pending"), ev(25, "applied")],
      },
    );
    expect(m.recurrences).toEqual([{ name: "r.md", of: ["base.md"], at: ago(2) }]);
  });

  test("recurrence-of が、適用した後に消した（kaizen の delete）学びを挙げても数える", () => {
    const m = metrics(
      { "r.md": note("pending", ["deleted.md"]) },
      {
        "r.md": [ev(3, "pending")],
        "deleted.md": [ev(20, "pending"), ev(10, "applied"), ev(1, null)],
      },
    );
    expect(m.recurrences).toEqual([{ name: "r.md", of: ["deleted.md"], at: ago(3) }]);
  });
});

describe("候補", () => {
  const base = (over: Partial<ReturnType<typeof metrics>> = {}) => ({
    ...metrics({}, {}),
    ...over,
  });

  test("数えなかったときは挙げない", () => {
    expect(kaizenFindings(null, { now: NOW, config })).toEqual([]);
  });

  test("上限ちょうどは挙げない", () => {
    const m = base({ counts: { pending: 2, applied: 0, forgotten: 0, rejected: 0 }, stale: [] });
    expect(kaizenFindings(m, { now: NOW, config })).toEqual([]);
  });

  test("上限を超えた値と、期間の中で書いた再発を挙げる", () => {
    const m = base({
      counts: { pending: 3, applied: 0, forgotten: 0, rejected: 0 },
      stale: ["a.md"],
      recurrences: [
        { name: "old.md", of: ["x.md"], at: ago(7) },
        { name: "new.md", of: ["x.md", "y.md"], at: ago(1) },
      ],
    });
    expect(kaizenFindings(m, { now: NOW, config })).toEqual([
      { kind: "kaizen-pending", target: ".kaizen", detail: "pending の学び 3 件（上限 2 件）" },
      {
        kind: "kaizen-stale",
        target: ".kaizen",
        detail: "pending のまま 30 日を過ぎた学び 1 件（上限 0 件）",
      },
      {
        kind: "kaizen-recurrence",
        target: "new.md",
        detail: "適用済みの x.md、y.md と同じ原因で再発した",
      },
    ]);
  });
});

describe("本文の表", () => {
  test("数えなかったときは、その旨だけを書く", () => {
    expect(kaizenTable(null, { now: NOW, config })).toEqual([
      "`.kaizen/` が無いので、kaizen の学びは数えなかった。",
      "",
    ]);
  });

  test("status ごとの件数と増減、期間の中の件数、古い pending、再発を書く", () => {
    const m = metrics(
      { "a.md": note("applied"), "p.md": note("pending"), "r.md": note("pending", ["a.md"]) },
      {
        "a.md": [ev(40, "pending"), ev(38, "applied")],
        "p.md": [ev(35, "pending")],
        "r.md": [ev(1, "pending")],
      },
    );
    const text = kaizenTable(m, { now: NOW, config }).join("\n");
    expect(text).toContain("| pending | 2 | 1 | +1 |");
    expect(text).toContain("| applied | 1 | 1 | 0 |");
    expect(text).toContain("直近 7 日に記録した学び: 1 件、適用した学び: 0 件、忘却した学び: 0 件");
    expect(text).toContain("適用までの日数の中央値: 2.0 日（今 applied の 1 件）");
    expect(text).toContain("pending のまま 30 日を過ぎた学び: `p.md`");
    expect(text).toContain("適用した後に同じ原因で再発した学び: 1 件（直近 7 日に 1 件）");
    expect(text).toContain("frontmatter から status を読めなかった学びの変更 0 件は読み飛ばした。");
    const skipped = kaizenTable({ ...m, skippedLines: 2 }, { now: NOW, config }).join("\n");
    expect(skipped).toContain(
      "frontmatter から status を読めなかった学びの変更 2 件は読み飛ばした。",
    );
  });

  test("適用した学びも古い pending も無ければ、そう書く", () => {
    const text = kaizenTable(metrics({}, {}), { now: NOW, config }).join("\n");
    expect(text).toContain("適用までの日数の中央値: 適用した学びが無い（今 applied の 0 件）");
    expect(text).toContain("pending のまま 30 日を過ぎた学び: 無し");
  });
});

describe("まとめて数える", () => {
  test("学びのディレクトリが無ければ、git を呼ばずに null", async () => {
    const calls: string[] = [];
    const run: Runner = async (command) => {
      calls.push(command);
      return "";
    };
    const root = makeTempDir("kaizen-learnings-");
    expect(await collectKaizen(run, { root, now: NOW, config })).toBeNull();
    expect(calls).toEqual([]);
  });

  test("実際の git の履歴（merge・名前の変更・制御文字を含む学び）から数える", async () => {
    const root = makeTempDir("kaizen-learnings-git-");
    buildHistory(root);
    const m = await collectKaizen(defaultRunner, { root, now: NOW, config });
    expect(m?.counts).toEqual({ pending: 2, applied: 1, forgotten: 0, rejected: 0 });
    expect(m?.previous).toEqual({ pending: 1, applied: 1, forgotten: 0, rejected: 0 });
    expect(m?.daysToApply).toEqual({ median: 10, notes: 1 });
    // ctl の本文の `status: applied` は frontmatter の外にあるので、読み飛ばしにも数えず、ctl は pending のまま数える。
    expect(m?.skippedLines).toBe(0);
    // merge の 2 つ目の親（topic）との差分には a の `+status: applied` があるが、main に入った変更ではないので読まない。
    const { events } = parseStatusLog(await statusLog(defaultRunner, root, ".kaizen"), ".kaizen");
    expect(statuses(events.get("2026-10-01-a.md"))).toEqual(["pending", "applied"]);
    expect(m?.recurrences.map((r) => [r.name, r.of])).toEqual([
      ["2026-11-01-b.md", ["2026-10-01-a.md"]],
    ]);
  });
});

/**
 * 学びの履歴を持つリポジトリを作る。a は 20 日前に記録し、15 日前に名前を変え、10 日前に適用し、1 日前に archive へ移す。
 * ctl は本文に制御文字と、frontmatter の外の status の行を含む（--text が無いと git が binary として扱い、差分を出さない）。
 * b は branch で 3 日前に記録し、2 日前に main へ merge する（merge commit の差分にだけ現れる）。
 */
function buildHistory(root: string): void {
  const git = gitAt(root, NOW);
  initRepo(git);
  writeFiles(root, {
    ".kaizen/2026-10-02-a.md": noteText("pending"),
    // 本文の例として、frontmatter の外に status の行も書く。
    ".kaizen/2026-10-03-ctl.md": `${noteText("pending")}\u0001\n${"\n".repeat(40)}status: applied\n`,
  });
  git(["add", "-A"], 20);
  git(["commit", "-qm", "seed"], 20);
  git(["mv", ".kaizen/2026-10-02-a.md", ".kaizen/2026-10-01-a.md"], 15);
  git(["commit", "-qm", "rename"], 15);
  git(["branch", "topic"], 10);
  writeFiles(root, { ".kaizen/2026-10-01-a.md": noteText("applied") });
  git(["commit", "-qam", "apply"], 10);
  git(["switch", "-q", "topic"], 3);
  writeFiles(root, {
    ".kaizen/2026-11-01-b.md": noteText("pending", ["recurrence-of: [2026-10-01-a.md]"]),
  });
  git(["add", "-A"], 3);
  git(["commit", "-qm", "recur"], 3);
  git(["switch", "-q", "main"], 2);
  git(["merge", "-q", "--no-ff", "-m", "merge", "topic"], 2);
  mkdirSync(join(root, ".kaizen/archive"));
  git(["mv", ".kaizen/2026-10-01-a.md", ".kaizen/archive/2026-10-01-a.md"], 1);
  git(["commit", "-qm", "archive"], 1);
}
