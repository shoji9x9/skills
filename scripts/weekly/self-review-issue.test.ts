// self-review-issue.ts（週次のセルフ点検の結果から追跡 Issue を作る）のテスト。
//
// | 軸 | 値 |
// | --- | --- |
// | 結果の JSON | 正しい / JSON でない / オブジェクトでない / findings が配列でない / notes が配列でない |
// | 指摘 | 正しい / category が知らない値・無い / path・summary・evidence が空 / suggestion が無い・空 / 改行を含む |
// | 同じ組 | 1 件 / 同じ category と path が 2 件（まとめる）/ category だけ違う（分ける） |
// | canary | path で当たる / 内容で当たる / 当たらない（例外）/ 指摘が canary だけ（0 件として出す） |
// | 前回の本文 | 目印なし / 継続と解消 / 識別子の形が違う |
// | CLI の引数 | 正しい / 足りない / 未知 / --previous が空 / 結果を読めない（1） |
import { describe, expect, test } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Finding,
  diffFindings,
  dropCanary,
  formatBody,
  formatComment,
  main,
  mergeFindings,
  parseReport,
  previousKeys,
} from "./self-review-issue.ts";
import { makeTempDir } from "../lib/testing/test-tmpdir.ts";

const CANARY = "docs/notes-1a2b.md";

const finding = (over: Partial<Finding> = {}): Finding => ({
  category: "inconsistency",
  path: "docs/a.md",
  summary: "要約",
  evidence: "根拠",
  suggestion: "案",
  ...over,
});

const canaryFinding = finding({ category: "unused", path: CANARY });

describe("結果の JSON", () => {
  test("指摘とメモを読み、改行を 1 行にまとめる", () => {
    const report = parseReport(
      JSON.stringify({
        findings: [
          { ...finding(), summary: "1 行目\n2 行目" },
          { ...finding(), suggestion: undefined },
        ],
        notes: ["メモ"],
      }),
    );
    expect(report.findings).toEqual([
      finding({ summary: "1 行目 2 行目" }),
      finding({ suggestion: "" }),
    ]);
    expect(report.notes).toEqual(["メモ"]);
  });

  test("notes が無ければ空にする", () => {
    expect(parseReport('{"findings": []}')).toEqual({ findings: [], notes: [] });
  });

  test.each([
    { name: "JSON でない", source: "# レポート", message: "JSON として読めない" },
    { name: "オブジェクトでない", source: "[]", message: "オブジェクトでない" },
    { name: "findings が無い", source: "{}", message: "findings が配列でない" },
    {
      name: "notes が文字列",
      source: '{"findings": [], "notes": "x"}',
      message: "notes が配列でない",
    },
    { name: "notes に空の文字列", source: '{"findings": [], "notes": [" "]}', message: "notes[0]" },
    {
      name: "category が知らない値",
      source: JSON.stringify({ findings: [{ ...finding(), category: "other" }] }),
      message: "findings[0].category が項目の値でない",
    },
    {
      name: "category が無い",
      source: JSON.stringify({ findings: [{ ...finding(), category: undefined }] }),
      message: "findings[0].category",
    },
    {
      name: "path が空",
      source: JSON.stringify({ findings: [{ ...finding(), path: "" }] }),
      message: "findings[0].path",
    },
    {
      name: "summary が無い",
      source: JSON.stringify({ findings: [{ ...finding(), summary: undefined }] }),
      message: "findings[0].summary",
    },
    {
      name: "evidence が空白だけ",
      source: JSON.stringify({ findings: [{ ...finding(), evidence: " \n" }] }),
      message: "findings[0].evidence",
    },
    {
      name: "suggestion が空",
      source: JSON.stringify({ findings: [{ ...finding(), suggestion: "" }] }),
      message: "findings[0].suggestion",
    },
    { name: "指摘がオブジェクトでない", source: '{"findings": ["x"]}', message: "findings[0] が" },
  ])("$name は例外にする", ({ source, message }) => {
    expect(() => parseReport(source)).toThrow(message);
  });
});

describe("同じ組の指摘", () => {
  test("同じ category と path は 1 件にまとめ、空の欄は足さない", () => {
    const merged = mergeFindings([
      finding({ summary: "A", suggestion: "" }),
      finding({ summary: "B", evidence: "根拠 2", suggestion: "案 2" }),
      finding({ category: "overdoc" }),
    ]);
    expect(merged).toEqual([
      finding({ summary: "A / B", evidence: "根拠 / 根拠 2", suggestion: "案 2" }),
      finding({ category: "overdoc" }),
    ]);
  });
});

