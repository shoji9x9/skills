#!/usr/bin/env node
// 配布スキルの検査（`skills/*/scripts/**/*-check.*`）が、利用者の検査の入口（pre-commit・CI）へ
// 配線するか決まっているかを検査する（lefthook pre-commit + CI）。
//
// なぜ要るか: スキルの検査は工程の中で 1 回呼ばれるだけなので、工程を通らずに入った変更は
// 利用者の入口に配線されていないかぎり 1 度も検査されない。配線すべきものはスキルが
// `skills/<name>/checks.json` で宣言する。宣言に無いことは「配線しない」を表すが、それだけでは
// 「配線しないと決めた」と「決めていない（検査を足して宣言を忘れた）」が同じ見え方になる。
// そこで配線しないと決めた検査は理由付きで `scripts/skill-checks-unwired.json`（配布しない）に置き、
// 全検査がどちらか一方にだけ載っていることをここで確かめる。
//
// 判定規則:
// - 検査は名前で拾う（`*-check.<拡張子>`。`*-check.test.mjs` は末尾が合わないので拾わない）。0 本なら exit 2（走査が届いていない）。
// - 検査を 1 本でも持つスキルは `checks.json` を持つ（配線対象 0 件なら `"wire": []`）。
// - `checks.json` の形（キー・型・プレースホルダの解決・スクリプトの実在）を確かめる。利用者が機械的に
//   読むので、未知のキーや解決できないプレースホルダは黙って無視されないよう違反にする。
// - 終了コード: 判定そのものが成り立たない入力は exit 2——配線しない一覧（scripts/skill-checks-unwired.json）が
//   読めない（無い・JSON でない・形が違う）、検査が 0 本、リポジトリの外を指すリンク。
//   スキルの checks.json の誤り（JSON でない・形が違う）は exit 1 の違反として扱う——1 スキルの宣言が壊れていても
//   他のスキルの分類は判定でき、全スキルの違反をまとめて報告できるため（宣言を直す人が 1 件ずつ往復しない）。
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const UNWIRED_PATH = "scripts/skill-checks-unwired.json";
export const DECLARATION_NAME = "checks.json";
// 拡張子は限定しない（配布物の拡張子の規約が変わっても検査が分類から漏れないように）。
// `*-check.test.mjs` は `-check.` の後ろに `.` を含むので拾わない。
const CHECK_RE = /-check\.[A-Za-z0-9]+$/;
const STAGES = new Set(["pre-commit", "ci"]);
const RUNTIMES = new Set(["node", "bash"]);
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CONFIG_KEY_RE = /^skills\.[a-z0-9-]+(\.[A-Za-z0-9_-]+)+$/;
const PLACEHOLDER_RE = /\{([^{}]*)\}/g;
const TOP_KEYS = new Set(["$comment", "version", "skill", "wire"]);
const ENTRY_KEYS = new Set([
  "id",
  "script",
  "command",
  "params",
  "optional_args",
  "applies_when",
  "appears_after",
  "run_from",
  "stages",
  "notes",
]);

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isText = (v) => typeof v === "string" && v.trim() !== "";
const isTextArray = (v) => Array.isArray(v) && v.length > 0 && v.every(isText);

/** real が base（実パス）の中か。 */
const isInside = (base, real) => real === base || real.startsWith(base + sep);

// ancestors はいま辿っている経路上のディレクトリの実パス。自分や祖先を指すリンクで経路上へ戻ったら
// 辿り直さない（辿ると ELOOP まで潜って「判定できない」に化ける）。全体の訪問済み集合にはしない——
// 兄弟の 2 本のリンクが同じディレクトリを指すと、2 本目の先の検査が分類を問われないまま漏れる。
// リポジトリ（rootReal）の外を指すリンクは辿らず判定できないに倒す（CI のファイルシステムを走査しない。
// 黙って飛ばすと、そのリンクの先の検査が分類を問われないまま通る）。
function listFiles(dir, rootReal, ancestors = new Set()) {
  const real = realpathSync(dir);
  // 走査の起点（skills/<name>/scripts）自体がリンクで外を指す場合も、辿る前に止める。
  if (!isInside(rootReal, real)) throw new Error(`${dir} がリポジトリの外（${real}）を指している`);
  if (ancestors.has(real)) return [];
  const path = new Set(ancestors).add(real);
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    // シンボリックリンクは Dirent では isFile / isDirectory がどちらも偽になり、黙って走査から外れる
    // （リンクした検査が分類を問われないまま通る）ので、リンク先の種類で判定する。
    if (e.isSymbolicLink() && !isInside(rootReal, realpathSync(p))) {
      throw new Error(`${p} がリポジトリの外（${realpathSync(p)}）を指している`);
    }
    const kind = e.isSymbolicLink() ? statSync(p) : e;
    if (kind.isDirectory()) out.push(...listFiles(p, rootReal, path));
    else if (kind.isFile()) out.push(p);
  }
  return out;
}

