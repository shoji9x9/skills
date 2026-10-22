#!/usr/bin/env node
// eval の assertion と、それを引き出す prompt の文の対応（到達性）を決定論的に検査する
// （lefthook pre-commit はステージした evals.json、CI の Lint ジョブは全スキル）。
// eval は配布物に含めないため `skills/<name>/` ではなく `evals/<name>/evals.json` に置く
// （全走査では `skills/<name>/evals/` の残存も違反にする）。
//
// なぜ要るか: 「assertion を 1 本ずつ『prompt のどの文が引き出すか』と問い、引用を並べた対応表を
// 書き出す」は `.agents/rules/eval-assertion-discrimination.md` の文章規約にしかなかった。書いた証拠を
// 残す場所も、書いていないことを検出する仕組みも無かった。到達できない assertion を抱えたまま実行し、
// 6 run・9 run をやり直した記録が 3 度ある（実行の回数が 1.75〜2.5 倍になった）。
//
// チェックするのは、機械的に判定できる次の 4 点だけである。
//   1. assertion ごとに対応要素があるか
//   2. `prompt_quote` が空でないか
//   3. `prompt_quote` がその eval の prompt の部分文字列か
//   4. `assertion` がその eval の assertions に実在するか（位置ではなくテキストで対応づける）
// 「1 assertion 1 主張」「選択肢が両方立つ材料があるか」等はレビュー観点として rule に残す
// （機械検査は部分文字列の実在までしか見ない）。
//
// 既存 eval の backfill は一度に行わず、宣言済みの backlog（scripts/gates/packaging/eval-reachability-backlog.json）で
// 段階適用する。backlog の項目は eval の指紋（prompt + assertions のハッシュ）を持ち、
// **eval を書き換えた時点で指紋が外れ、reachability が必須になる**（免除が警告なしに残り続けない）。
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { errorCodeOrMessage, errorMessage } from "../../lib/errors.ts";
import { isNonBlankString, isRecord } from "../../lib/guards.ts";
import { isArray } from "../../lib/is-array.ts";

export const BACKLOG_PATH = "scripts/gates/packaging/eval-reachability-backlog.json";

/** eval の同一性の指紋。prompt か assertions が変われば外れる。 */
export function evalFingerprint(ev: { prompt?: unknown; assertions?: unknown }) {
  const material = JSON.stringify({ prompt: ev.prompt ?? null, assertions: ev.assertions ?? null });
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

/** backlog の鍵。区切り文字は材料側で禁じる（skill 名・id に ":" を許さない）。 */
export function backlogKey(skill: string, id: unknown) {
  return `${skill}:${id}`;
}

export function listEvalFiles(root: string) {
  const evalsDir = join(root, "evals");
  if (!existsSync(evalsDir)) return [];
  return readdirSync(evalsDir)
    .map((name) => join(evalsDir, name, "evals.json"))
    .filter((p) => existsSync(p));
}

/**
 * 配布スキルの中に置かれた eval ディレクトリ（`skills/<name>/evals/`）。
 * `gh skill install` はスキルディレクトリの全ファイルを配るため、ここに置くと
 * 下流へ eval が配られる。走査対象（`evals/<name>/`）からも外れ、警告なしにチェックされなくなる。
 */
export function listShippedEvalDirs(root: string) {
  const skillsDir = join(root, "skills");
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir)
    .map((name) => join(skillsDir, name, "evals"))
    .filter((p) => existsSync(p));
}

/** 形を確かめた 1 件の eval。 */
type EvalShape = {
  where: string;
  id: string | number;
  prompt: string;
  assertions: string[];
  ev: Record<string, unknown>;
};

/**
 * eval の id・prompt・assertions の形を確かめる。id が重複していなければ seenIds に足す。
 * id を足すのは prompt と assertions を確かめる前なので、それらに不備がある eval の id も重複の判定に使う（main の時点と同じ）。
 * @returns 形が正しければ EvalShape、不備があれば違反の文
 */
function checkEvalShape(ev: unknown, where: string, seenIds: Set<string>): EvalShape | string {
  if (!isRecord(ev)) return `${where}: eval がオブジェクトでない`;
  const id = ev.id;
  if (typeof id !== "number" && (typeof id !== "string" || id === "")) {
    return `${where}: id が無い（backlog と対応づけられない）`;
  }
  if (String(id).includes(":")) return `${where}: id に ":" を含む（backlog の鍵が潰れる）`;
  if (seenIds.has(String(id))) return `${where}: id が重複している`;
  seenIds.add(String(id));

  const prompt = ev.prompt;
  if (typeof prompt !== "string" || prompt.trim() === "") {
    return `${where}: prompt が空（到達性を判定できない）`;
  }
  const assertions = ev.assertions;
  if (!isArray(assertions) || assertions.length === 0) return `${where}: assertions が空`;
  if (!assertions.every(isNonBlankString)) {
    return `${where}: assertions に空・非文字列の要素がある`;
  }
  if (new Set(assertions).size !== assertions.length) {
    return `${where}: assertions のテキストが重複している（テキストで対応づけられない）`;
  }
  return { where, id, prompt, assertions, ev };
}

