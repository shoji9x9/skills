// 週次の点検のワークフローが追跡 Issue に書く、前回の実行との差分（新規・継続・解消）を扱う（#508 の追跡 Issue の更新規則）。
// 本文の最後の行に、検出したことの識別子の一覧を HTML コメント（目印）で埋める。次の実行はそれを読み、今回の検出と比べる。
// 識別子の形は、点検ごとに書き手が決め、読み手にも同じ形（keyForm）を渡す。
import { parseArgs } from "../cli/args.ts";
import { errorMessage } from "../errors.ts";
import { isNonBlankString } from "../guards.ts";
import { isArray } from "../is-array.ts";

export type KeyDiff = { added: string[]; kept: string[]; resolved: string[] };

const MARKER_NAME = /^[a-z][a-z0-9-]*$/u;

function markerPrefix(name: string): string {
  // 名前は正規表現に埋め込むので、記号を含まない形に限る。
  if (!MARKER_NAME.test(name)) throw new Error(`目印の名前の形でない: ${JSON.stringify(name)}`);
  return `<!-- ${name}:keys `;
}

/** 本文の最後に置く、識別子の一覧の目印の行。 */
export function markerLine(name: string, keys: readonly string[]): string {
  return `${markerPrefix(name)}${JSON.stringify(keys)} -->`;
}

function parseKeys(json: string, keyForm: RegExp): string[] {
  const value: unknown = JSON.parse(json);
  if (!isArray(value)) throw new Error("識別子の一覧が配列でない");
  const keys = new Set<string>();
  for (const key of value) {
    if (typeof key !== "string" || !keyForm.test(key)) {
      throw new Error(`識別子の形でないものがある: ${JSON.stringify(key)}`);
    }
    if (keys.has(key)) throw new Error(`識別子が重複している: ${key}`);
    keys.add(key);
  }
  return [...keys];
}

/**
 * 前回の本文に埋めた識別子の一覧を読む。目印が無ければ（初めての作成や、人が本文を書き換えた後）空の一覧にする。
 * 目印があって読めないときは、差分を誤らないように例外にする。メッセージには直し方を書く。
 */
export function readKeys(body: string, name: string, keyForm: RegExp): string[] {
  const prefix = markerPrefix(name);
  const match = new RegExp(`^${prefix}(.*) -->$`, "mu").exec(body);
  if (match === null) return [];
  try {
    return parseKeys(match[1] ?? "", keyForm);
  } catch (error) {
    throw new Error(
      `前回の本文の識別子を読めない（${errorMessage(error)}）。追跡 Issue の本文から \`${prefix.trimEnd()}\` で始まる行を消すと、すべて新規として読み直す`,
      { cause: error },
    );
  }
}

/** 今回の識別子を、前回の識別子と比べて新規・継続に分け、前回にだけあったもの（解消）を挙げる。 */
export function diffKeys(now: readonly string[], previous: readonly string[]): KeyDiff {
  const before = new Set(previous);
  const nowSet = new Set(now);
  return {
    added: now.filter((k) => !before.has(k)),
    kept: now.filter((k) => before.has(k)),
    resolved: [...before].filter((k) => !nowSet.has(k)),
  };
}

/** 追跡 Issue に足すコメント。本文の更新だけでは通知が届かないので、差分をコメントにも書く。 */
export function formatDiffComment(label: string, total: number, diff: KeyDiff): string {
  const { added, kept, resolved } = diff;
  const lines = [
    `${label}: ${total} 件（新規 ${added.length} 件・継続 ${kept.length} 件・前回から解消 ${resolved.length} 件）`,
  ];
  if (added.length > 0) lines.push("", `新規: ${added.join("、")}`);
  if (resolved.length > 0) lines.push("", `解消: ${resolved.join("、")}`);
  return `${lines.join("\n")}\n`;
}

/** 点検ごとの目印の名前・識別子の形・識別子の作り方をまとめ、前回の読み取りと差分を返す。 */
export function trackingKeys<T>(spec: {
  marker: string;
  keyForm: RegExp;
  keyOf: (finding: T) => string;
}): {
  previousKeys: (body: string) => string[];
  diff: (findings: readonly T[], previous: readonly string[]) => KeyDiff;
  markerLine: (findings: readonly T[]) => string;
} {
  return {
    previousKeys: (body) => readKeys(body, spec.marker, spec.keyForm),
    diff: (findings, previous) => diffKeys(findings.map(spec.keyOf), previous),
    markerLine: (findings) => markerLine(spec.marker, findings.map(spec.keyOf)),
  };
}

export type TrackingCli = { out: string; commentOut: string; previous: string | undefined };
const CLI_NAMES = new Set(["out", "comment-out", "previous"]);

/**
 * 点検のスクリプトに共通の引数（`--out <本文> --comment-out <コメント> [--previous <前回の本文>]`）を読む。
 * 足りない・未知・同じオプションが 2 回・値が無い・空のときは null（重複と値の無いものは共通の parseArgs が例外にする）。
 */
export function parseTrackingCli(args: readonly string[]): TrackingCli | null {
  let values: Record<string, string>;
  try {
    values = parseArgs([...args]);
  } catch {
    return null;
  }
  if (Object.keys(values).some((name) => !CLI_NAMES.has(name))) return null;
  const { out, "comment-out": commentOut, previous } = values;
  if (!isNonBlankString(out) || !isNonBlankString(commentOut)) return null;
  if (previous !== undefined && !isNonBlankString(previous)) return null;
  return { out, commentOut, previous };
}