/**
 * skills/ 直下のスキルのディレクトリ名。リンクはリンク先の種類で判定する（Dirent の isDirectory は
 * リンクで偽になり、リンクしたスキルの検査が分類を問われないまま漏れる）。リンク先がリポジトリの外なら
 * scripts/ の走査（listFiles）が判定できないに倒す。
 */
function skillDirs(root) {
  const skillsDir = join(root, "skills");
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => (e.isSymbolicLink() ? statSync(join(skillsDir, e.name)) : e).isDirectory())
    .map((e) => e.name)
    .sort();
}

/**
 * パスを宣言と同じ `/` 区切りにする。Windows の relative は `\\` 区切りを返すので、そのままでは
 * checks.json / 配線しない一覧の `/` 区切りのパスと一致せず、全検査が未分類に化ける。
 * @param {string} p
 * @param {string} [separator] テスト用（既定は実行環境の区切り）
 */
export function toRepoPath(p, separator = sep) {
  return p.split(separator).join("/");
}

/** 配布スキルの検査を `skills/<name>/scripts/...` のリポジトリ相対パスで返す。 */
export function findCheckScripts(root) {
  const out = [];
  for (const name of skillDirs(root)) {
    const scriptsDir = join(root, "skills", name, "scripts");
    if (!existsSync(scriptsDir)) continue;
    for (const f of listFiles(scriptsDir, realpathSync(root))) {
      if (CHECK_RE.test(basename(f))) out.push(toRepoPath(relative(root, f)));
    }
  }
  return out.sort();
}

/** 配線しない検査の一覧を読む。形の誤りは例外にする（読めない一覧を 0 件に倒さない）。 */
export function loadUnwired(root) {
  const path = join(root, UNWIRED_PATH);
  if (!existsSync(path)) throw new Error(`${UNWIRED_PATH} が無い`);
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(data?.unwired)) throw new Error("unwired は配列にする");
  return data.unwired.map((u, i) => {
    if (!isText(u?.script)) throw new Error(`unwired[${i}].script が無い`);
    if (!isText(u?.reason)) throw new Error(`unwired[${i}].reason が無い（配線しない理由を書く）`);
    return u.script;
  });
}

/** 文字列に現れるプレースホルダ名。 */
function placeholders(text) {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]);
}

/**
 * 1 スキルの `checks.json` を検査する。
 * @returns {{ scripts: string[], violations: string[] }} 宣言した検査（リポジトリ相対）と違反
 */
