// self-review-fix.ts（週次のセルフ点検の指摘を直す PR の、候補の選択・差分の検査・PR の扱い）のテスト。
//
// | 軸 | 値 |
// | --- | --- |
// | 直してよいパス | docs/ の Markdown（深さ 1・2）/ README.md / evals/<name>/README.md / AGENTS.md / skills/ / .agents/rules/ / docs/ の .ts / `..`・`.`・空の区切り / evals の深い README |
// | 候補の選択 | 直せる項目 / 直せない項目（overcheck・eval・actions）/ 無いファイル（canary）/ 同じ組が 2 件 / 上限を超える |
// | 候補の JSON | 正しい / 配列でない / 直せない項目 / 直してよくないパス / summary が無い |
// | エージェントの結果 | 正しい / JSON でない / 配列でない / 候補に無い / 同じ候補を 2 回 / 理由が空 |
// | git status | 内容の変更（` M`・`M `・`MM`）/ 追跡していない / 追加 / 削除 / 名前の変更 |
// | 変えたファイルと結果 | 一致 / 直したと書いていないファイルを変えた / 直したと書いたのに変わっていない / 直してよいファイルの外を変えた |
// | PR の状態 | 無い / コンフリクト / 人のレビュー / 人のコメント / ほかの bot のコメント / 目印のコメントが上限未満・上限 / ほかの bot の目印 |
// | 本文 | 日付の形でない / 指摘の文に @name / 直さなかった指摘がある・無い |
// | CLI | 知らないコマンド / select / check の不一致（1）|
import { describe, expect, test } from "vitest";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Candidate,
  type PrState,
  UPDATE_MARKER,
  WEEKS_LIMIT,
  changedFiles,
  checkChanges,
  decide,
  formatPr,
  isAllowedPath,
  main,
  parseCandidates,
  parseResult,
  selectCandidates,
} from "./self-review-fix.ts";
import type { Finding } from "./self-review-issue.ts";
import { makeTempDir } from "../lib/testing/test-tmpdir.ts";

const finding = (over: Partial<Finding> = {}): Finding => ({
  category: "inconsistency",
  path: "docs/a.md",
  summary: "要約",
  evidence: "根拠",
  suggestion: "案",
  ...over,
});

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  category: "inconsistency",
  path: "docs/a.md",
  summary: "要約",
  suggestion: "案",
  ...over,
});

const BOT = "app/skills-autofix";

describe("直してよいパス", () => {
  test.each(["docs/a.md", "docs/sub/b.md", "README.md", "evals/box/README.md"])(
    "%s は直してよい",
    (p) => {
      expect(isAllowedPath(p)).toBe(true);
    },
  );
  test.each([
    "AGENTS.md",
    "skills/box/SKILL.md",
    ".agents/rules/x.md",
    "docs/a.ts",
    "docs/../AGENTS.md",
    "docs/./a.md",
    "docs//a.md",
    "evals/box/sub/README.md",
  ])("%s は直してよくない", (p) => {
    expect(isAllowedPath(p)).toBe(false);
  });
});

describe("候補の選択", () => {
  const exists = (p: string): boolean => p !== "docs/release-notes-1a2b.md";

  test("直せる項目で、直してよい、在るファイルの指摘だけを残す", () => {
    const findings = [
      finding(),
      finding({ category: "overcheck", path: "docs/b.md" }),
      finding({ category: "eval", path: "evals/box/README.md" }),
      finding({ category: "actions", path: "docs/c.md" }),
      finding({ category: "wording", path: "AGENTS.md" }),
      finding({ category: "unused", path: "docs/release-notes-1a2b.md" }),
      finding({ category: "overdoc", path: "README.md" }),
    ];
    expect(selectCandidates(findings, exists).map((c) => `${c.category} ${c.path}`)).toEqual([
      "inconsistency docs/a.md",
      "overdoc README.md",
    ]);
  });

  test("同じ組は 1 件にまとめる", () => {
    const got = selectCandidates([finding({ summary: "1" }), finding({ summary: "2" })], exists);
    expect(got).toEqual([candidate({ summary: "1 / 2", suggestion: "案 / 案" })]);
  });

  test("上限の 10 件までにする", () => {
    const many = Array.from({ length: 12 }, (_, i) => finding({ path: `docs/f${i}.md` }));
    expect(selectCandidates(many, exists)).toHaveLength(10);
  });
});

