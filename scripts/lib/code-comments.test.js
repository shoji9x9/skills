// コメントの取り出し（code-comments）の回帰テスト。
//
// 状態空間の軸（取り出しの判定に使う入力）と、各セルに置いた入力:
//
// | 軸                   | 値                                                                                     |
// | -------------------- | -------------------------------------------------------------------------------------- |
// | 言語                 | JavaScript（.js/.mjs/.cjs）/ TypeScript / シェル / YAML / 対象外の拡張子                 |
// | コメントの形         | 行コメント / ブロックコメント / JSDoc / 行の後ろのコメント / 空のコメント行              |
// | コメントに見える文字 | 文字列 / テンプレート / 正規表現 / 引用符の中 / `${#x}`・`$#` / heredoc の本文 / here-string / URL の `#` / エスケープした `\#` / 複数行の引用符 |
// | 行頭の特殊な行       | シバン（1 行目 / 2 行目以降）                                                           |
// | 段落の分け方         | 続く行 / 間にコードの行 / 行の後ろのコメントの前後 / コメントの中の空行                  |
// | 文字の種類           | 日本語を含む段落 / 英語だけの段落                                                       |
// | ディレクティブ       | textlint-disable・enable（単独の行 / 段落の途中）                                       |
// | 位置                 | 行番号・桁（行コメント / `/**` / ` * ` / シェル / YAML）                                  |
import { describe, expect, test } from "vitest";
import { COMMENT_EXTENSIONS, commentMarkdown, hasComments } from "./code-comments.js";

/** Markdown の段落ごとの本文（空行で分ける）。 */
const paragraphs = (path, source) =>
  commentMarkdown(path, source).markdown.split(/\n\n/).filter(Boolean);