export function checkDeclaration(root, skill) {
  const rel = `skills/${skill}/${DECLARATION_NAME}`;
  const v = [];
  const scripts = [];
  // 宣言は配布物なので、リンクでスキルの外を指す checks.json は利用者の手元に届かない。読む前に落とす。
  if (!isInside(realpathSync(join(root, "skills", skill)), realpathSync(join(root, rel)))) {
    return {
      scripts,
      violations: [`${rel}: スキルのディレクトリの外を指している（配布されない）`],
    };
  }
  let data;
  try {
    data = JSON.parse(readFileSync(join(root, rel), "utf8"));
  } catch (error) {
    return { scripts, violations: [`${rel}: JSON として読めない: ${error.message}`] };
  }
  if (!isObject(data)) return { scripts, violations: [`${rel}: オブジェクトでない`] };
  for (const k of Object.keys(data)) if (!TOP_KEYS.has(k)) v.push(`${rel}: 未知のキー ${k}`);
  if (data.version !== 1) v.push(`${rel}: version は 1 にする`);
  if (data.skill !== skill) v.push(`${rel}: skill がディレクトリ名（${skill}）と一致しない`);
  if (!Array.isArray(data.wire)) {
    v.push(`${rel}: wire は配列にする（配線する検査が無ければ []）`);
    return { scripts, violations: v };
  }
  const ids = new Set();
  data.wire.forEach((e, i) => {
    const at = `${rel}: wire[${i}]`;
    if (!isObject(e)) return v.push(`${at} がオブジェクトでない`);
    for (const k of Object.keys(e)) if (!ENTRY_KEYS.has(k)) v.push(`${at}: 未知のキー ${k}`);
    if (!isText(e.id) || !ID_RE.test(e.id)) v.push(`${at}: id は小文字英数字とハイフンにする`);
    else if (ids.has(e.id)) v.push(`${at}: id ${e.id} が重複している`);
    else ids.add(e.id);

    // `.` / 空のセグメントも落とす: 実在確認は通るが、検査一覧のパスと字面が一致せず
    // 宣言した検査が「配線するか決まっていない」と報告される（宣言の誤りを別の違反に化けさせない）。
    if (
      !isText(e.script) ||
      e.script.startsWith("/") ||
      e.script.split("/").some((s) => s === ".." || s === "." || s === "")
    ) {
      v.push(`${at}: script はスキル直下からの相対パスにする（. / .. / 空のセグメントを含めない）`);
    } else {
      const path = join(root, "skills", skill, e.script);
      if (!existsSync(path) || !statSync(path).isFile()) {
        v.push(`${at}: script ${e.script} が無い`);
      } else if (!isInside(realpathSync(join(root, "skills", skill)), realpathSync(path))) {
        // リンクでスキルの外を指す script は配布されない（配布されるのはスキルのディレクトリだけ）。
        v.push(`${at}: script ${e.script} がスキルのディレクトリの外を指している`);
      } else scripts.push(`skills/${skill}/${e.script}`);
    }

    const params = e.params === undefined ? {} : e.params;
    if (!isObject(params)) v.push(`${at}: params はオブジェクトにする`);
    const paramNames = isObject(params) ? Object.keys(params) : [];

    const stages = e.stages;
    if (!isTextArray(stages) || !stages.every((s) => STAGES.has(s))) {
      v.push(`${at}: stages は pre-commit / ci の空でない配列にする`);
    } else if (new Set(stages).size !== stages.length) v.push(`${at}: stages が重複している`);

    for (const [name, p] of isObject(params) ? Object.entries(params) : []) {
      const pat = `${at}: params.${name}`;
      if (!ID_RE.test(name.replaceAll("_", "-")) || name === "script") {
        v.push(`${pat}: 名前は小文字英数字と _ にする（script は予約語）`);
      }
      if (!isObject(p)) {
        v.push(`${pat} がオブジェクトでない`);
        continue;
      }
      const keys = Object.keys(p);
      if ("by_stage" in p) {
        if (keys.length !== 1) v.push(`${pat}: by_stage は他のキーと併用しない`);
        const bs = p.by_stage;
        const want = Array.isArray(stages) ? [...stages].sort().join(",") : "";
        // 入口ごとの値は、そのまま置き換えられる値（value）か、入口側で求める手順（resolve）のどちらか一方。
        // 説明文を value の位置に置くと、機械的に置き換える利用者がその文をそのまま引数に渡す。
        const stageValue = (sv) =>
          isObject(sv) && Object.keys(sv).length === 1 && (isText(sv.value) || isText(sv.resolve));
        if (!isObject(bs) || !Object.values(bs).every(stageValue)) {
          v.push(
            `${pat}.by_stage は入口ごとに { "value": <そのまま渡す値> } か { "resolve": <入口側で求める手順> } のどちらか一方にする`,
          );
        } else if (Object.keys(bs).sort().join(",") !== want) {
          v.push(`${pat}.by_stage のキーが stages と一致しない`);
        }
      } else {
        if (!isText(p.config_key) || !CONFIG_KEY_RE.test(p.config_key)) {
          v.push(
            `${pat}: config_key は skills.<スキル名>.<キー> の形にする（入口ごとの値なら by_stage）`,
          );
        }
        if ("default" in p && !isText(p.default)) v.push(`${pat}: default は空でない文字列にする`);
        for (const k of keys) {
          if (k !== "config_key" && k !== "default") v.push(`${pat}: 未知のキー ${k}`);
        }
      }
    }

    // プレースホルダは宣言した params（command だけは {script} も）に解決できなければならない。
    const used = new Set();
    const resolveIn = (texts, where, allowScript) => {
      for (const t of texts) {
        for (const name of placeholders(t)) {
          if (name === "script" && allowScript) continue;
          if (paramNames.includes(name)) used.add(name);
          else v.push(`${at}: ${where} のプレースホルダ {${name}} が params に無い`);
        }
      }
    };

    if (!isTextArray(e.command)) {
      v.push(`${at}: command は空でない文字列の配列（argv）にする`);
    } else {
      if (!RUNTIMES.has(e.command[0])) v.push(`${at}: command[0] は node か bash にする`);
      if (e.command.filter((t) => t === "{script}").length !== 1) {
        v.push(`${at}: command は {script} をちょうど 1 回、単独の要素として持つ`);
      }
      // 他の要素に埋め込んだ {script}（x{script} 等）は単独の要素でないので落とす
      // （resolveIn は {script} を params 扱いせず飛ばすので、ここで拾わないと素通りする）。
      if (e.command.some((t) => t !== "{script}" && placeholders(t).includes("script"))) {
        v.push(`${at}: command の {script} は単独の要素にする（他の引数に埋め込まない）`);
      }
      resolveIn(e.command, "command", true);
    }

    if (e.optional_args !== undefined) {
      if (!Array.isArray(e.optional_args) || e.optional_args.length === 0) {
        v.push(`${at}: optional_args は空でない配列にする`);
      } else {
        e.optional_args.forEach((o, j) => {
          if (!isObject(o) || !isTextArray(o.args) || !isText(o.when_exists)) {
            v.push(`${at}: optional_args[${j}] は args（空でない配列）と when_exists を持つ`);
          } else if (Object.keys(o).some((k) => k !== "args" && k !== "when_exists")) {
            // 未知のキー（綴り違いの条件など）を黙って捨てると、利用者は書かれた条件が効くと読む。
            v.push(`${at}: optional_args[${j}] の未知のキー（args / when_exists だけを持つ）`);
          } else resolveIn([...o.args, o.when_exists], `optional_args[${j}]`, false);
        });
      }
    }

    // 対象が現れた条件は作業ツリー（exists）か比較元の版（exists_at_base）のどちらか一方以上で書く。
    // 削除を検出する検査は、作業ツリー側を条件にするとその削除の commit で検査ごと飛ぶので exists_at_base だけを使う。
    const aw = e.applies_when;
    const awKeys = ["exists", "exists_at_base"];
    if (!isObject(aw) || !awKeys.some((k) => k in aw)) {
      v.push(
        `${at}: applies_when に対象が現れたと分かるパスを exists（作業ツリー）か exists_at_base（比較元の版）で 1 件以上書く`,
      );
    } else {
      for (const k of Object.keys(aw)) {
        if (!awKeys.includes(k)) v.push(`${at}: applies_when の未知のキー ${k}`);
      }
      for (const k of awKeys) {
        if (k in aw && !isTextArray(aw[k])) v.push(`${at}: applies_when.${k} は空でない配列にする`);
      }
      // 形が違う値は上で違反にしたので展開しない（真偽値・オブジェクトの展開は
      // TypeError になり、宣言の誤り＝exit 1 が「判定できない」＝exit 2 に化ける）。
      const paths = awKeys.flatMap((k) => (isTextArray(aw[k]) ? aw[k] : []));
      resolveIn(paths, "applies_when", false);
    }

    for (const name of paramNames) {
      if (!used.has(name)) v.push(`${at}: params.${name} がどこからも参照されていない`);
    }
    if (!isText(e.appears_after)) v.push(`${at}: appears_after（対象が現れる工程）が無い`);
    if (!isText(e.run_from)) v.push(`${at}: run_from（起動するディレクトリ）が無い`);
    if ("notes" in e && !isText(e.notes)) v.push(`${at}: notes は空でない文字列にする`);
  });
  return { scripts, violations: v };
}

