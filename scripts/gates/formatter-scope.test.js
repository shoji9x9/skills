// 整形ツールが、引数でディレクトリを渡されても、割り当てた種類のファイルだけを書き換えるかの回帰テスト。
//
// 整形ツールは渡された範囲を自分の判断で整形する。markdownlint-cli2 --fix にディレクトリを渡すと .mjs・.png・.yml まで
// 書き換え、oxfmt は .md・.css・.html・.toml も整形した（実測）。どう渡されたか（ディレクトリ・glob・コマンド置換）を
// 呼び出し側で見分けるのではなく、ツールの設定で書き換える種類を閉じている。ここでは実物のツールに実際の設定を読ませ、
// 割り当て外の種類が変わらないこと（と、割り当てた種類は変わること）を確かめる。
//
// fixture はリポジトリの外の一時ディレクトリに置き、設定をそこへコピーする（scripts/ の下に置くと、他のテストの走査に入る）。
// リポジトリの外では mise の shim の node が版を決められないので、ツールの本体を process.execPath で起動する。
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { makeTempDir } from "../lib/test-tmpdir.js";
import oxfmtConfig from "../../oxfmt.config.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(join(repoRoot, "package.json"));

/** パッケージの bin の本体（node で起動するファイル）の絶対パス。 */
function binOf(pkg, name) {
  // markdownlint-cli2 は package.json を exports に出していないので、本体の main から package.json を探す。
  let dir = dirname(req.resolve(pkg));
  for (;;) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      const json = JSON.parse(readFileSync(manifest, "utf8"));
      if (json.name === pkg) {
        return join(dir, typeof json.bin === "string" ? json.bin : json.bin[name]);
      }
    }
    if (dirname(dir) === dir) throw new Error(`${pkg} の package.json が見つからない`);
    dir = dirname(dir);
  }
}

// どの種類も、そのツールが整形すれば必ず変わる内容にする。
const FILES = {
  "a.md": "#title\n\ntext   \n",
  // 名前にドットを 2 つ以上含む Markdown も、markdownlint-cli2 の対象から外さない（`**/*.!(md)` だと外れた）。
  "x.ja.md": "#title\n\ntext   \n",
  "b.mjs": "export const x = 1  *  2\n",
  "c.yml": "a:   1\n",
  "e.json": '{"a":1,\n"b":   2}\n',
  "x.css": "a  {color:red}\n",
  "x.toml": "a  =   1\n",
  "x.html": "<div  ><p >x</p></div>\n",
  "x.png": "#title\n",
  // 名前にドットを含むディレクトリの中も、割り当てた種類なら整形する（`**/*.*` がディレクトリに当たらないこと）。
  ".hidden/h.mjs": "export const y = 3  *  4\n",
};

function makeFixture() {
  const root = makeTempDir("formatter-scope-");
  for (const [rel, body] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, "d", rel)), { recursive: true });
    writeFileSync(join(root, "d", rel), body);
  }
  return root;
}

/** 書き換わったファイル（d/ からの相対パス）を並べて返す。 */
function changed(root) {
  return Object.keys(FILES)
    .filter((rel) => readFileSync(join(root, "d", rel), "utf8") !== FILES[rel])
    .sort();
}

// どのテストにも、ツールが動けば必ず書き換わるファイルを入れて、変わったファイルの集合で判定する。
// 起動に失敗して何も変えずに終わった実行を、「書き換えなかった」として合格にしないため。
// spawnSync は同期の呼び出しで vitest のタイムアウトが発火しないので、呼び出しごとにタイムアウトを付ける。
function run(root, bin, args) {
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (r.error) throw r.error;
  if (r.signal) throw new Error(`${bin} が ${r.signal} で終わった: ${r.stderr}`);
  return r;
}

// ---- markdownlint-cli2 ----

const MARKDOWNLINT = binOf("markdownlint-cli2", "markdownlint-cli2");

// 設定の globs（`**/*.md`）は引数に足されるので、残すと引数に関わらず .md が整形され、
// 引数で渡した範囲の扱いを測れない。ignores などは実際の設定のまま、globs だけを外す。
function markdownlintFixture() {
  const root = makeFixture();
  const config = yaml.load(readFileSync(join(repoRoot, ".markdownlint-cli2.yaml"), "utf8"));
  if (!Array.isArray(config.ignores)) throw new Error(".markdownlint-cli2.yaml に ignores が無い");
  delete config.globs;
  writeFileSync(join(root, ".markdownlint-cli2.yaml"), yaml.dump(config));
  copyFileSync(join(repoRoot, ".markdownlint.yaml"), join(root, ".markdownlint.yaml"));
  return root;
}

test.each([
  ["ディレクトリ", ["--fix", "d/"], ["a.md", "x.ja.md"]],
  ["glob", ["--fix", "d/**"], ["a.md", "x.ja.md"]],
  // 渡さなかった a.md は変わらないこと（globs を外したので、整形されるのは引数の範囲だけ）も確かめる。
  [
    "Markdown と他の種類を並べたファイルの列挙",
    ["--fix", "d/x.ja.md", "d/b.mjs", "d/x.png", "d/c.yml"],
    ["x.ja.md"],
  ],
])(
  "markdownlint-cli2 --fix に%sを渡しても、書き換えるのは渡した範囲の .md だけ",
  (_name, args, expected) => {
    const root = markdownlintFixture();
    run(root, MARKDOWNLINT, args);
    expect(changed(root)).toEqual(expected);
  },
);

// ---- oxfmt ----

const OXFMT = binOf("oxfmt", "oxfmt");

function oxfmtFixture() {
  const root = makeFixture();
  // oxfmt.config.ts は import.meta.dirname を使うので、計算済みの設定を JSON にして置く。
  writeFileSync(join(root, ".oxfmtrc.json"), JSON.stringify(oxfmtConfig));
  return root;
}

const OXFMT_ASSIGNED = [".hidden/h.mjs", "b.mjs", "c.yml", "e.json"];

test.each([
  ["ディレクトリ", ["d/"]],
  ["カレントディレクトリ", ["."]],
])(
  "oxfmt に%sを渡しても、書き換えるのは割り当てた種類（JS・TS・JSON・YAML）だけ",
  (_name, args) => {
    const root = oxfmtFixture();
    run(root, OXFMT, args);
    expect(changed(root)).toEqual(OXFMT_ASSIGNED);
  },
);

test("oxfmt に Markdown を直接渡しても書き換えない（並べた JS だけを書き換える）", () => {
  const root = oxfmtFixture();
  run(root, OXFMT, ["d/a.md", "d/x.ja.md", "d/x.css", "d/b.mjs"]);
  expect(changed(root)).toEqual(["b.mjs"]);
});
