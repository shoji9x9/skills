#!/usr/bin/env node
// 同一であるべきコピーが一致しているか検査する（lefthook pre-commit + CI）。
//
// なぜ要るか: 配布スキルは実行時に参照するものを自分の中に同梱する
// （`.agents/rules/distributed-skill-bundle-artifacts.md`）。姉妹スキルが同じ手順・スクリプトを持つと、
// 片方だけを直した時点で 2 つのスキルが別の規則で動く。どちらも単体では正しく見えるので、
// レビューでも実行でも気づけない（実例: `review-tool.md` の片方にだけ Codex の実測挙動が追記されていた）。
//
// 判定規則:
// - 組は `scripts/gates/identical-copies.json` の宣言から作る（観測した「今一致しているもの」からは作らない。
//   一致が崩れた組は観測では見つからない）。各組は 2 件以上のファイルと理由（`reason`）を持つ。
// - 一致はバイト単位の完全一致。節単位の一致は採らない——宣言した組は冒頭もスキル固有の節も持たず
//   全文が姉妹スキルで共通（本文は「このスキル」「姉妹スキル（A / B）」と書いて両方から読める形）なので、
//   節の境界を解析する分だけ穴（見出しの表記ゆれ・節の追加）が増える。スキル固有の差分が要るなら、
//   その部分を共有ファイルから SKILL.md 側へ移してから組に入れる。
// - 組の最初のファイルを基準にし、違うファイルは最初に食い違う行番号を報告する。
// - 宣言が読めない（JSON でない・形が違う・組が 0 件・同じファイルの重複）は exit 2、
//   ファイルが無い・一致しないは exit 1。
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DECLARATION_PATH = "scripts/gates/identical-copies.json";

/** 宣言を読み、形の誤りは例外にする（読めない宣言を「組 0 件＝違反なし」に倒さない）。 */
export function loadGroups(root) {
  const path = join(root, DECLARATION_PATH);
  if (!existsSync(path)) throw new Error(`${DECLARATION_PATH} が無い`);
  const data = JSON.parse(readFileSync(path, "utf8"));
  const groups = data?.groups;
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error("groups は 1 件以上の配列にする");
  }
  const seen = new Set();
  groups.forEach((g, i) => {
    const files = g?.files;
    if (
      !Array.isArray(files) ||
      files.length < 2 ||
      !files.every((f) => typeof f === "string" && f)
    ) {
      throw new Error(`groups[${i}].files は 2 件以上の空でない文字列の配列にする`);
    }
    if (typeof g.reason !== "string" || !g.reason.trim()) {
      throw new Error(`groups[${i}].reason が無い（なぜ同一であるべきかを書く）`);
    }
    for (const f of files) {
      if (seen.has(f))
        throw new Error(`${f} が複数回宣言されている（1 ファイルは 1 組にだけ属する）`);
      seen.add(f);
    }
  });
  return groups;
}

/** 2 つのバッファで最初に食い違う行（1 始まり）。 */
function firstDifferentLine(a, b) {
  const la = a.toString("utf8").split("\n");
  const lb = b.toString("utf8").split("\n");
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i++) if (la[i] !== lb[i]) return i + 1;
  return n;
}

/**
 * @param {string} root リポジトリルート（テストでは一時ディレクトリ）
 * @returns {{ groups: number, files: number, violations: string[] }}
 */
export function checkIdenticalCopies(root) {
  const groups = loadGroups(root);
  const violations = [];
  let files = 0;
  for (const { files: paths } of groups) {
    const missing = paths.filter((p) => !existsSync(join(root, p)));
    for (const p of missing) violations.push(`${p}: 宣言したファイルが無い`);
    const present = paths.filter((p) => !missing.includes(p));
    files += present.length;
    if (present.length < 2) continue;
    const [base, ...rest] = present;
    const baseBuf = readFileSync(join(root, base));
    for (const p of rest) {
      const buf = readFileSync(join(root, p));
      if (!baseBuf.equals(buf)) {
        violations.push(
          `${p}: ${base} と一致しない（最初の差分は ${firstDifferentLine(baseBuf, buf)} 行目）`,
        );
      }
    }
  }
  return { groups: groups.length, files, violations };
}

export function main(argv) {
  const root = argv.filter((a) => a !== "--")[0] ?? process.cwd();
  let result;
  try {
    result = checkIdenticalCopies(root);
  } catch (error) {
    console.error(
      `identical-copies: 宣言を読めない（${resolve(root, DECLARATION_PATH)}）: ${error.message}`,
    );
    return 2;
  }
  const { groups, files, violations } = result;
  if (violations.length) {
    console.error(
      `identical-copies: ${groups} 組・${files} 件を比べ、${violations.length} 件の不一致:`,
    );
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      "Fix: 片方だけを直したなら、同じ変更を組の全ファイルへ当てる（diff で確かめる）。" +
        `一致させない理由があるなら ${DECLARATION_PATH} の組から外し、その理由を残す。`,
    );
    return 1;
  }
  console.log(`identical-copies: OK（${groups} 組・${files} 件）`);
  return 0;
}

// CLI エントリ判定は両辺を実パスへ揃える（片側だけの解決は symlink 経由の起動でサイレント no-op になる）。
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    console.error(`identical-copies: 起動パスを正規化できない: ${error.message}`);
    process.exit(1);
  }
}

if (isCliEntry()) process.exit(main(process.argv.slice(2)));