/** 指定した文字列が Markdown のどこに来たかを、元のファイルの行と桁（どちらも 1 始まり）で返す。 */
function locate(path, source, needle) {
  const { markdown, lines, columns } = commentMarkdown(path, source);
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

describe("対象の拡張子", () => {
  test.each(COMMENT_EXTENSIONS)("%s はコメントを持つ", (ext) => {
    expect(hasComments(`a/b${ext}`)).toBe(true);
  });
  test.each(["a.md", "a.json", "a.txt", "Makefile", ".js"])("%s は対象にしない", (path) => {
    expect(hasComments(path)).toBe(false);
  });
  test("対象外の拡張子を渡すと例外にする", () => {
    expect(() => commentMarkdown("a.json", "{}")).toThrow("拡張子");
  });
});

describe("JavaScript・TypeScript", () => {
  test("行コメントとブロックコメントを取り出し、記号を外す", () => {
    const src = "// 行の説明。\nconst a = 1;\n/*\n * 塊の説明。\n * 続き。\n */\nconst b = 2;\n";
    expect(paragraphs("a.js", src)).toEqual(["行の説明。", "塊の説明。\n続き。"]);
  });

  test("文字列・テンプレート・正規表現の中の // と /* は取り出さない", () => {
    const src = [
      'const s = "// 文字列の中";',
      "const t = `/* テンプレートの中 */ ${s}`;",
      "const r = /\\/\\/ 正規表現の中/;",
      "// 本物のコメント。",
    ].join("\n");
    expect(paragraphs("a.mjs", src)).toEqual(["本物のコメント。"]);
  });

  test("シバンは取り出さない", () => {
    expect(paragraphs("a.js", "#!/usr/bin/env node\n// 説明。\n")).toEqual(["説明。"]);
  });

  test("TypeScript の型注釈があっても取り出せる", () => {
    const src = "// 型の説明。\nconst a: Record<string, number> = {};\n";
    expect(paragraphs("a.ts", src)).toEqual(["型の説明。"]);
  });

  test("JSDoc のタグと型はタグの名前のインラインコードにし、タグの行ごとに段落を分ける", () => {
    const src =
      "/**\n * 説明。\n * @param {{ a?: string }} options 渡す値\n *   続きの説明\n * @returns 結果\n */\n";
    expect(paragraphs("a.js", src)).toEqual([
      "説明。",
      "`@param` options 渡す値\n  続きの説明",
      "`@returns` 結果",
    ]);
  });

  test("/** 以外のコメントの行頭の @ はタグとして扱わない", () => {
    expect(paragraphs("a.js", "// @import の説明。\n/* @see の説明。 */\n")).toEqual([
      "@import の説明。\n@see の説明。",
    ]);
  });

  test("型の括弧が次の行以降で閉じるなら、閉じるところまでを型として置き換える", () => {
    const src =
      "/**\n * @returns {{ a: string,\n *   b: { c: number } }} 結果の説明\n * 続きの説明。\n */\n";
    expect(paragraphs("a.js", src)).toEqual(["`@returns`\n`型` 結果の説明\n続きの説明。"]);
  });

  test("位置: 型の続きの行の後ろの文章も、元の行と桁に戻す", () => {
    const src = "/**\n * @param {{\n *   a: string }} options 後ろの語\n */\n";
    expect(locate("a.js", src, "後ろの語")).toEqual(sourcePosition(src, "後ろの語"));
  });

  test("続く行は 1 段落、間にコードの行があれば別の段落にする", () => {
    const src = "// 一つ目。\n// 続き。\nconst a = 1;\n// 二つ目。\n";
    expect(paragraphs("a.js", src)).toEqual(["一つ目。\n続き。", "二つ目。"]);
  });

  test("行の後ろのコメントは、前後のコメントと別の段落にする", () => {
    const src = "// 前の説明。\nconst a = 1; // 後ろの説明。\n// 次の説明。\n";
    expect(paragraphs("a.js", src)).toEqual(["前の説明。", "後ろの説明。", "次の説明。"]);
  });

  test.each([
    ["両側の記号", "// --- 設定の解決 ---"],
    ["記号だけ", "// ======"],
    ["後ろの記号", "// 設定の解決 ----"],
  ])("区切りの行（%s）は前後の行と別の段落にする", (_, rule) => {
    const got = paragraphs("a.js", `// 前の説明。\n${rule}\n// 次の説明。\n`);
    expect(got).toContain("前の説明。");
    expect(got).toContain("次の説明。");
  });

  test("コメントの中の空行で段落を分ける", () => {
    expect(paragraphs("a.js", "// 一つ目。\n//\n// 二つ目。\n")).toEqual(["一つ目。", "二つ目。"]);
    expect(paragraphs("a.js", "/*\n * 一つ目。\n *\n * 二つ目。\n */\n")).toEqual([
      "一つ目。",
      "二つ目。",
    ]);
  });

  test("日本語を含まない段落は入れない", () => {
    const src =
      "// oxlint-disable-next-line no-console, no-alert, eqeqeq, curly\nconst a = 1;\n// 説明。\n";
    expect(paragraphs("a.js", src)).toEqual(["説明。"]);
  });

  test("段落の中に英語の行があっても、日本語を含む段落は丸ごと入れる", () => {
    expect(paragraphs("a.js", "// 説明。\n// see https://example.com\n")).toEqual([
      "説明。\nsee https://example.com",
    ]);
  });

  test("位置: JSDoc のタグの後ろの文章も、元の行と桁に戻す", () => {
    const src = "/**\n * @param {string} a 後ろの語\n */\n// @returns 行の語\n";
    for (const needle of ["後ろの語", "行の語"]) {
      expect(locate("a.js", src, needle)).toEqual(sourcePosition(src, needle));
    }
  });

  test("JSDoc の本文の // を別のコメントとして二重に取り出さない", () => {
    const src = "/**\n * 説明。\n * @param {string} a //の後ろ\n */\nexport function f(a) {}\n";
    expect(paragraphs("a.js", src)).toEqual(["説明。", "`@param` a //の後ろ"]);
  });

  test("英語だけの JSDoc は、次の行に続く型を置き換えても入れない", () => {
    const src =
      "/**\n * Load the config.\n * @returns {{\n *   root: string }} the config\n */\nexport function f() {}\n// 説明。\n";
    expect(paragraphs("a.js", src)).toEqual(["説明。"]);
  });

  test("行の先頭の太字（**）の * はブロックコメントの記号として外さない", () => {
    expect(paragraphs("a.js", "/*\n **太字** の説明。\n */\n")).toEqual(["**太字** の説明。"]);
  });

  test("空のブロックコメント /**/ は何も残さない", () => {
    // 次の行のコメントと 1 段落になる形にして、残った文字が本文に入るかを見る。
    expect(paragraphs("a.js", "/**/\n// 次の説明。\n")).toEqual(["次の説明。"]);
  });

  test("位置: 行コメント・ブロックコメントの 1 行目・2 行目以降を元の行と桁に戻す", () => {
    const src = "const a = 1; // 後ろの語\n/** 先頭の語\n * 続きの語\n */\n";
    for (const needle of ["後ろの語", "先頭の語", "続きの語"]) {
      expect(locate("a.js", src, needle)).toEqual(sourcePosition(src, needle));
    }
  });
});

describe("シェル", () => {
  test("行頭と空白の後の # をコメントにする", () => {
    const src = '# 一つ目。\necho "x" # 後ろの説明。\n';
    expect(paragraphs("a.sh", src)).toEqual(["一つ目。", "後ろの説明。"]);
  });

  test("; や && の直後の # もコメントにする", () => {
    expect(paragraphs("a.sh", "echo a;# 区切りの後。\n")).toEqual(["区切りの後。"]);
  });

  test("シバンは 1 行目だけ外し、2 行目以降の #! は外さない", () => {
    expect(paragraphs("a.sh", "#!/bin/bash\n# 説明。\n")).toEqual(["説明。"]);
    expect(paragraphs("a.sh", "echo\n#!説明。\n")).toEqual(["!説明。"]);
  });

  test.each([
    ["一重引用符", "echo 'a # 引用の中'"],
    ["二重引用符", 'echo "a # 引用の中"'],
    ["エスケープした二重引用符の後", 'echo "a\\" # 引用の中"'],
    ["エスケープした空白の後", "echo a\\ # 語の途中"],
    ["${#x}", "echo ${#arr[@]}本の中"],
    ["$#", "[ $# -eq 0 ] && echo 本の中"],
    ["語の途中", "echo a#b中"],
  ])("%s の # はコメントにしない", (_, line) => {
    expect(paragraphs("a.sh", `${line}\n`)).toEqual([]);
  });

  test.each([
    ["二重引用符の中の置換の中の引用", 'x="$(echo "it\'s")"'],
    ["置換の中の括弧", 'x="$(f (a) "it\'s")"'],
    ["引用の外の置換の中の引用", 'x=$(echo "it\'s")'],
  ])("%s のあとのコメントも取り出す", (_, line) => {
    expect(paragraphs("a.sh", `${line}\n# 後の説明。\n`)).toEqual(["後の説明。"]);
  });

  test.each([
    ["then の後", 'x="$(if true; then case "$a" in b) echo "it\'s" ;; esac; fi)"'],
    ["do の後", 'x="$(for v in 1; do case "$a" in b) echo "it\'s" ;; esac; done)"'],
    ["{ の後", 'x="$({ case "$a" in b) echo "it\'s" ;; esac; })"'],
  ])("%s の case も数える", (_, line) => {
    expect(paragraphs("a.sh", `${line}\n# 後の説明。\n`)).toEqual(["後の説明。"]);
  });

  test.each([
    ["|", "esac|tr a b"],
    ["&&", "esac&&echo"],
    [">", "esac>out"],
  ])("直後に %s が続く esac も数える", (_, tail) => {
    const src = `x="$(case "$a" in b) echo b ;; ${tail})"\ny=1 # 本物。\nz="a # 引用の中"\n`;
    expect(paragraphs("a.sh", src)).toEqual(["本物。"]);
  });

  test.each([
    ["閉じていない引用", 'x="abc\n# 引用の中\n'],
    ["閉じていない置換", "x=$(echo a\n# 中\n"],
    ["区切りの行が無い heredoc", "cat <<EOF\n# 本文\n"],
  ])("終わりで %s が残れば例外にする", (_, src) => {
    expect(() => commentMarkdown("a.sh", src)).toThrow("判定できない");
  });

  test("; の後の case も数え、その分岐の ) で置換を閉じない", () => {
    const src = 'x="$(a=1; case "$a" in b) echo "it\'s" ;; esac)"\n# 後の説明。\n';
    expect(paragraphs("a.sh", src)).toEqual(["後の説明。"]);
  });

  test("置換の中の case の分岐の ) で置換を閉じない", () => {
    const src = 'x="$(case "$a" in\n  b) echo "it\'s" ;;\nesac)"\n# 後の説明。\n';
    expect(paragraphs("a.sh", src)).toEqual(["後の説明。"]);
  });

  test.each([
    ["引数の case", 'x="$(echo case)"'],
    ["ファイル名の case", 'x="$(cat case.txt)"'],
    ["コマンド名の case.sh", 'x="$(case.sh a)"'],
    [
      "分岐の本体の引数の esac",
      'x="$(case "$a" in\n  b) echo esac ;;\n  c) echo "it\'s" ;;\nesac)"',
    ],
  ])("%s は case の構文として数えない", (_, src) => {
    expect(paragraphs("a.sh", `${src}\ny=1 # 本物。\nz="a # 引用の中"\n`)).toEqual(["本物。"]);
  });

  test("置換を閉じた後の二重引用符の中の # はコメントにしない", () => {
    expect(paragraphs("a.sh", 'x="$(echo a) # 引用の中"\n# 後の説明。\n')).toEqual(["後の説明。"]);
  });

  test("複数行にまたがる引用の中の # はコメントにしない", () => {
    const src = 'msg="1 行目\n# 引用の中\n"\n# 外の説明。\n';
    expect(paragraphs("a.sh", src)).toEqual(["外の説明。"]);
  });

  test.each([
    ["引用符で囲んだ区切り", "cat <<'EOF'\n# 本文の中\nEOF\n"],
    ["二重引用符で囲んだ区切り", 'cat <<"EOF"\n# 本文の中\nEOF\n'],
    ["囲まない区切り", "cat <<EOF\n# 本文の中\nEOF\n"],
    ["タブを外す区切り", "cat <<-EOF\n\t# 本文の中\n\tEOF\n"],
    ["コマンド置換の中", "x=$(cat <<'PY'\n# 本文の中\nPY\n)\n"],
    ["バックスラッシュで引用した区切り", "cat <<\\EOF\n# 本文の中\nEOF\n"],
  ])("heredoc の本文（%s）はコメントにしない", (_, src) => {
    expect(paragraphs("a.sh", `${src}# 後の説明。\n`)).toEqual(["後の説明。"]);
  });

  test("CRLF の heredoc でも、区切りの行で本文が終わる", () => {
    expect(paragraphs("a.sh", "cat <<EOF\r\n# 本文の中\r\nEOF\r\n# 後の説明。\r\n")).toEqual([
      "後の説明。",
    ]);
  });

  test("区切りの名前に - や . を含む heredoc も、その名前の行で終わる", () => {
    expect(paragraphs("a.sh", "cat <<'END-X.1'\n# 本文の中\nEND-X.1\n# 後の説明。\n")).toEqual([
      "後の説明。",
    ]);
  });

  test("$'...' の中のエスケープした ' で引用を閉じない", () => {
    expect(paragraphs("a.sh", "echo $'it\\'s # 引用の中'\n# 後の説明。\n")).toEqual(["後の説明。"]);
  });

  test.each([
    ["$(( ))", "x=$((1 << 2))\n"],
    ["(( ))", "(( x <<= 1 ))\n"],
  ])("算術（%s）の中の << は heredoc として扱わない", (_, src) => {
    expect(paragraphs("a.sh", `${src}# 後の説明。\n`)).toEqual(["後の説明。"]);
  });

  test("here-string（<<<）は heredoc として扱わない", () => {
    // 2 文字目の `<` から読むと、続く EOF を区切りの名前として拾ってしまう形にする。
    expect(paragraphs("a.sh", "read x <<<EOF\n# 説明。\n")).toEqual(["説明。"]);
  });

  test("区切りの行と同じ行の後ろのコメントは取り出す", () => {
    expect(paragraphs("a.sh", "cat <<'EOF' # 後ろの説明。\nbody\nEOF\n")).toEqual(["後ろの説明。"]);
  });

  test("位置: 行頭と行の後ろのコメントを元の行と桁に戻す", () => {
    const src = "# 先頭の語\necho x # 後ろの語\n";
    for (const needle of ["先頭の語", "後ろの語"]) {
      expect(locate("a.sh", src, needle)).toEqual(sourcePosition(src, needle));
    }
  });
});

describe("YAML", () => {
  test("行頭と空白の後の # をコメントにし、ブロックスカラーの中のシェルのコメントも取り出す", () => {
    const src = "# 一つ目。\nkey: value # 後ろの説明。\nrun: |\n  # シェルの説明。\n  echo x\n";
    expect(paragraphs("a.yml", src)).toEqual(["一つ目。", "後ろの説明。", "シェルの説明。"]);
  });

  test.each([
    ["一重引用符", "key: 'a # 引用の中'"],
    ["二重引用符", 'key: "a # 引用の中"'],
    ["エスケープした二重引用符の後", 'key: "a\\" # 引用の中"'],
    ["URL の #", "url: https://example.com/#見出し"],
  ])("%s の # はコメントにしない", (_, line) => {
    expect(paragraphs("a.yaml", `${line}\n`)).toEqual([]);
  });

  test.each([
    ["フローの配列", 'a: ["x # 引用の中"]'],
    ["フローの対応", "a: {k: 'x # 引用の中'}"],
    ["フローの区切りの後", 'a: [1,"x # 引用の中"]'],
  ])("%s の引用の中の # はコメントにしない", (_, line) => {
    expect(paragraphs("a.yml", `${line}\n`)).toEqual([]);
  });

  test("一重引用符の中の '' は引用の終わりにしない", () => {
    expect(paragraphs("a.yml", "a: 'it''s # 引用の中' # 後ろの説明\n")).toEqual(["後ろの説明"]);
  });

  test("語の中の ' は引用の始まりにしない（後ろのコメントを取り出す）", () => {
    expect(paragraphs("a.yaml", "key: it's # 説明の中\n")).toEqual(["説明の中"]);
  });

  test("位置: 行の後ろのコメントを元の行と桁に戻す", () => {
    const src = "a: 1\nb: 2 # 後ろの語\n";
    expect(locate("a.yml", src, "後ろの語")).toEqual(sourcePosition(src, "後ろの語"));
  });
});

describe("textlint-disable・enable", () => {
  test("単独の行のディレクティブを Markdown のコメントにし、前後の段落と分ける", () => {
    const src = "// 前の説明。\n// textlint-disable\n// 字義どおりの語。\n// textlint-enable\n";
    expect(paragraphs("a.js", src)).toEqual([
      "前の説明。",
      "<!-- textlint-disable -->",
      "字義どおりの語。",
      "<!-- textlint-enable -->",
    ]);
  });

  test("ディレクティブだけの段落は、日本語を含まなくても入れる", () => {
    expect(paragraphs("a.sh", "# textlint-disable\n")).toEqual(["<!-- textlint-disable -->"]);
  });

  test("文の中にある textlint-disable はディレクティブにしない", () => {
    expect(paragraphs("a.js", "// textlint-disable を使う。\n")).toEqual([
      "textlint-disable を使う。",
    ]);
  });
});
