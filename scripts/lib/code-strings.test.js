// 文字列の取り出し（code-strings）の回帰テスト。
//
// 状態空間の軸（取り出しの判定に使う入力）と、各セルに置いた入力:
//
// | 軸               | 値                                                                                      |
// | ---------------- | --------------------------------------------------------------------------------------- |
// | ファイル         | .js / .mjs / .cjs / .ts / evals/<name>/evals.json / 他の JSON / 他の拡張子                |
// | 文字列の形       | 文字列リテラル / 式の無いテンプレート / テンプレートの先頭・途中・末尾 / import・export の指定子 |
// | evals.json のキー | prompt / expected_output / assertions / 他のキー（fixture など）/ evals の外 / 形の違う値   |
// | 文字の種類       | 日本語を含む / 英語だけ                                                                  |
// | 改行             | ソースの改行（テンプレート）/ エスケープ（`\n`）/ 改行なし                                  |
// | Markdown の書式  | `<` / 3 つ以上のバッククォート・チルダ / 行頭の空白                                         |
// | ディレクティブ   | textlint-disable・enable（単独の行 / 行の後ろ）                                           |
// | 読めない入力     | JSON の構文エラー                                                                        |
import { describe, expect, test } from "vitest";
import { hasStrings, stringMarkdown } from "./code-strings.js";

/** Markdown の段落ごとの本文（空行で分ける）。 */
const paragraphs = (path, source) =>
  stringMarkdown(path, source)
    .markdown.split(/\n\n/)
    .map((p) => p.trim())
    .filter(Boolean);

/** 指定した文字列が Markdown のどこに来たかを、元のファイルの行と桁（どちらも 1 始まり）で返す。 */
function locate(path, source, needle) {
  const { markdown, lines, columns } = stringMarkdown(path, source);
  const mdLines = markdown.split("\n");
  const i = mdLines.findIndex((l) => l.includes(needle));
  if (i < 0) return null;
  return { line: lines[i] + 1, column: columns[i] + mdLines[i].indexOf(needle) + 1 };
}

/** 元のファイルで指定した文字列が始まる行と桁（どちらも 1 始まり）。 */
function sourcePosition(source, needle) {
  const all = source.split("\n");
  const line = all.findIndex((l) => l.includes(needle));
  return { line: line + 1, column: all[line].indexOf(needle) + 1 };
}

const evalsJson = (evals) => JSON.stringify({ skill_name: "x", evals }, null, 2);

describe("対象のファイル", () => {
  test.each([
    ["a.js", true],
    ["a.mjs", true],
    ["a.cjs", true],
    ["a.ts", true],
    ["evals/x/evals.json", true],
    ["evals/x/other.json", false],
    ["other/evals.json", false],
    ["evals/x/fixtures/evals/y/evals.json", false],
    ["a.sh", false],
    ["a.md", false],
  ])("%s → %s", (path, expected) => {
    expect(hasStrings(path)).toBe(expected);
  });

  test("対象外のファイルは例外にする", () => {
    expect(() => stringMarkdown("a.sh", 'echo "説明"\n')).toThrow("文字列を取り出せないファイル");
  });
});

describe("JavaScript・TypeScript", () => {
  test("文字列リテラルとテンプレートの各部分を、それぞれ別の段落にする", () => {
    const src =
      'const a = "一つ目の文";\nconst b = `二つ目の文`;\nconst c = `三つ目 ${a} 四つ目 ${b} 五つ目`;\n';
    expect(paragraphs("a.js", src)).toEqual([
      "一つ目の文",
      "二つ目の文",
      "三つ目",
      "四つ目",
      "五つ目",
    ]);
  });

  test("TypeScript の型注釈があっても文字列を取り出す", () => {
    expect(paragraphs("a.ts", 'const m: string = "型のある文";\n')).toEqual(["型のある文"]);
  });

  test("import と export の指定子は見ない", () => {
    const src =
      'import x from "./日本語.js";\nexport { y } from "./別の日本語.js";\nconst a = "本文";\n';
    expect(paragraphs("a.mjs", src)).toEqual(["本文"]);
  });

  test("日本語を含まない文字列は入れない", () => {
    expect(paragraphs("a.js", 'const a = "english only";\nconst b = "日本語";\n')).toEqual([
      "日本語",
    ]);
  });

  test("日本語を含まなくても、一覧にある英語の語（`fail-closed` など）を含む文字列は入れる", () => {
    // textlint-disable
    const src = 'const a = "fail-closed";\nconst b = "Fail open";\nconst c = "fail-closedness";\n';
    expect(paragraphs("a.js", src)).toEqual(["fail-closed", "Fail open"]);
    // textlint-enable
  });

  test("エスケープを解いた値を見る", () => {
    expect(paragraphs("a.js", 'const a = "\\u65e5\\u672c";\n')).toEqual(["日本"]);
  });
});

