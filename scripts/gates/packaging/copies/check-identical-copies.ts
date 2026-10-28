#!/usr/bin/env node
// 同一であるべきコピーが一致しているか検査する（lefthook pre-commit + CI）。
//
// なぜ要るか: 配布スキルは実行時に参照するものを自分の中に同梱する
// （`.agents/rules/distributed-skill-bundle-artifacts.md`）。姉妹スキルが同じ手順・スクリプトを持つと、
// 片方だけを直した時点で 2 つのスキルが別の規則で動く。どちらも単体では正しく見えるので、
// レビューでも実行でも気づけない（実例: `review-tool.md` の片方にだけ Codex の実測挙動が追記されていた）。
//
// 判定規則:
// - 組は `scripts/gates/packaging/copies/identical-copies.json` の宣言から作る（観測した「今一致しているもの」からは作らない。
//   一致が崩れた組は観測では見つからない）。各組は 2 件以上のファイルと理由（`reason`）を持つ。
// - 一致はバイト単位の完全一致。節単位の一致は採らない。宣言した組は冒頭もスキル固有の節も持たず
//   全文が姉妹スキルで共通（本文は「このスキル」「姉妹スキル（A / B）」と書いて両方から読める形）なので、
//   節の境界を解析する分だけ、検出できない範囲（見出しの表記ゆれ・節の追加）が増える。スキル固有の差分が要るなら、
//   その部分を共有ファイルから SKILL.md 側へ移してから組に入れる。
// - 例外は、ファイルの一部だけが共通な組（`region` を持つ組）。種類の違うファイル（ユーティリティの原本と、
//   利用者のプロジェクトへ 1 ファイルだけコピーする雛形）が、同じ関数を持つ場合に使う。比べるのは、
//   印の行 `// <region>:begin` と `// <region>:end` の間だけである。範囲は見出しの解析ではなく明示した印で決め、
//   印が 1 組だけ無い（無い・重複・逆順）ファイルは違反にする。印が崩れたまま比べずに通さないためである。
// - 組の最初のファイルを基準にし、違うファイルは最初に食い違う行番号を報告する。
// - 1 ファイルは、ファイル全体の組と、範囲の名前ごとの組に 1 つずつ属せる。
// - 宣言が読めない（JSON でない・形が違う・組が 0 件・同じ種類の組をまたいだ同じファイルの重複）は exit 2、
//   ファイルが無い・一致しないは exit 1。
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { errorMessage } from "../../../lib/errors.ts";
import { isRecord } from "../../../lib/guards.ts";
import { isArray } from "../../../lib/is-array.ts";
import { isCliEntry } from "../../../lib/cli/entry.ts";

export const DECLARATION_PATH = "scripts/gates/packaging/copies/identical-copies.json";

export type CopyGroup = { files: string[]; reason: string; region?: string };

const REGION_NAME_RE = /^[a-z][a-z0-9-]*$/;

/** 宣言を読み、形の誤りは例外にする（読めない宣言を「組 0 件＝違反なし」として扱わない）。 */
export function loadGroups(root: string): CopyGroup[] {
  const path = join(root, DECLARATION_PATH);
  if (!existsSync(path)) throw new Error(`${DECLARATION_PATH} が無い`);
  return parseGroups(JSON.parse(readFileSync(path, "utf8")));
}

/** 宣言の中身（JSON を読んだ値）から組を作り、形の誤りは例外にする。 */
export function parseGroups(data: unknown): CopyGroup[] {
  const groups = isRecord(data) ? data.groups : undefined;
  if (!isArray(groups) || groups.length === 0) {
    throw new Error("groups は 1 件以上の配列にする");
  }
  const seen = new Set<string>();
  return groups.map((group, i): CopyGroup => {
    const g = isRecord(group) ? group : {};
    const files = groupFiles(g.files, i);
    if (typeof g.reason !== "string" || !g.reason.trim()) {
      throw new Error(`groups[${i}].reason が無い（なぜ同一であるべきかを書く）`);
    }
    const region = g.region;
    if (region !== undefined && (typeof region !== "string" || !REGION_NAME_RE.test(region))) {
      throw new Error(`groups[${i}].region は英小文字で始まる英小文字・数字・ハイフンの名前にする`);
    }
    markSeen(seen, files, region);
    return { ...g, files, reason: g.reason, region };
  });
}

/** 組の files を、2 件以上の空でない文字列の配列として読む。 */
function groupFiles(files: unknown, i: number): string[] {
  if (
    !isArray(files) ||
    files.length < 2 ||
    !files.every((f): f is string => typeof f === "string") ||
    files.includes("")
  ) {
    throw new Error(`groups[${i}].files は 2 件以上の空でない文字列の配列にする`);
  }
  return files;
}