/**
 * @param {string} root リポジトリルート（テストでは一時ディレクトリ）
 * @returns {{ checks: number, wired: number, unwired: number, declarations: number, violations: string[] }}
 */
export function checkSkillChecks(root) {
  const checks = findCheckScripts(root);
  if (checks.length === 0) throw new Error("走査対象の検査（skills/*/scripts/*-check.*）が 0 本");
  const unwiredList = loadUnwired(root);
  const violations = [];

  const skills = skillDirs(root);
  const wired = new Map(); // script -> 宣言したスキル
  let declarations = 0;
  for (const skill of skills) {
    const hasDecl = existsSync(join(root, "skills", skill, DECLARATION_NAME));
    const hasCheck = checks.some((c) => c.startsWith(`skills/${skill}/`));
    if (!hasDecl) {
      if (hasCheck) {
        violations.push(
          `skills/${skill}: 検査を持つのに ${DECLARATION_NAME} が無い（配線する検査が無ければ "wire": [] で宣言する）`,
        );
      }
      continue;
    }
    declarations++;
    const { scripts, violations: v } = checkDeclaration(root, skill);
    violations.push(...v);
    for (const s of scripts) {
      if (wired.has(s)) violations.push(`${s}: ${DECLARATION_NAME} に重複して宣言されている`);
      // 配線できるのは走査で見つかった検査（scripts/ 配下の *-check.*）だけ。検査でないファイルを配線し、
      // 本物の検査を「配線しない」に載せた宣言を通すと、利用者は検査でないものを入口で走らせる。
      if (checks.indexOf(s) === -1) {
        violations.push(
          `${s}: 検査（scripts/ 配下の *-check.<拡張子>）として見つからないものを配線している`,
        );
      }
      wired.set(s, skill);
    }
  }

  const unwired = new Set();
  for (const s of unwiredList) {
    if (unwired.has(s)) violations.push(`${UNWIRED_PATH}: ${s} が重複している`);
    unwired.add(s);
    if (!checks.includes(s)) {
      violations.push(
        `${UNWIRED_PATH}: ${s} は検査として存在しない（改名・削除したなら一覧から外す）`,
      );
    }
  }

  for (const c of checks) {
    const w = wired.has(c);
    const u = unwired.has(c);
    if (w && u) {
      violations.push(
        `${c}: ${DECLARATION_NAME} と ${UNWIRED_PATH} の両方に載っている（どちらか一方にする）`,
      );
    } else if (!w && !u) {
      violations.push(
        `${c}: 配線するか決まっていない（${DECLARATION_NAME} の wire か ${UNWIRED_PATH} のどちらかに載せる）`,
      );
    }
  }
  return {
    checks: checks.length,
    wired: checks.filter((c) => wired.has(c)).length,
    unwired: unwired.size,
    declarations,
    violations,
  };
}

