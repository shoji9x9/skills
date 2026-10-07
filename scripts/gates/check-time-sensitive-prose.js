#!/usr/bin/env node
// 時間がたつと正しくなくなる記述を、Tier 1〜3 の文書とコメントに書いていないかチェックする（lefthook pre-commit + CI）。
// 経過は Tier 4（.kaizen/・Issue・PR）に書く（.agents/rules/doc-altitude.md）。規則は 2 つの群からなる。
//
// 1. 時間の語と日付（規則 time-word・date）
// - 対象は scripts/lib/doc-scan.js の走査対象（Tier 1〜3）。Markdown はコードフェンスとインラインコードを除いた本文、
//   それ以外のファイルはコメントの行（`//`・`/*`・`*`・`#` で始まる行と、行の途中の ` // `・`/*`・` # ` より後ろ）を読む。
//   `*` で始まる行は、式の継続行でもコメントとして読む（日付と時間の語が式に現れることはまず無い）。
// - time-word: 「現状は」「現状では」「現時点」「当面」。前が「の」（「実行環境の現状は」）か `「`（語として挙げた形）のものは除く。
// - date: 日付（例: 2026-09-28、2026/09/28、2026 年 9 月）。後ろに `-<名前>.md` が続くもの（学びのファイル名）は除く。
// - 例の行（scripts/lib/doc-scan.js の EXAMPLE_LINE_RE）は読まない。
// - 今ある違反は scripts/gates/doc-pending.json に保留として持ち、直したら消す（古い保留は失敗にする。--prune で消せる）。
//
// 2. ミューテーションテストの件数と全件の所要時間（規則 mutation-count。保留にしない）
// なぜ要るか: 変異の総数と全件の実測値は宣言を足すたびに変わる。AGENTS.md や rule に書くと、
// 書いた時点の値が残ったまま実態と離れる（98 → 376 → 504 → 569 と変わり、そのたびに複数箇所が古くなった）。
// 実測値は `.github/workflows/mutation-proof.yml` のコメント 1 箇所にだけ置く方針にしたので、
// それ以外の散文へ再び書いたら落とす。
//
// 対象は `AGENTS.md`・`.agents/rules/**/*.md`・`docs/**/*.md`・`.github/workflows/*.{yml,yaml}`。
// ワークフローはコメントが散文にあたる。実測値の置き場である `mutation-proof.yml` だけを除く。
// 配布スキル（`skills/**`）・README.md・CLAUDE.md は対象にしない。配布スキルの「変異」「全件」は、導入先の
// 故障注入や全件実行（例: parity-suite の「全件の 2 回実行…約 35 分」）を指し、このリポジトリの
// ミューテーションテストの実測値ではない。対象に含めると、別の概念の記述を誤検知する（実測）。
// README / CLAUDE.md は、ミューテーションテストの運用を書かない（AGENTS.md に書く）。
// 判定規則は次のとおり。
// - 件数: 「<数> 変異」「<数> 件の変異」「変異 <数> 件」「変異数 <数>」「<数> mutations」。
//   ただし数が 1 のものは通す。「1 変異 = 対象テストファイル 1 回の実行」は総数ではなく単位の定義で、
//   実際の文書にある件数表記はこの形だけだった。2 以上は、宣言 1 つぶんの説明でも件数そのものが古くなるので落とす。
//   後置の「変異 <数> 件」は間に助詞・読点を挟む形（「変異は 42 件」「変異が 42 件」「変異、42 件」）も含む。
//   単位が「件」でないもの（「変異は 3 通り」「変異を 2 回」）は件数ではないので当てない。
// - 所要時間: 同じ文（`。` か改行まで）の中で「全件」の後に来る「<数> 秒 / 分 / 時間」。
//   過去に書かれていた形（「全件は手元実測 1036 秒」「全件は手元実測で約 6.5 分」）を捕まえる。
//   現状の対象文書にこの形は 0 件（「実測で 30 分以上」のような暴走時の記述は「全件」を伴わないので当たらない）。
//   「6 分割」「3 分の 2」の「分」は時間ではないので当てない。
// - 全角数字は NFKC で半角に揃えてから数える。コードフェンスの中も対象にする（出力例に書いた件数も同じく腐る）。
//
// 対象ファイル 0 件は成功として扱わない。
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyPending,
  blankInlineCode,
  EXAMPLE_LINE_RE,
  fencedLines,
  loadPending,
  prunePending,
  scannedFiles,
} from "../lib/doc-scan.js";

// 対象: ルート直下のファイルと、配下を再帰で走査するディレクトリ。
export const TARGET_FILES = ["AGENTS.md"];
export const TARGET_DIRS = [".agents/rules", "docs"];
// ワークフローは直下の YAML だけ（GitHub Actions はサブディレクトリを読まない）。
export const WORKFLOW_DIR = ".github/workflows";
// 実測値の唯一の置き場なので、ここに書いた件数・所要時間は原本であって再導入ではない。
export const MEASUREMENTS_FILE = ".github/workflows/mutation-proof.yml";

// 数は語の先頭からだけ取る。`#` の直後（Issue / PR 番号）や英数字・小数点の直後から取ると、
// 「PR #509 変異の実証」のような、番号の後に「変異」が続く文を件数と読んで落とす。
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
      violations.push(`${file}:${line}: ミューテーションテストの${kind}「${text}」`);
    }
  }
  return { files, violations };
}

// ---- 時間の語と日付 ----