describe("候補の JSON", () => {
  test("正しい候補を読む", () => {
    expect(parseCandidates(JSON.stringify([candidate()]))).toEqual([candidate()]);
  });
  test.each([
    { name: "配列でない", value: {} },
    { name: "直せない項目", value: [candidate({ category: "overcheck" })] },
    { name: "直してよくないパス", value: [candidate({ path: "AGENTS.md" })] },
    { name: "summary が無い", value: [{ ...candidate(), summary: undefined }] },
  ])("$name は例外にする", ({ value }) => {
    expect(() => parseCandidates(JSON.stringify(value))).toThrow();
  });
});

describe("エージェントの結果", () => {
  const candidates = [candidate(), candidate({ path: "docs/b.md" })];
  const a = { category: "inconsistency", path: "docs/a.md" };
  const b = { category: "inconsistency", path: "docs/b.md" };

  test("直した候補と、直さなかった候補と理由を読む", () => {
    const got = parseResult(
      JSON.stringify({ applied: [a], skipped: [{ ...b, reason: "理由\nです" }] }),
      candidates,
    );
    expect(got).toEqual({
      applied: ["inconsistency docs/a.md"],
      skipped: [{ key: "inconsistency docs/b.md", reason: "理由 です" }],
    });
  });

  test.each([
    { name: "JSON でない", source: "{" },
    { name: "applied が配列でない", source: JSON.stringify({ applied: {}, skipped: [] }) },
    {
      name: "候補に無い",
      source: JSON.stringify({
        applied: [{ category: "inconsistency", path: "docs/c.md" }],
        skipped: [],
      }),
    },
    {
      name: "同じ候補を 2 回",
      source: JSON.stringify({ applied: [a], skipped: [{ ...a, reason: "r" }] }),
    },
    { name: "理由が空", source: JSON.stringify({ applied: [], skipped: [{ ...b, reason: " " }] }) },
  ])("$name は例外にする", ({ source }) => {
    expect(() => parseResult(source, candidates)).toThrow();
  });
});

describe("git status", () => {
  test("内容の変更のファイルを返す", () => {
    expect(changedFiles(" M docs/a.md\0M  docs/b.md\0MM README.md\0")).toEqual([
      "docs/a.md",
      "docs/b.md",
      "README.md",
    ]);
  });
  test.each([
    { name: "追跡していない", status: "?? docs/new.md\0" },
    { name: "追加", status: "A  docs/new.md\0" },
    { name: "削除", status: " D docs/a.md\0" },
    { name: "名前の変更", status: "R  docs/b.md\0docs/a.md\0" },
  ])("$name は例外にする", ({ status }) => {
    expect(() => changedFiles(status)).toThrow("内容の変更でない");
  });
});

describe("変えたファイルと結果の突き合わせ", () => {
  const candidates = [candidate(), candidate({ path: "docs/b.md" })];
  const result = { applied: ["inconsistency docs/a.md"], skipped: [] };

  test("一致すれば通す", () => {
    expect(() => checkChanges(["docs/a.md"], result, candidates)).not.toThrow();
  });
  test("直したと書いていないファイルを変えたら例外にする", () => {
    expect(() => checkChanges(["docs/a.md", "docs/b.md"], result, candidates)).toThrow(
      "直したと書いていない",
    );
  });
  test("直したと書いたのに変わっていなければ例外にする", () => {
    expect(() => checkChanges([], result, candidates)).toThrow("変わっていない");
  });
  test("直してよいファイルの外を変えたら例外にする", () => {
    expect(() => checkChanges(["docs/a.md", "AGENTS.md"], result, candidates)).toThrow(
      "直してよいファイルの外",
    );
  });
});