describe("位置", () => {
  test("文字列の値の行と桁を、元のファイルの行と桁に戻す", () => {
    const src = 'const x = 1;\nconsole.log("説明の文");\n';
    expect(locate("a.js", src, "説明")).toEqual(sourcePosition(src, "説明"));
  });

  test("テンプレートの途中と末尾の部分も、元の桁に戻す", () => {
    const src = "const t = `先頭 ${x} 途中 ${y} 末尾`;\n";
    for (const needle of ["先頭", "途中", "末尾"]) {
      expect(locate("a.js", src, needle), needle).toEqual(sourcePosition(src, needle));
    }
  });

  test("ソースの改行を含むテンプレートは、行ごとに元の行と桁に戻す（行頭の空白を外しても桁がずれない）", () => {
    const src = "const t = `一行目\n    二行目\n三行目`;\n";
    for (const needle of ["一行目", "二行目", "三行目"]) {
      expect(locate("a.js", src, needle), needle).toEqual(sourcePosition(src, needle));
    }
  });

  test("エスケープの改行は、すべて文字列が始まる行に戻す", () => {
    const src = 'const x = 1;\nconst a = "一行目\\n二行目";\n';
    expect(locate("a.js", src, "二行目").line).toBe(2);
  });

  test("エスケープの改行とソースの改行が混在するテンプレートは、ソースの改行だけ行を進める", () => {
    const src = "const t = `一行目\\n二行目\n三行目`;\nconst c = 1;\n";
    expect(locate("a.js", src, "二行目").line).toBe(1);
    expect(locate("a.js", src, "三行目")).toEqual(sourcePosition(src, "三行目"));
  });

  test("行の継続（\\ と改行）は値に改行を作らないが、後の部分の行を進める", () => {
    const src = "const t = `一行目\\\n継続\n三行目`;\n";
    expect(locate("a.js", src, "三行目")).toEqual(sourcePosition(src, "三行目"));
  });
});

describe("Markdown の書式", () => {
  test("< を空白にして、HTML のコメントとして読ませない", () => {
    const [first] = paragraphs("a.js", 'const a = "<!-- textlint-disable --> の説明";\n');
    expect(first).not.toContain("<");
    expect(first).toContain("textlint-disable --> の説明");
  });

  test("3 つ以上のバッククォートとチルダを空白にして、コードフェンスとして読ませない", () => {
    const src = 'const a = "```text の説明";\nconst b = "~~~ の説明";\nconst c = "後の文";\n';
    const ps = paragraphs("a.js", src);
    expect(ps.join("\n")).not.toMatch(/`{3}|~{3}/);
    expect(ps).toContain("後の文");
  });

  test("1 つのバッククォートは残す（字義どおりの言及として見ないため）", () => {
    expect(paragraphs("a.js", 'const a = "`語` の説明";\n')).toEqual(["`語` の説明"]);
  });

  test("行頭の空白を外して、字下げのコードブロックとして読ませない", () => {
    const { markdown } = stringMarkdown("a.js", "const t = `\n        字下げした行`;\n");
    expect(markdown.split("\n").filter((l) => /^\s/.test(l))).toEqual([]);
    expect(markdown).toContain("字下げした行");
  });
});

describe("ディレクティブ", () => {
  test("コメントだけの行の textlint-disable と textlint-enable を、文字列の間の位置に置く", () => {
    const src =
      'const a = "前の文";\n// textlint-disable\nconst b = "囲んだ文";\n// textlint-enable\nconst c = "後の文";\n';
    expect(paragraphs("a.js", src)).toEqual([
      "前の文",
      "<!-- textlint-disable -->",
      "囲んだ文",
      "<!-- textlint-enable -->",
      "後の文",
    ]);
  });

  test("行の後ろのコメントはディレクティブとして読まない", () => {
    const src = 'const a = "前の文"; // textlint-disable\nconst b = "後の文";\n';
    expect(paragraphs("a.js", src)).toEqual(["前の文", "後の文"]);
  });

  test("テンプレートの中の // textlint-disable はディレクティブとして読まない", () => {
    const src = 'const t = `\n// textlint-disable\n`;\nconst b = "後の文";\n';
    expect(paragraphs("a.js", src)).toEqual(["後の文"]);
  });
});

describe("evals.json", () => {
  test("prompt・expected_output・assertions だけを取り出す", () => {
    const src = evalsJson([
      {
        id: 1,
        prompt: "依頼の文",
        expected_output: "期待の文",
        fixture: "evals/x/fixtures/日本語",
        files: ["日本語のファイル"],
        assertions: ["一つ目の条件", "二つ目の条件"],
      },
    ]);
    expect(paragraphs("evals/x/evals.json", src)).toEqual([
      "依頼の文",
      "期待の文",
      "一つ目の条件",
      "二つ目の条件",
    ]);
  });

  test("evals の外と、形の違う値は見ない", () => {
    const src = JSON.stringify({
      skill_name: "日本語の名前",
      prompt: "外の文",
      evals: [
        { id: 1, prompt: 1, assertions: "文字列の条件" },
        "要素が文字列",
        { prompt: "中の文" },
      ],
    });
    expect(paragraphs("evals/x/evals.json", src)).toEqual(["中の文"]);
  });

  test("evals が配列でなければ何も取り出さない", () => {
    expect(stringMarkdown("evals/x/evals.json", '{ "evals": { "prompt": "文" } }').markdown).toBe(
      "",
    );
  });

  test("値の行を、元のファイルの行に戻す", () => {
    const src = evalsJson([{ id: 1, prompt: "依頼の文", assertions: ["条件の文"] }]);
    expect(locate("evals/x/evals.json", src, "条件").line).toBe(sourcePosition(src, "条件").line);
  });

  test("JSON の構文エラーは例外にする", () => {
    expect(() => stringMarkdown("evals/x/evals.json", '{ "evals": [')).toThrow(
      "JSON として読めない",
    );
  });
});
