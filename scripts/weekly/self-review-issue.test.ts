// self-review-issue.ts（週次のセルフ点検の結果から追跡 Issue を作る）のテスト。
//
// | 軸 | 値 |
// | --- | --- |
// | 結果の JSON | 正しい / JSON でない / オブジェクトでない / findings が配列でない / notes が配列でない |
// | 指摘 | 正しい / category が知らない値・無い / path・summary・evidence が空 / suggestion が無い・空 / 改行を含む |
// | 同じ組 | 1 件 / 同じ category と path が 2 件（まとめる）/ category だけ違う（分ける） |
// | canary | path で当たる / 存在しないスクリプトの path で当たる / 内容だけで当たる（残すが、見つけたことにしない）/ 当たらない（例外）/ 指摘が canary だけ（0 件として出す）/ メモで触れる（残す） |
// | 載せる文 | @name を含む / メモに < を含む |
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
  codeSpan,
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
          { ...finding(), suggestion: null },
          { ...finding(), suggestion: "" },
          { ...finding(), suggestion: " \n" },
        ],
        notes: ["メモ"],
      }),
    );
    expect(report.findings).toEqual([
      finding({ summary: "1 行目 2 行目" }),
      finding({ suggestion: "" }),
      finding({ suggestion: "" }),
      finding({ suggestion: "" }),
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
      name: "資格情報の形の文字列",
      source: JSON.stringify({ findings: [{ ...finding(), evidence: "sk-ant-oat01-abcdefghij" }] }),
      message: "findings[0].evidence に資格情報の形の文字列がある",
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
  const report = (findings: Finding[], notes: string[] = []) => ({ findings, notes });

  test("path が canary の指摘を除く", () => {
    expect(dropCanary(report([finding(), canaryFinding]), CANARY)).toEqual(report([finding()]));
  });

  test("canary が書いた存在しないスクリプトを対象にした指摘も除く", () => {
    const byScript = finding({ path: "scripts/tools/verify-notes-1a2b.ts" });
    expect(dropCanary(report([byScript, finding()]), CANARY)).toEqual(report([finding()]));
  });

  test("内容で canary に触れた、別のファイルへの指摘とメモは、そのまま残す", () => {
    const both = finding({ path: "docs/", summary: `${CANARY} と docs/old.md が参照されていない` });
    const notes = [`${CANARY} は迷った`];
    expect(dropCanary(report([canaryFinding, both], notes), CANARY)).toEqual(report([both], notes));
  });

  test("指摘が canary だけなら 0 件にする", () => {
    expect(dropCanary(report([canaryFinding]), CANARY)).toEqual(report([]));
  });

  test.each([
    { name: "指摘が 0 件", findings: [] },
    { name: "canary 以外だけ", findings: [finding()] },
    { name: "内容で触れただけ", findings: [finding({ evidence: `Glob の結果: ${CANARY}` })] },
  ])("$name なら、点検が機能していないとして例外にする", ({ findings }) => {
    expect(() => dropCanary(report(findings), CANARY)).toThrow(`${CANARY} への指摘が無い`);
  });
});