/**
 * reachability の有無と backlog の免除を突き合わせ、違反を返す。
 * hasReachability は呼び出し元が 1 回だけ求め、要素を続けて検査するかにも同じ値を使う。
 */
function backlogViolations(
  { where, ev }: EvalShape,
  {
    key,
    exemptFingerprint,
    hasReachability,
  }: { key: string; exemptFingerprint: string | undefined; hasReachability: boolean },
): string[] {
  const fingerprint = evalFingerprint(ev);
  if (!hasReachability) {
    if (exemptFingerprint === undefined) {
      return [
        `${where}: reachability が無い。各 assertion に { "assertion", "prompt_quote" } を書く` +
          `（既存 eval を触らずに通すなら ${BACKLOG_PATH} へ "${key}": "${fingerprint}" を足す）`,
      ];
    }
    if (exemptFingerprint !== fingerprint) {
      return [
        `${where}: backlog の指紋が古い（宣言 ${exemptFingerprint} / 実際 ${fingerprint}）。` +
          "prompt か assertions を変えたので、この eval は reachability を書いて backlog から外す",
      ];
    }
    return [];
  }
  if (exemptFingerprint !== undefined) {
    return [`${where}: reachability があるのに ${BACKLOG_PATH} に残っている（項目を消す）`];
  }
  return [];
}

/**
 * reachability の 1 要素を確かめる。
 * @returns 違反の文。対応づけた assertion は covered に足す
 */
function checkReachabilityItem(
  item: unknown,
  at: string,
  { shape, covered }: { shape: EvalShape; covered: Set<string> },
) {
  if (!isRecord(item)) return `${at}: 要素がオブジェクトでない`;
  const { assertion, prompt_quote: quote } = item;
  if (typeof assertion !== "string" || assertion === "") return `${at}: assertion が空`;
  if (!shape.assertions.some((a) => a === assertion)) {
    return `${at}: assertion が assertions に実在しない（テキストが一致しない）`;
  }
  if (covered.has(assertion)) return `${at}: 同じ assertion が 2 回宣言されている`;
  covered.add(assertion);
  if (typeof quote !== "string" || quote.trim() === "") {
    return `${at}: prompt_quote が空（引用を書けない assertion は prompt 側に問いを足すか落とす）`;
  }
  if (!shape.prompt.includes(quote)) {
    return `${at}: prompt_quote が prompt の部分文字列でない: ${JSON.stringify(quote.slice(0, 60))}`;
  }
  return undefined;
}

/** reachability の要素を 1 つずつ確かめ、対応要素の無い assertion を違反にする。 */
function reachabilityViolations(shape: EvalShape): string[] {
  const { where, ev, assertions } = shape;
  const reach = ev.reachability;
  if (!isArray(reach)) return [`${where}: reachability が配列でない`];
  const violations: string[] = [];
  const covered = new Set<string>();
  for (const [i, item] of reach.entries()) {
    const violation = checkReachabilityItem(item, `${where} reachability[${i}]`, {
      shape,
      covered,
    });
    if (violation !== undefined) violations.push(violation);
  }
  for (const a of assertions) {
    if (!covered.has(a)) {
      violations.push(`${where}: 対応要素の無い assertion: ${JSON.stringify(a.slice(0, 60))}`);
    }
  }
  return violations;
}

/**
 * evals.json のトップレベルを読み、skill_name と evals を取り出す。
 * @returns 形が正しければ { skill, evals }、不備があれば違反の文
 */
function parseEvalTop(source: string, label: string) {
  // 形はこの後の検査で確かめる。
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    return `${label}: JSON として読めない: ${errorMessage(error)}`;
  }

  // トップレベルの形を先に確かめる。`null` や配列を素通りさせると `parsed.skill_name` が
  // TypeError で落ち、違反として報告されずに検査そのものが停止する（免除の鍵に skill_name が
  // 要るので、配列形式はそもそも受理できない）。
  if (!isRecord(parsed)) {
    return `${label}: トップレベルが { "skill_name", "evals" } のオブジェクトでない`;
  }

  const skill = parsed.skill_name;
  if (typeof skill !== "string" || skill === "" || skill.includes(":")) {
    return `${label}: skill_name が文字列でないか ":" を含む（backlog の鍵が潰れる）`;
  }

  const evals = parsed.evals;
  if (!isArray(evals)) return `${label}: evals が配列でない`;
  return { skill, evals };
}

/**
 * 1 ファイルを検査する。
 * @returns {{ evals: number, violations: string[], keys: string[] }}
 */