/** 組のファイルを seen に記録し、同じ種類の組に 2 回宣言されたファイルを例外にする。 */
function markSeen(seen: Set<string>, files: readonly string[], region: string | undefined): void {
  // 1 ファイルが属せるのは、ファイル全体を比べる組 1 つと、範囲の名前ごとの組 1 つずつである。
  // 同じ関数のコピーどうしはファイル全体で比べ、種類の違うファイルとは範囲で比べる。
  for (const f of files) {
    const key = region === undefined ? f : `${f}#${region}`;
    if (seen.has(key))
      throw new Error(
        `${f} が${region === undefined ? "" : `範囲「${region}」の`}組に複数回宣言されている`,
      );
    seen.add(key);
  }
}

/**
 * 印の行 `// <region>:begin` と `// <region>:end` の行番号（0 始まり）。印が 1 組だけ無ければ、理由を返す。
 * 範囲の中身は、2 つの印の行の間（印の行を含まない）である。
 */
export function regionMarkers(
  text: string,
  region: string,
): { begin: number; end: number } | { error: string } {
  const lines = text.split("\n");
  const begin = `// ${region}:begin`;
  const end = `// ${region}:end`;
  const at = (marker: string) => lines.flatMap((l, i) => (l.trim() === marker ? [i] : []));
  const [b, e] = [at(begin), at(end)];
  if (b.length !== 1 || e.length !== 1) {
    return {
      error: `印「${begin}」と「${end}」が 1 つずつでない（${b.length} 件・${e.length} 件）`,
    };
  }
  if (e[0] < b[0]) return { error: `印「${end}」が「${begin}」より前にある` };
  return { begin: b[0], end: e[0] };
}

/** 印の行 `// <region>:begin` と `// <region>:end` の間（印の行を含まない）。印が 1 組だけ無ければ、理由を返す。 */
export function extractRegion(text: string, region: string): { body: string } | { error: string } {
  const m = regionMarkers(text, region);
  if ("error" in m) return m;
  return {
    body: text
      .split("\n")
      .slice(m.begin + 1, m.end)
      .join("\n"),
  };
}

/** 2 つのテキストで最初に食い違う行（1 始まり）。 */
function firstDifferentLine(a: string, b: string) {
  const la = a.split("\n");
  const lb = b.split("\n");
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i++) if (la[i] !== lb[i]) return i + 1;
  return n;
}

/**
 * @param {string} root リポジトリルート（テストでは一時ディレクトリ）
 * @returns {{ groups: number, files: number, violations: string[] }}
 */
export function checkIdenticalCopies(root: string) {
  const groups = loadGroups(root);
  const violations: string[] = [];
  let files = 0;
  for (const { files: paths, region } of groups) {
    const missing = paths.filter((p) => !existsSync(join(root, p)));
    for (const p of missing) violations.push(`${p}: 宣言したファイルが無い`);
    const present = paths.filter((p) => !missing.includes(p));
    files += present.length;
    if (present.length < 2) continue;
    violations.push(
      ...(region === undefined
        ? wholeFileViolations(root, present)
        : regionViolations(root, present, region)),
    );
  }
  return { groups: groups.length, files, violations };
}

/** 組の先頭のファイル（base）と、残りのファイル全体を比べる。 */
function wholeFileViolations(root: string, present: readonly string[]): string[] {
  const [base, ...rest] = present;
  const violations: string[] = [];
  const baseBuf = readFileSync(join(root, base));
  for (const p of rest) {
    const buf = readFileSync(join(root, p));
    if (!baseBuf.equals(buf)) {
      const line = firstDifferentLine(baseBuf.toString("utf8"), buf.toString("utf8"));
      violations.push(`${p}: ${base} と一致しない（最初の差分は ${line} 行目）`);
    }
  }
  return violations;
}

/** 組の先頭のファイル（base）と残りのファイルとで、印で囲んだ範囲（region）の中身を比べる。 */
function regionViolations(root: string, present: readonly string[], region: string): string[] {
  const base = present[0];
  const violations: string[] = [];
  const bodies = present.map((p) => ({
    p,
    r: extractRegion(readFileSync(join(root, p), "utf8"), region),
  }));
  for (const { p, r } of bodies) if ("error" in r) violations.push(`${p}: ${r.error}`);
  const baseRegion = bodies[0].r;
  if ("error" in baseRegion) return violations;
  for (const { p, r } of bodies.slice(1)) {
    if ("body" in r && r.body !== baseRegion.body) {
      const line = firstDifferentLine(baseRegion.body, r.body);
      violations.push(
        `${p}: ${base} と範囲「${region}」が一致しない（範囲の中の最初の差分は ${line} 行目）`,
      );
    }
  }
  return violations;
}

export function main(argv: string[]) {
  const root = argv.filter((a) => a !== "--")[0] ?? process.cwd();
  let result;
  try {
    result = checkIdenticalCopies(root);
  } catch (error) {
    console.error(
      `identical-copies: 宣言を読めない（${resolve(root, DECLARATION_PATH)}）: ${errorMessage(error)}`,
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

if (isCliEntry(import.meta.url)) process.exit(main(process.argv.slice(2)));