describe("PR の扱い", () => {
  const pr = (over: Partial<NonNullable<PrState>> = {}): PrState => ({
    number: 7,
    mergeable: "MERGEABLE",
    reviews: [],
    comments: [],
    ...over,
  });
  const marker = (login = BOT): { author: { login: string }; body: string } => ({
    author: { login },
    body: `${UPDATE_MARKER}\n本文`,
  });

  test("open の PR が無ければ作る", () => {
    expect(decide(null, BOT).action).toBe("create");
  });
  test("コンフリクトしていれば commit を足さない", () => {
    expect(decide(pr({ mergeable: "CONFLICTING" }), BOT).action).toBe("hold");
  });
  test("人のレビューがあれば commit を足さない", () => {
    expect(decide(pr({ reviews: [{ author: { login: "someone" } }] }), BOT).action).toBe("hold");
  });
  test("人のコメントがあれば commit を足さない", () => {
    expect(
      decide(pr({ comments: [{ author: { login: "someone" }, body: "x" }] }), BOT).action,
    ).toBe("hold");
  });
  test("ほかの bot のコメントとレビューは人として数えない", () => {
    const got = decide(
      pr({
        reviews: [{ author: { login: "copilot-pull-request-reviewer[bot]" } }],
        comments: [{ author: { login: "app/chatgpt-codex-connector" }, body: "x" }],
      }),
      BOT,
    );
    expect(got.action).toBe("update");
  });
  test(`目印のコメントが ${WEEKS_LIMIT - 1} 件なら commit を足す`, () => {
    const comments = Array.from({ length: WEEKS_LIMIT - 1 }, () => marker());
    expect(decide(pr({ comments }), BOT).action).toBe("update");
  });
  test(`目印のコメントが ${WEEKS_LIMIT} 件なら追加をやめる`, () => {
    const comments = Array.from({ length: WEEKS_LIMIT }, () => marker());
    expect(decide(pr({ comments }), BOT).action).toBe("stop");
  });
  test("ほかの bot が書いた目印は数えない", () => {
    const comments = Array.from({ length: WEEKS_LIMIT }, () => marker("app/other"));
    expect(decide(pr({ comments }), BOT).action).toBe("update");
  });
});

describe("PR の本文とコメント", () => {
  const candidates = [candidate({ summary: "@someone を呼ぶ" }), candidate({ path: "docs/b.md" })];
  const result = {
    applied: ["inconsistency docs/a.md"],
    skipped: [{ key: "inconsistency docs/b.md", reason: "判断が要る" }],
  };

  test("直した指摘と直さなかった指摘を書き、指摘の文をコードスパンに入れる", () => {
    const { body, comment } = formatPr({ candidates, result, date: "2026-11-10", tracking: 952 });
    expect(body).toContain("#952");
    expect(comment.startsWith(UPDATE_MARKER)).toBe(true);
    expect(comment).toContain("- inconsistency docs/a.md: ` @someone を呼ぶ `");
    expect(comment).toContain("- inconsistency docs/b.md: ` 判断が要る `");
  });
  test("日付の形でなければ例外にする", () => {
    expect(() => formatPr({ candidates, result, date: "11/10", tracking: undefined })).toThrow(
      "日付",
    );
  });
});

describe("CLI", () => {
  test("知らないコマンドは 2", () => {
    expect(main(["other"])).toBe(2);
  });

  test("select で候補を書き、check で変えたファイルの不一致を 1 にする", () => {
    const dir = makeTempDir("self-review-fix-");
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs/a.md"), "# a\n");
    const report = join(dir, "report.json");
    writeFileSync(
      report,
      JSON.stringify({ findings: [finding(), finding({ path: "docs/gone.md" })], notes: [] }),
    );
    const out = join(dir, "candidates.json");
    expect(main(["select", "--report", report, "--root", dir, "--out", out])).toBe(0);
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual([candidate()]);

    const res = join(dir, "result.json");
    writeFileSync(
      res,
      JSON.stringify({ applied: [{ category: "inconsistency", path: "docs/a.md" }], skipped: [] }),
    );
    const status = join(dir, "status");
    writeFileSync(status, " M docs/a.md\0");
    expect(main(["check", "--candidates", out, "--result", res, "--status", status])).toBe(0);
    writeFileSync(status, "");
    expect(main(["check", "--candidates", out, "--result", res, "--status", status])).toBe(1);
  });
});