describe("追跡 Issue の本文", () => {
  const findings = [finding({ summary: "a | b" }), finding({ category: "unused", path: "x.sh" })];

  test("表・メモ・識別子を書き、エージェントの文はコードスパンに入れ、表の | をエスケープする", () => {
    const body = formatBody({ findings, notes: ["迷ったもの"] });
    expect(body).toContain("指摘: 2 件");
    expect(body).toContain(
      "| 文書の食い違い・重複 | docs/a.md | ` a \\| b ` | ` 根拠 ` | ` 案 ` | 新規 |",
    );
    expect(body).toContain("- ` 迷ったもの `");
    expect(previousKeys(body)).toEqual(["inconsistency docs/a.md", "unused x.sh"]);
  });

  test.each([
    { name: "空", value: "", span: "" },
    { name: "バッククォートが無い", value: "a @b", span: "` a @b `" },
    { name: "バッククォートが 1 つ", value: "`cmd` を実行", span: "`` `cmd` を実行 ``" },
    { name: "バッククォートが 3 つ並ぶ", value: "```x", span: "```` ```x ````" },
  ])("コードスパンは、文の中のバッククォートより長い並びで囲む（$name）", ({ value, span }) => {
    expect(codeSpan(value)).toBe(span);
  });

  test("エージェントの文は、リテラルのまま表示するのでエスケープしない", () => {
    const summary = "@AGENTS.md と #508 と <details> と 2>&1 と https://github.com/o/r/issues/9";
    const parsed = parseReport(JSON.stringify({ findings: [{ ...finding(), summary }] }));
    expect(parsed.findings[0]?.summary).toBe(summary);
    expect(formatBody(parsed)).toContain(`\` ${summary} \``);
  });

  test.each(["docs/", ".github/workflows/ci.yml", "skills/a_b/c-d.md", "x.sh"])(
    "リポジトリのパスの形（%s）は受け付ける",
    (path) => {
      expect(
        parseReport(JSON.stringify({ findings: [{ ...finding(), path }] })).findings[0]?.path,
      ).toBe(path);
    },
  );

  test.each([
    "evals/<name>/x.md",
    "@user",
    "docs/#508",
    "[a](https://example.com)",
    "![x](https://example.com/p)",
    "docs/a b.md",
    "docs/a.md-->",
  ])(
    "対象のパスは識別子として載るので、パスに使わない文字（%s）の指摘は省き、件数をメモに書く",
    (path) => {
      const parsed = parseReport(
        JSON.stringify({ findings: [{ ...finding(), path }, finding()], notes: ["メモ"] }),
      );
      expect(parsed.findings).toEqual([finding()]);
      expect(parsed.notes).toEqual([
        "メモ",
        "対象のパスがリポジトリのパスの形（英数字・.・_・-・/）でない指摘を 1 件省いた",
      ]);
    },
  );

  test("指摘が 0 件の週は、点検のメモをコメントに載せる（Issue を閉じて本文を書き換えないため）", () => {
    expect(formatComment({ findings: [], notes: ["入力を読めなかった"] }, [])).toBe(
      "指摘: 0 件（新規 0 件・継続 0 件・前回から解消 0 件）\n\n点検のメモ:\n\n- ` 入力を読めなかった `\n",
    );
    expect(formatComment({ findings: [], notes: [] }, [])).not.toContain("点検のメモ");
    expect(formatComment({ findings: [finding()], notes: ["x"] }, [])).not.toContain("点検のメモ");
  });

  test("絵文字を途中で切らずに切り詰める", () => {
    const summary = `${"a".repeat(299)}😀😀`;
    const parsed = parseReport(JSON.stringify({ findings: [{ ...finding(), summary }] }));
    expect(parsed.findings[0]?.summary).toBe(`${"a".repeat(299)}😀…`);
  });

  test("1 欄を 300 字に、メモを 20 件に切り詰める", () => {
    const parsed = parseReport(
      JSON.stringify({
        findings: [{ ...finding(), summary: "長".repeat(400) }],
        notes: Array.from({ length: 25 }, (_, i) => `メモ ${i}`),
      }),
    );
    expect(parsed.findings[0]?.summary).toBe(`${"長".repeat(300)}…`);
    expect(parsed.notes).toHaveLength(20);
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
    expect(body).toContain("| ` 案 ` | 継続 |");
    expect(body).toContain("| 不要物 | x.sh |");
    expect(body).toContain("前回から解消したもの: overdoc AGENTS.md");
    expect(diffFindings(findings, previous).added).toEqual(["unused x.sh"]);
    expect(formatComment({ findings, notes: ["メモ"] }, previous)).toContain(
      "指摘: 2 件（新規 1 件・継続 1 件・前回から解消 1 件）",
    );
  });

  test.each([
    ["項目が知らない値", `["other a"]`],
    ["対象が空", `["unused "]`],
    ["対象がパスの形でない", `["unused @org/team"]`],
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
    const { root, args } = setup({
      findings: [finding(), canaryFinding],
      notes: ["残すメモ"],
    });
    const previous = join(root, "previous.md");
    writeFileSync(previous, `<!-- self-review:keys ["unused gone.md"] -->\n`);
    expect(main([...args, "--previous", previous])).toBe(0);
    const body = readFileSync(join(root, "b.md"), "utf8");
    expect(body).toContain("指摘: 1 件");
    expect(body).not.toContain(CANARY);
    expect(body).toContain("- ` 残すメモ `");
    expect(readFileSync(join(root, "c.md"), "utf8")).toContain("解消: unused gone.md");
  });

  test("指摘が 40 件を超えたら、表だけを切り詰め、前回との比較と識別子は全件で行う", () => {
    const many = Array.from({ length: 45 }, (_, i) => finding({ path: `docs/${i}.md` }));
    const { root, args } = setup({ findings: [canaryFinding, ...many] });
    const previous = join(root, "previous.md");
    writeFileSync(previous, `<!-- self-review:keys ["inconsistency docs/44.md"] -->\n`);
    expect(main([...args, "--previous", previous])).toBe(0);
    const body = readFileSync(join(root, "b.md"), "utf8");
    expect(body).toContain("指摘: 45 件");
    expect(body).toContain("表には、先頭の 40 件だけを載せた。");
    expect(body.split("\n").filter((l) => l.startsWith("| 文書の食い違い"))).toHaveLength(40);
    expect(previousKeys(body)).toHaveLength(45);
    expect(body).not.toContain("前回から解消したもの");
    expect(readFileSync(join(root, "c.md"), "utf8")).toContain("継続 1 件");
  });

  test.each([
    ["結果が JSON でない", "# report"],
    ["canary への指摘が無い", { findings: [finding()] }],
  ])("%s ときは 1", (_name, report) => {
    const { args } = setup(report);
    expect(main(args)).toBe(1);
  });
});
