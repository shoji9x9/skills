#!/usr/bin/env node
// 変異実証の件数・全件の所要時間を、散文のドキュメントへ書き戻していないか検査する（lefthook pre-commit + CI）。
//
// なぜ要るか: 変異の総数と全件の実測値は宣言を足すたびに変わる。AGENTS.md や rule に書くと、
// 書いた時点の値が残ったまま実態と離れる（98 → 376 → 504 → 569 と変わり、そのたびに複数箇所が古くなった）。
// 実測値は `.github/workflows/mutation-proof.yml` のコメント 1 箇所にだけ置く方針にしたので、
// それ以外の散文へ再び書いたら落とす。
//
// 判定規則（対象は `AGENTS.md`・`.agents/rules/**/*.md`・`docs/**/*.md`・`.github/workflows/*.{yml,yaml}`。
// ワークフローはコメントが散文にあたる。実測値の置き場である `mutation-proof.yml` だけを除く）:
// - 件数: 「<数> 変異」「<数> 件の変異」「変異 <数> 件」「変異数 <数>」「<数> mutations」。
//   ただし数が 1 のものは通す——「1 変異 = 対象テストファイル 1 回の実行」は総数ではなく単位の定義で、
//   実際の文書にある件数表記はこの形だけだった。2 以上は宣言 1 つぶんの説明でも件数そのものが腐るので落とす。
//   後置の「変異 <数> 件」は間に助詞・読点を挟む形（「変異は 42 件」「変異が 42 件」「変異、42 件」）も含む。
//   単位が「件」でないもの（「変異は 3 通り」「変異を 2 回」）は件数ではないので当てない。
// - 所要時間: 同じ文（`。` か改行まで）の中で「全件」の後に来る「<数> 秒 / 分 / 時間」。
//   過去に書かれていた形（「全件は手元実測 1036 秒」「全件は手元実測で約 6.5 分」）を捕まえる。
//   現状の対象文書にこの形は 0 件（「実測で 30 分以上」のような暴走時の記述は「全件」を伴わないので当たらない）。
//   「6 分割」「3 分の 2」の「分」は時間ではないので当てない。
// - 全角数字は NFKC で半角に揃えてから数える。コードフェンスの中も対象にする（出力例に書いた件数も同じく腐る）。
//
// 対象ファイル 0 件は成功に倒さない。
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 対象: ルート直下のファイルと、配下を再帰で走査するディレクトリ。
export const TARGET_FILES = ["AGENTS.md"];
export const TARGET_DIRS = [".agents/rules", "docs"];
// ワークフローは直下の YAML だけ（GitHub Actions はサブディレクトリを読まない）。
export const WORKFLOW_DIR = ".github/workflows";
// 実測値の唯一の置き場なので、ここに書いた件数・所要時間は正本であって再導入ではない。
export const MEASUREMENTS_FILE = ".github/workflows/mutation-proof.yml";

// 数は語の先頭からだけ取る。`#` の直後（Issue / PR 番号）や英数字・小数点の直後から取ると、
// 「PR #509 変異実証」のような番号の後に「変異」が続く文を件数と読んで落とす。
const NUM_LEAD = "(?<![#\\w.,])";
const NUM = `${NUM_LEAD}(\\d[\\d,]*(?:\\.\\d+)?)`;
const COUNT_PATTERNS = [
  new RegExp(`${NUM}\\s*(?:件の)?変異`, "g"),
  // 後置は「変異」と数の間に助詞（は が も を の）・読点を挟む形も拾う（「変異は 42 件」「変異、42 件」）。
  new RegExp(`変異\\s*(?:[はがもをの]\\s*)?(?:、\\s*)?${NUM}\\s*件`, "g"),
  new RegExp(`変異(?:の総数|の数|数)\\s*[:：は]?\\s*(?:約\\s*)?${NUM}`, "g"),
  new RegExp(`${NUM}\\s*mutations?\\b`, "gi"),
];
const DURATION_RE = new RegExp(
  `全件[^。\\n]*?${NUM}\\s*(?:秒|分(?![割の])|時間|sec(?:onds?)?\\b|min(?:utes?)?\\b)`,
  "g",
);

const isOne = (n) => n === "1";

/** 1 ファイルの本文から違反（行番号と一致した字面）を列挙する。 */
export function findMentions(text) {
  const hits = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.normalize("NFKC");
    for (const re of COUNT_PATTERNS) {
      for (const m of line.matchAll(re)) {
        if (!isOne(m[1])) hits.push({ line: i + 1, kind: "件数", text: m[0] });
      }
    }
    for (const m of line.matchAll(DURATION_RE)) {
      hits.push({ line: i + 1, kind: "所要時間", text: m[0] });
    }
  });
  return hits;
}

function walkMarkdown(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMarkdown(p));
    else if (e.name.endsWith(".md") && statSync(p).isFile()) out.push(p);
  }
  return out;
}

/** 対象ファイル（ルートからの相対パス、ソート済み）。 */
export function targetFiles(root) {
  const files = TARGET_FILES.filter((f) => existsSync(join(root, f)));
  for (const d of TARGET_DIRS) {
    const abs = join(root, d);
    if (existsSync(abs)) files.push(...walkMarkdown(abs).map((p) => relative(root, p)));
  }
  const wf = join(root, WORKFLOW_DIR);
  if (existsSync(wf)) {
    for (const e of readdirSync(wf, { withFileTypes: true })) {
      const rel = `${WORKFLOW_DIR}/${e.name}`;
      if (/\.ya?ml$/.test(e.name) && e.isFile() && rel !== MEASUREMENTS_FILE) files.push(rel);
    }
  }
  return files.sort();
}

/**
 * @param {string} root リポジトリルート（テストでは一時ディレクトリ）
 * @returns {{ files: string[], violations: string[] }}
 */
export function checkMutationCountProse(root) {
  const files = targetFiles(root);
  const violations = [];
  for (const file of files) {
    for (const { line, kind, text } of findMentions(readFileSync(join(root, file), "utf8"))) {
      violations.push(`${file}:${line}: 変異実証の${kind}「${text}」`);
    }
  }
  return { files, violations };
}

export function main(argv) {
  const root = argv.filter((a) => a !== "--")[0] ?? process.cwd();
  const { files, violations } = checkMutationCountProse(root);
  if (files.length === 0) {
    console.error(
      `mutation-count-prose: 対象ファイルが 0 件（${resolve(root)}）。0 件は「違反なし」ではない。`,
    );
    return 1;
  }
  if (violations.length) {
    console.error(
      `mutation-count-prose: ${files.length} 件を走査し、${violations.length} 件の件数・所要時間の記述:`,
    );
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      "Fix: 変異の件数と全件の実測値は .github/workflows/mutation-proof.yml のコメントにだけ置き、" +
        "散文からはそこを指す（例:「実測値は mutation-proof.yml のコメント」）。",
    );
    return 1;
  }
  console.log(`mutation-count-prose: OK（${files.length} 件）`);
  return 0;
}

// CLI エントリ判定は両辺を実パスへ揃える（片側だけの解決は symlink 経由の起動でサイレント no-op になる）。
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    console.error(`mutation-count-prose: 起動パスを正規化できない: ${error.message}`);
    process.exit(1);
  }
}

if (isCliEntry()) process.exit(main(process.argv.slice(2)));