export function checkEvalFile({
  path,
  source,
  backlog,
  label = path,
}: {
  path: string;
  source: string;
  backlog: Record<string, string>;
  label?: string;
}) {
  const violations: string[] = [];
  const keys: string[] = [];
  const top = parseEvalTop(source, label);
  if (typeof top === "string") return { evals: 0, violations: [top], keys };
  const { skill, evals } = top;

  const seenIds = new Set<string>();
  for (const [index, ev] of evals.entries()) {
    const where = `${label} #${(isRecord(ev) ? ev.id : undefined) ?? `(index ${index})`}`;
    const shape = checkEvalShape(ev, where, seenIds);
    if (typeof shape === "string") {
      violations.push(shape);
      continue;
    }
    const key = backlogKey(skill, shape.id);
    keys.push(key);
    const hasReachability = Object.hasOwn(shape.ev, "reachability");
    violations.push(
      ...backlogViolations(shape, { key, exemptFingerprint: backlog[key], hasReachability }),
    );
    if (hasReachability) violations.push(...reachabilityViolations(shape));
  }

  return { evals: evals.length, violations, keys };
}

export function loadBacklog(root: string): {
  exempt: Record<string, string>;
  missing: boolean;
  error?: string;
} {
  const path = join(root, BACKLOG_PATH);
  if (!existsSync(path)) return { exempt: {}, missing: true };
  // 不在を違反として扱う以上、形式が不正な場合も違反にする。素の JSON.parse だと、
  // （merge 衝突の残骸などで）スタックトレースを出してチェックが止まる。すると pre-commit / CI が、
  // 「チェックした結果」ではなくクラッシュで落ちる。
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { exempt: {}, missing: false, error: errorMessage(error) };
  }
  if (!isRecord(parsed)) {
    return { exempt: {}, missing: false, error: "トップレベルがオブジェクトでない" };
  }
  const exempt = parsed.exempt ?? {};
  if (!isStringRecord(exempt)) {
    return { exempt: {}, missing: false, error: "exempt が、値が文字列のオブジェクトでない" };
  }
  return { exempt, missing: false };
}

/** 値がすべて文字列の object か。 */
function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((v) => typeof v === "string");
}

export function checkAll(
  root: string,
  files: string[],
  { fullScan = true }: { fullScan?: boolean } = {},
) {
  const { exempt, missing, error } = loadBacklog(root);
  const violations: string[] = [];
  if (missing) violations.push(`${BACKLOG_PATH}: 宣言ファイルが無い（免除の原本が読めない）`);
  else if (error) violations.push(`${BACKLOG_PATH}: 宣言ファイルを読めない: ${error}`);
  let evals = 0;
  const keys: string[] = [];
  for (const file of files) {
    const label = relative(root, file) || file;
    // 読めない入力は違反として報告する（check-control-chars.ts と同じ扱い）。
    // 素の readFileSync だと、消えたファイル・リンク先の無い symlink で、スタックトレースを出して終わる。
    // すると「チェックした結果」ではなく、クラッシュで pre-commit / CI が落ちる。
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch (error) {
      violations.push(`${label}: 読めないため検査できていない: ${errorCodeOrMessage(error)}`);
      continue;
    }
    const r = checkEvalFile({ path: file, source, backlog: exempt, label });
    evals += r.evals;
    violations.push(...r.violations);
    keys.push(...r.keys);
  }
  // 逆向き: 実在しない eval を指す免除は、警告なしに残り続けるので落とす。
  // ただし全走査のときだけである。一部のファイルしか渡されない pre-commit で当てると、
  // 渡されなかったファイルの免除がすべて、誤って「孤児」と判定され、正常な commit を止める。
  if (!fullScan) return { evals, violations, files: files.length };
  for (const dir of listShippedEvalDirs(root)) {
    const name = relative(join(root, "skills"), dir).split("/")[0];
    violations.push(
      `${relative(root, dir)}/: 配布スキルの中に eval がある（下流へ配られ、この検査の走査からも外れる）。evals/${name}/ へ置く`,
    );
  }
  for (const key of Object.keys(exempt)) {
    if (!keys.includes(key)) {
      violations.push(`${BACKLOG_PATH}: "${key}" に対応する eval が無い（孤児の免除）`);
    }
  }
  return { evals, violations, files: files.length };
}

function main(argv: string[]) {
  const root = process.env.EVAL_REACHABILITY_ROOT ?? process.cwd();
  const args = argv.filter((a) => a !== "--");
  const files = args.length > 0 ? args.map((a) => resolve(root, a)) : listEvalFiles(root);

  if (files.length === 0) {
    console.error(`eval-reachability: 対象の evals.json が 0 件（${resolve(root)}）。`);
    console.error("Fix: 0 件は「違反なし」ではない。対象の取り違えを確認する。");
    return 1;
  }

  const { evals, violations } = checkAll(root, files, { fullScan: args.length === 0 });
  if (violations.length) {
    console.error(
      `eval-reachability: ${files.length} ファイル・${evals} eval を走査し、${violations.length} 件:`,
    );
    for (const v of violations) console.error(`  - ${v}`);
    return 1;
  }
  console.log(`eval-reachability: OK（${files.length} ファイル・${evals} eval）`);
  return 0;
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    console.error(`eval-reachability: 起動パスを正規化できない: ${errorMessage(error)}`);
    process.exit(1);
  }
}

if (isCliEntry()) process.exit(main(process.argv.slice(2)));
