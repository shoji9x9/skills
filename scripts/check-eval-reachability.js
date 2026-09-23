#!/usr/bin/env node
// eval の assertion と、それを引き出す prompt の文の対応（到達性）を決定論的に検査する
// （lefthook pre-commit はステージした evals.json、CI の Lint ジョブは全スキル）。
// eval は配布物に含めないため `skills/<name>/` ではなく `evals/<name>/evals.json` に置く
// （全走査では `skills/<name>/evals/` の残存も違反にする）。
//
// なぜ要るか: 「assertion を 1 本ずつ『prompt のどの文が引き出すか』と問い、引用を並べた対応表を
// 書き出す」は `.agents/rules/eval-assertion-discrimination.md` の文章規約にしかなく、書いた証拠を
// 残す場所も、書いていないことを検出する仕組みも無かった。到達不能な assertion を抱えたまま実走し、
// 6 run・9 run の取り直しになった記録が 3 度ある（実走が 1.75〜2.5 倍）。
//
// 検査するのは機械的に判定できる 4 点だけ:
//   1. assertion ごとに対応要素があるか
//   2. `prompt_quote` が空でないか
//   3. `prompt_quote` がその eval の prompt の部分文字列か
//   4. `assertion` がその eval の assertions に実在するか（位置ではなくテキストで対応づける）
// 「1 assertion 1 主張」「選択肢が両方立つ材料があるか」等はレビュー観点として rule に残す
// （機械検査は部分文字列の実在までしか見ない）。
//
// 既存 eval の backfill は一度に行わず、宣言済みの backlog（scripts/eval-reachability-backlog.json）で
// 段階適用する。backlog の項目は eval の指紋（prompt + assertions のハッシュ）を持ち、
// **eval を書き換えた瞬間に指紋が外れて reachability が必須になる**（免除が黙って居座らない）。
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BACKLOG_PATH = "scripts/eval-reachability-backlog.json";

/** eval の同一性の指紋。prompt か assertions が変われば外れる。 */
export function evalFingerprint(ev) {
  const material = JSON.stringify({ prompt: ev.prompt ?? null, assertions: ev.assertions ?? null });
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

/** backlog の鍵。区切り文字は材料側で禁じる（skill 名・id に ":" を許さない）。 */
export function backlogKey(skill, id) {
  return `${skill}:${id}`;
}

export function listEvalFiles(root) {
  const evalsDir = join(root, "evals");
  if (!existsSync(evalsDir)) return [];
  return readdirSync(evalsDir)
    .map((name) => join(evalsDir, name, "evals.json"))
    .filter((p) => existsSync(p));
}

/**
 * 配布スキルの中に置かれた eval ディレクトリ（`skills/<name>/evals/`）。
 * `gh skill install` はスキルディレクトリの全ファイルを配るため、ここに置くと
 * 下流へ eval が配られる。走査対象（`evals/<name>/`）からも外れて黙って未検査になる。
 */
export function listShippedEvalDirs(root) {
  const skillsDir = join(root, "skills");
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir)
    .map((name) => join(skillsDir, name, "evals"))
    .filter((p) => existsSync(p));
}

/**
 * 1 ファイルを検査する。
 * @returns {{ evals: number, violations: string[], keys: string[] }}
 */