export const TIME_RULES = ["time-word", "date"];
// このチェック自身のテストとミューテーションテストの定義は、違反の fixture を本文に持つので読まない。
export const SELF_FIXTURES = [
  "scripts/gates/check-time-sensitive-prose.test.js",
  "scripts/gates/check-time-sensitive-prose.mutations.json",
];

const TIME_WORD_RE = /(?<![の「])(?:現状は|現状では|現時点|当面)/g;
const DATE_RE =
  /(?<![\w-])(?:20\d\d-\d\d-\d\d(?![\w-]*\.md)|20\d\d\/\d\d\/\d\d|20\d\d\s*年\s*\d{1,2}\s*月)/g;
const SLASH_COMMENT_EXT_RE = /\.(?:[cm]?[jt]sx?|[cm]ts)$/;
const HASH_COMMENT_EXT_RE = /\.(?:sh|ya?ml)$/;

/**
 * 1 ファイルのうち、散文として読む部分を行ごとに返す（読まない行は null）。
 * Markdown はコードフェンスの外の本文、それ以外はコメントの部分。
 */
export function proseLines(file, text) {
  const lines = text.split(/\r?\n/);
  if (file.endsWith(".md")) {
    const fenced = fencedLines(lines);
    return lines.map((l, i) => (fenced[i] ? null : blankInlineCode(l)));
  }
  const slash = SLASH_COMMENT_EXT_RE.test(file);
  const hash = HASH_COMMENT_EXT_RE.test(file);
  if (!slash && !hash) return lines.map(() => null);
  return lines.map((l) => {
    const t = l.trimStart();
    if (slash && (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")))
      return blankInlineCode(l);
    if (hash && t.startsWith("#") && !t.startsWith("#!")) return blankInlineCode(l);
    const tail = slash ? /\s\/\/\s|\/\*/.exec(l) : /\s#\s/.exec(l);
    return tail ? blankInlineCode(l.slice(tail.index)) : null;
  });
}

/** 時間の語と日付を列挙する。 */
export function findTimeMentions(file, text) {
  const out = [];
  proseLines(file, text).forEach((line, i) => {
    if (line === null || EXAMPLE_LINE_RE.test(line)) return;
    for (const m of line.matchAll(TIME_WORD_RE))
      out.push({ line: i + 1, rule: "time-word", text: m[0] });
    for (const m of line.matchAll(DATE_RE)) out.push({ line: i + 1, rule: "date", text: m[0] });
  });
  return out;
}

/**
 * @param {string} root
 * @returns {{ files: number, found: object[], failures: string[], pendingCount: number, stale: object[] }}
 */
export function checkTimeWords(root) {
  const list = loadPending(root);
  const files = scannedFiles(root, { exclude: SELF_FIXTURES });
  const found = [];
  for (const { file } of files) {
    const text = readFileSync(join(root, file), "utf8");
    for (const v of findTimeMentions(file, text)) found.push({ file, ...v });
  }
  return { files: files.length, found, ...applyPending(found, list, TIME_RULES) };
}

export function main(argv) {
  const args = argv.filter((a) => a !== "--");
  const prune = args.includes("--prune");
  const root = args.find((a) => !a.startsWith("--")) ?? process.cwd();
  const { files, violations } = checkMutationCountProse(root);
  if (files.length === 0) {
    console.error(
      `time-sensitive-prose: ミューテーションテストの件数の対象ファイルが 0 件（${resolve(root)}）。0 件は「違反なし」ではない。`,
    );
    return 1;
  }
  let time;
  try {
    time = checkTimeWords(root);
  } catch (error) {
    console.error(`time-sensitive-prose: チェックできない: ${error.message}`);
    return 2;
  }
  if (time.files === 0) {
    console.error("time-sensitive-prose: 時間の語と日付の対象ファイルが 0 件。列挙できていない");
    return 2;
  }
  let failures = time.failures;
  if (prune && time.stale.length) {
    console.log(`time-sensitive-prose: 古い保留を ${prunePending(root, time.stale)} 件消した`);
    failures = failures.filter((f) => !f.startsWith("古い保留: "));
  }
  if (violations.length) {
    console.error(
      `time-sensitive-prose: ${files.length} 件を走査し、${violations.length} 件の件数・所要時間の記述:`,
    );
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      "Fix: 変異の件数と全件の実測値は .github/workflows/mutation-proof.yml のコメントにだけ置き、" +
        "散文からはそこを指す（例:「実測値は mutation-proof.yml のコメント」）。",
    );
  }
  if (failures.length) {
    console.error(
      `time-sensitive-prose: ${time.files} 件を走査し、${failures.length} 件の時間の語・日付:`,
    );
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      "Fix: 時点や経過は Tier 4（.kaizen/・Issue・PR）に書き、文書からは消す。" +
        "後の段階で直すものだけを scripts/gates/doc-pending.json の pending に、正しい記述は allowed に理由付きで書く。",
    );
  }
  if (violations.length || failures.length) return 1;
  console.log(
    `time-sensitive-prose: OK（ミューテーションテストの件数 ${files.length} 件、時間の語と日付 ${time.files} 件。保留 ${time.pendingCount} 件）`,
  );
  return 0;
}

// CLI エントリ判定は両辺を実パスへ揃える（片側だけの解決は symlink 経由の起動でサイレント no-op になる）。
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    console.error(`time-sensitive-prose: 起動パスを正規化できない: ${error.message}`);
    process.exit(1);
  }
}

if (isCliEntry()) process.exit(main(process.argv.slice(2)));
