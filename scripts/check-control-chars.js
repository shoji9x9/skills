#!/usr/bin/env node
// テキストとして扱う拡張子の追跡ファイルに、制御バイトが混入していないか検査する
// （lefthook pre-commit はステージ差分、CI の Lint ジョブはリポジトリ全体）。
//
// なぜ要るか: ツール引数は JSON 文字列として解釈されるため、本文に書いた `NUL のエスケープ` は
// ツール層で制御文字へ復号され、そのままファイルへ書かれる。oxfmt・oxlint・`node --check` は
// いずれも NUL を含むソースを正常に扱うので、失敗として現れない。commit すると PR の差分が
// 「Binary file」になりレビュー不能になる（実際に 3 回混入し、うち 1 件は commit 済みだった）。
//
// 許可するのはタブ (0x09)・LF (0x0a)・CR (0x0d) だけ。それ以外の C0 と DEL (0x7f) を落とす。
// この範囲は実測で決めた——追跡テキストファイル 1613 件を走査して、混入していたのは
// NUL 1 件（既知の 1 ファイル）のみで、他の C0 は 1 バイトも現れなかった。
//
// 走査はバイト列（Buffer）で行う。文字列へ読み込むと不正シーケンスが置換文字へ丸められ、
// 検出したいバイトが消える。`grep -lP '\x00'` は `-a` 無しだと陽性コントロールすら拾わない。
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// テキストとして扱う拡張子（lefthook の glob と同じ集合）。
export const TEXT_EXTENSIONS = [
  "md",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "tsx",
  "mts",
  "cts",
  "json",
  "yml",
  "yaml",
  "sh",
  "txt",
];

const TEXT_RE = new RegExp(`\\.(${TEXT_EXTENSIONS.join("|")})$`);

const ALLOWED = new Set([0x09, 0x0a, 0x0d]);
const isDisallowed = (byte) => (byte < 0x20 && !ALLOWED.has(byte)) || byte === 0x7f;

export const isTextPath = (path) => TEXT_RE.test(path);

/** バイト列から違反位置（1 始まりの行・列・バイト値）を列挙する。 */
export function findControlBytes(buffer) {
  const found = [];
  let line = 1;
  let col = 1;
  for (const byte of buffer) {
    if (isDisallowed(byte)) {
      found.push({ line, col, byte });
    }
    if (byte === 0x0a) {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
  }
  return found;
}

/** 追跡ファイルのうちテキスト拡張子のものを列挙する（NUL 区切りなので改行を含む名前も壊れない）。 */
export function trackedTextFiles(cwd = process.cwd()) {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd, maxBuffer: 1 << 28 }).toString();
  return out.split("\0").filter((f) => f && isTextPath(f));
}

export function checkFiles(files, cwd = process.cwd()) {
  const violations = [];
  for (const file of files) {
    // 追跡はされているのに読めない（作業ツリーから消えている・symlink が壊れている）ファイルは、
    // 素の readFileSync だとスタックトレースごと検査を止める。検査結果として報告し、
    // 「走査できていない」を成功に倒さない。
    let buffer;
    try {
      buffer = readFileSync(join(cwd, file));
    } catch (error) {
      violations.push(`${file}: 読めないため走査できていない: ${error.code ?? error.message}`);
      continue;
    }
    const hits = findControlBytes(buffer);
    for (const { line, col, byte } of hits) {
      const name = byte === 0 ? "NUL" : `0x${byte.toString(16).padStart(2, "0")}`;
      violations.push(`${file}:${line}:${col}: 制御バイト ${name}`);
    }
  }
  return violations;
}

function main(argv) {
  const args = argv.filter((a) => a !== "--");
  // 引数があればそれだけを見る（pre-commit のステージ差分）。無ければ追跡ファイル全体（CI）。
  const files = args.length > 0 ? args.filter(isTextPath) : trackedTextFiles();

  if (files.length === 0) {
    // 引数で渡されたのに 1 件もテキスト拡張子でない／追跡ファイルが 0 件は、
    // 「違反なし」ではなく「走査できていない」。成功に倒さない。
    console.error(
      args.length > 0
        ? `control-chars: 渡された ${args.length} 件にテキスト拡張子のファイルが無い（対象の取り違え）。`
        : "control-chars: 追跡テキストファイルが 0 件（走査できていない）。",
    );
    return 1;
  }

  const violations = checkFiles(files);
  if (violations.length) {
    console.error(
      `control-chars: ${files.length} 件を走査し、${violations.length} 件の制御バイト:`,
    );
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      "Fix: ソース中で制御文字が要るときは、文字列リテラルにエスケープを書かず" +
        "（ツール層で生バイトへ復号される）、String.fromCharCode(0) など復号されない形で表す。",
    );
    return 1;
  }
  console.log(`control-chars: OK（${files.length} 件）`);
  return 0;
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    console.error(`control-chars: 起動パスを正規化できない: ${error.message}`);
    process.exit(1);
  }
}

if (isCliEntry()) process.exit(main(process.argv.slice(2)));