export function checkEvalFile(path, source, backlog, label = path) {
  const violations = [];
  const keys = [];
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    return { evals: 0, violations: [`${label}: JSON として読めない: ${error.message}`], keys };
  }

  // トップレベルの形を先に確かめる。`null` や配列を素通りさせると `parsed.skill_name` が
  // TypeError で落ち、違反として報告されずに検査そのものが停止する（免除の鍵に skill_name が
  // 要るので、配列形式はそもそも受理できない）。
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    violations.push(`${label}: トップレベルが { "skill_name", "evals" } のオブジェクトでない`);
    return { evals: 0, violations, keys };
  }

  const skill = parsed.skill_name;
  if (typeof skill !== "string" || skill === "" || skill.includes(":")) {
    violations.push(`${label}: skill_name が文字列でないか ":" を含む（backlog の鍵が潰れる）`);
    return { evals: 0, violations, keys };
  }

  const evals = parsed.evals;
  if (!Array.isArray(evals)) {
    violations.push(`${label}: evals が配列でない`);
    return { evals: 0, violations, keys };
  }

  const seenIds = new Set();
  for (const [index, ev] of evals.entries()) {
    const where = `${label} #${ev?.id ?? `(index ${index})`}`;
    if (ev === null || typeof ev !== "object" || Array.isArray(ev)) {
      violations.push(`${where}: eval がオブジェクトでない`);
      continue;
    }
    const id = ev.id;
    if (typeof id !== "number" && (typeof id !== "string" || id === "")) {
      violations.push(`${where}: id が無い（backlog と対応づけられない）`);
      continue;
    }
    if (String(id).includes(":")) {
      violations.push(`${where}: id に ":" を含む（backlog の鍵が潰れる）`);
      continue;
    }
    if (seenIds.has(String(id))) {
      violations.push(`${where}: id が重複している`);
      continue;
    }
    seenIds.add(String(id));

    const prompt = ev.prompt;
    if (typeof prompt !== "string" || prompt.trim() === "") {
      violations.push(`${where}: prompt が空（到達性を判定できない）`);
      continue;
    }
    const assertions = ev.assertions;
    if (!Array.isArray(assertions) || assertions.length === 0) {
      violations.push(`${where}: assertions が空`);
      continue;
    }
    if (assertions.some((a) => typeof a !== "string" || a.trim() === "")) {
      violations.push(`${where}: assertions に空・非文字列の要素がある`);
      continue;
    }
    if (new Set(assertions).size !== assertions.length) {
      violations.push(
        `${where}: assertions のテキストが重複している（テキストで対応づけられない）`,
      );
      continue;
    }

    const key = backlogKey(skill, id);
    keys.push(key);
    const exemptFingerprint = backlog[key];
    const fingerprint = evalFingerprint(ev);
    const hasReachability = Object.hasOwn(ev, "reachability");

    if (!hasReachability) {
      if (exemptFingerprint === undefined) {
        violations.push(
          `${where}: reachability が無い。各 assertion に { "assertion", "prompt_quote" } を書く` +
            `（既存 eval を触らずに通すなら ${BACKLOG_PATH} へ "${key}": "${fingerprint}" を足す）`,
        );
      } else if (exemptFingerprint !== fingerprint) {
        violations.push(
          `${where}: backlog の指紋が古い（宣言 ${exemptFingerprint} / 実際 ${fingerprint}）。` +
            "prompt か assertions を変えたので、この eval は reachability を書いて backlog から外す",
        );
      }
      continue;
    }

    if (exemptFingerprint !== undefined) {
      violations.push(
        `${where}: reachability があるのに ${BACKLOG_PATH} に残っている（項目を消す）`,
      );
    }

    const reach = ev.reachability;
    if (!Array.isArray(reach)) {
      violations.push(`${where}: reachability が配列でない`);
      continue;
    }
    const covered = new Set();
    for (const [i, item] of reach.entries()) {
      const at = `${where} reachability[${i}]`;
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        violations.push(`${at}: 要素がオブジェクトでない`);
        continue;
      }
      const { assertion, prompt_quote: quote } = item;
      if (typeof assertion !== "string" || assertion === "") {
        violations.push(`${at}: assertion が空`);
        continue;
      }
      if (!assertions.includes(assertion)) {
        violations.push(`${at}: assertion が assertions に実在しない（テキストが一致しない）`);
        continue;
      }
      if (covered.has(assertion)) {
        violations.push(`${at}: 同じ assertion が 2 回宣言されている`);
        continue;
      }
      covered.add(assertion);
      if (typeof quote !== "string" || quote.trim() === "") {
        violations.push(
          `${at}: prompt_quote が空（引用を書けない assertion は prompt 側に問いを足すか落とす）`,
        );
        continue;
      }
      if (!prompt.includes(quote)) {
        violations.push(
          `${at}: prompt_quote が prompt の部分文字列でない: ${JSON.stringify(quote.slice(0, 60))}`,
        );
      }
    }
    for (const a of assertions) {
      if (!covered.has(a)) {
        violations.push(`${where}: 対応要素の無い assertion: ${JSON.stringify(a.slice(0, 60))}`);
      }
    }
  }

  return { evals: evals.length, violations, keys };
}

export function loadBacklog(root) {
  const path = join(root, BACKLOG_PATH);
  if (!existsSync(path)) return { exempt: {}, missing: true };
  // 不在を違反として扱う以上、壊れている場合も違反にする。素の JSON.parse だと
  // （merge 衝突の残骸などで）スタックトレースごと検査が止まり、pre-commit / CI が
  // 「検査した結果」ではなくクラッシュで落ちる。
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { exempt: {}, missing: false, error: error.message };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { exempt: {}, missing: false, error: "トップレベルがオブジェクトでない" };
  }
  return { exempt: parsed.exempt ?? {}, missing: false };
}

export function checkAll(root, files, { fullScan = true } = {}) {
  const { exempt, missing, error } = loadBacklog(root);
  const violations = [];
  if (missing) violations.push(`${BACKLOG_PATH}: 宣言ファイルが無い（免除の正本が読めない）`);
  else if (error) violations.push(`${BACKLOG_PATH}: 宣言ファイルを読めない: ${error}`);
  let evals = 0;
  const keys = [];
  for (const file of files) {
    const label = relative(root, file) || file;
    // 読めない入力は違反として報告する（check-control-chars.js と同じ扱い）。
    // 素の readFileSync だと、消えたファイル・壊れた symlink でスタックトレース終了になり、
    // 「検査した結果」ではなくクラッシュで pre-commit / CI が落ちる。
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch (error) {
      violations.push(`${label}: 読めないため検査できていない: ${error.code ?? error.message}`);
      continue;
    }
    const r = checkEvalFile(file, source, exempt, label);
    evals += r.evals;
    violations.push(...r.violations);
    keys.push(...r.keys);
  }
  // 逆向き: 実在しない eval を指す免除は、黙って居座るので落とす。
  // ただし全走査のときだけ——一部ファイルしか渡されない pre-commit で当てると、
  // 渡されなかったファイルの免除が全部「孤児」に化けて正常な commit を止める。
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

function main(argv) {
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
    console.error(`eval-reachability: 起動パスを正規化できない: ${error.message}`);
    process.exit(1);
  }
}

if (isCliEntry()) process.exit(main(process.argv.slice(2)));