export function main(argv) {
  const root = argv.filter((a) => a !== "--")[0] ?? process.cwd();
  let result;
  try {
    result = checkSkillChecks(root);
  } catch (error) {
    console.error(`skill-checks: 判定できない（${resolve(root)}）: ${error.message}`);
    return 2;
  }
  const { checks, wired, unwired, declarations, violations } = result;
  if (violations.length) {
    console.error(`skill-checks: 検査 ${checks} 本を見て、${violations.length} 件の違反:`);
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      `Fix: 利用者の pre-commit・CI へ配線すべき検査（コミットされた成果物が常に満たす条件）は skills/<name>/${DECLARATION_NAME} の wire へ、` +
        `工程の中でだけ呼ぶ判定は理由を付けて ${UNWIRED_PATH} へ載せる。`,
    );
    return 1;
  }
  console.log(
    `skill-checks: OK（検査 ${checks} 本: 配線 ${wired} 本・配線しない ${unwired} 本、宣言 ${declarations} ファイル）`,
  );
  return 0;
}

// CLI エントリ判定は両辺を実パスへ揃える（片側だけの解決は symlink 経由の起動でサイレント no-op になる）。
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    console.error(`skill-checks: 起動パスを正規化できない: ${error.message}`);
    process.exit(1);
  }
}

if (isCliEntry()) process.exit(main(process.argv.slice(2)));