describe("canary", () => {
  test("path が canary の指摘を除く", () => {
    expect(dropCanary([finding(), canaryFinding], CANARY)).toEqual([finding()]);
  });

  test("内容に canary のパスがある指摘も除く", () => {
    const byEvidence = finding({
      path: "scripts/tools/x.ts",
      evidence: `${CANARY}:3 に書いてある`,
    });
    expect(dropCanary([byEvidence, finding()], CANARY)).toEqual([finding()]);
  });

  test("指摘が canary だけなら 0 件にする", () => {
    expect(dropCanary([canaryFinding], CANARY)).toEqual([]);
  });

  test.each([
    { name: "指摘が 0 件", findings: [] },
    { name: "canary 以外だけ", findings: [finding()] },
  ])("$name なら、点検が機能していないとして例外にする", ({ findings }) => {
    expect(() => dropCanary(findings, CANARY)).toThrow(`${CANARY} への指摘が無い`);
  });
});

describe("追跡 Issue の本文", () => {
  const findings = [finding({ summary: "a | b" }), finding({ category: "unused", path: "x.sh" })];

  test("表・メモ・識別子を書き、表の | をエスケープする", () => {
    const body = formatBody({ findings, notes: ["迷ったもの"] });
    expect(body).toContain("指摘: 2 件");
    expect(body).toContain("| 文書の食い違い・重複 | docs/a.md | a \\| b | 根拠 | 案 | 新規 |");
    expect(body).toContain("- 迷ったもの");
    expect(previousKeys(body)).toEqual(["inconsistency docs/a.md", "unused x.sh"]);
  });

  test("0 件は表とメモを書かない", () => {
    const body = formatBody({ findings: [], notes: [] });
    expect(body).toContain("指摘: 0 件");
    expect(body).not.toContain("| 項目 |");
    expect(body).not.toContain("点検のメモ");
    expect(previousKeys(body)).toEqual([]);
  });

  test("前回と比べ、継続と解消を書く", () => {
    const previous = ["inconsistency docs/a.md", "overdoc AGENTS.md"];
    const body = formatBody({ findings, notes: [] }, previous);
    expect(body).toContain("| 案 | 継続 |");
    expect(body).toContain("| 不要物 | x.sh |");
    expect(body).toContain("前回から解消したもの: overdoc AGENTS.md");
    expect(diffFindings(findings, previous).added).toEqual(["unused x.sh"]);
    expect(formatComment(findings, previous)).toContain(
      "指摘: 2 件（新規 1 件・継続 1 件・前回から解消 1 件）",
    );
  });

  test.each([
    ["項目が知らない値", `["other a"]`],
    ["対象が空", `["unused "]`],
  ])("前回の識別子の %s ときは例外にする", (_name, json) => {
    expect(() => previousKeys(`<!-- self-review:keys ${json} -->\n`)).toThrow("識別子の形でない");
  });
});

describe("CLI", () => {
  const setup = (report: unknown) => {
    const root = makeTempDir("self-review-issue-");
    const reportPath = join(root, "report.json");
    writeFileSync(reportPath, typeof report === "string" ? report : JSON.stringify(report));
    const args = ["--report", reportPath, "--canary", CANARY, "--out", join(root, "b.md")];
    return { root, args: [...args, "--comment-out", join(root, "c.md")] };
  };

  test.each([
    ["引数なし", []],
    ["--canary が無い", ["--report", "r", "--out", "a", "--comment-out", "b"]],
    [
      "未知のオプション",
      ["--report", "r", "--canary", "c", "--out", "a", "--comment-out", "b", "--x", "y"],
    ],
    [
      "--previous が空",
      ["--report", "r", "--canary", "c", "--out", "a", "--comment-out", "b", "--previous", ""],
    ],
  ])("%s は 2", (_name, args) => {
    expect(main(args)).toBe(2);
  });

  test("本文とコメントを書き、canary を除いた件数を due に出す", () => {
    const { root, args } = setup({ findings: [finding(), canaryFinding] });
    const previous = join(root, "previous.md");
    writeFileSync(previous, `<!-- self-review:keys ["unused gone.md"] -->\n`);
    expect(main([...args, "--previous", previous])).toBe(0);
    const body = readFileSync(join(root, "b.md"), "utf8");
    expect(body).toContain("指摘: 1 件");
    expect(body).not.toContain(CANARY);
    expect(readFileSync(join(root, "c.md"), "utf8")).toContain("解消: unused gone.md");
  });

  test.each([
    ["結果が JSON でない", "# report"],
    ["canary への指摘が無い", { findings: [finding()] }],
  ])("%s ときは 1", (_name, report) => {
    const { args } = setup(report);
    expect(main(args)).toBe(1);
  });
});
