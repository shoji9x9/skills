// 被覆プロファイルから候補集合を展開し、部品被覆表と機械的に照合する（正本）。
// 正本はこのスキル側にあり、実行時はスキルディレクトリ内から直接実行する
// （プロジェクトへコピーしない。プロファイルを同梱ディレクトリから読むため）。
//
// 何をするか: components[].profile が指すプロファイルを assets/coverage-profiles/ から読み、
// インスタンスごとの列挙（enumeration）と candidate_rules の直積から候補集合を展開して、
// 被覆表の items / cells / equivalence_classes と照合する。
//
// 何をしないか: 候補が本当に全て列挙されたか（ソースの読み落とし）は判定できない。
// 判定できるのは「列挙した要素が候補へ展開され、候補がセルへ落ち、セルに証拠と対応付けがある」ことまで。
// 列挙そのものの網羅は enumeration.source の来歴と complete フラグで fail-closed に扱う。
// 差分の検出・分類（parity-diff の仕事）、被覆表の測定値の記入（人／エージェントの仕事）は行わない。
//
// fail-closed: 候補ゼロ・列挙なし・complete: false・required_rules が 0 件・
// 同値クラスの所属漏れは、いずれも「問題なし」に倒さず非ゼロ終了にする。
// 「その部品には無い」を主張するには、列挙側の enumeration.justified_absences に根拠を残す
// （根拠を読む経路が無いと fail-closed が行き止まりになり、フラグを偽って true にする以外の逃げ道が消える）。
//
// 部品固有の条件分岐を持たない。新しい部品はプロファイルの追加だけで足せる
// （契約は references/coverage-profiles.md、形式は assets/coverage-profiles/profile-schema.json）。
//
// 決定論的: 乱数・現在時刻に依存しない。入力順を保って展開する。
// TypeScript 構文は使わない（型は JSDoc）。

import { readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ツールのバージョン（正本）。展開規則・照合規則・出力形状を変えたら上げる。
 * 被覆表の conformance.tool_version に記録する値はこれを使う（手入力にしない）。
 * @type {string}
 */
export const VERSION = "1";

/** 被覆表のセルが取りうる値（正本は coverage.md「部品被覆表」）。 */
const VALUES = ["present", "absent", "unmeasured"];

/** 候補 id の区切り。軸値に含まれると id が衝突するため、列挙時に禁止する。 */
const ID_SEPARATOR = "/";

/**
 * 空でない文字列か。
 * @param {unknown} v
 * @returns {boolean}
 */
function nonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * JSON オブジェクト（配列でない）か。配列は typeof で "object" を通るため明示的に弾く。
 * @param {unknown} v
 * @returns {boolean}
 */
function isPlainObject(v) {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

/**
 * プロファイルの形式を検査する。壊れたプロファイルを静かに無視すると、
 * 候補ゼロ＝「照合するものが無い」で素通りするため、その場で問題として返す。
 * @param {unknown} profile
 * @param {string} source - 由来（エラーメッセージ用）
 * @returns {string[]} 問題の一覧（空なら妥当）
 */
export function validateProfile(profile, source) {
  /** @type {string[]} */
  const problems = [];
  const at = (msg) => problems.push(`${source}: ${msg}`);
  if (!isPlainObject(profile)) {
    at("プロファイルが JSON オブジェクトではない");
    return problems;
  }
  const p = /** @type {Record<string, unknown>} */ (profile);
  if (!nonEmptyString(p.id)) at("id が空");
  if (!nonEmptyString(p.version)) at("version が空");
  if (!nonEmptyString(p.applies_to)) at("applies_to が空（プロファイル選択の判断材料が残らない）");

  const axes = Array.isArray(p.axes) ? p.axes : [];
  if (axes.length === 0) at("axes が空");
  /** @type {Map<string, {kind: string, values: string[], flags: string[]}>} */
  const axisById = new Map();
  axes.forEach((axis, i) => {
    if (!isPlainObject(axis)) {
      at(`axes[${i}]: JSON オブジェクトではない`);
      return;
    }
    const a = /** @type {Record<string, unknown>} */ (axis);
    if (!nonEmptyString(a.id)) {
      at(`axes[${i}]: id が空`);
      return;
    }
    const id = String(a.id);
    if (axisById.has(id)) {
      at(`axes[${i}]: 軸 id ${id} が重複している`);
      return;
    }
    if (a.kind !== "element" && a.kind !== "enum") {
      at(`軸 ${id}: kind が element / enum のいずれでもない`);
      return;
    }
    const values = Array.isArray(a.values) ? a.values.filter(nonEmptyString).map(String) : [];
    const flags = Array.isArray(a.flags) ? a.flags.filter(nonEmptyString).map(String) : [];
    if (a.kind === "enum" && values.length === 0) {
      at(`軸 ${id}: kind: enum なのに values が空（候補が 0 件になる）`);
    }
    if (a.kind === "enum" && values.some((v) => v.includes(ID_SEPARATOR))) {
      at(`軸 ${id}: values に "${ID_SEPARATOR}" を含む値がある（候補 id が衝突する）`);
    }
    axisById.set(id, { kind: String(a.kind), values, flags });
  });

  const rules = Array.isArray(p.candidate_rules) ? p.candidate_rules : [];
  if (rules.length === 0) at("candidate_rules が空");
  /** @type {Set<string>} */
  const ruleIds = new Set();
  rules.forEach((rule, i) => {
    if (!isPlainObject(rule)) {
      at(`candidate_rules[${i}]: JSON オブジェクトではない`);
      return;
    }
    const r = /** @type {Record<string, unknown>} */ (rule);
    if (!nonEmptyString(r.id)) {
      at(`candidate_rules[${i}]: id が空`);
      return;
    }
    const rid = String(r.id);
    if (rid.includes(ID_SEPARATOR))
      at(`ルール ${rid}: id に "${ID_SEPARATOR}" を含む（候補 id が衝突する）`);
    if (ruleIds.has(rid)) {
      at(`candidate_rules[${i}]: ルール id ${rid} が重複している`);
      return;
    }
    ruleIds.add(rid);
    const ruleAxes = Array.isArray(r.axes) ? r.axes : [];
    if (ruleAxes.length === 0) at(`ルール ${rid}: axes が空`);
    for (const axisId of ruleAxes) {
      if (!axisById.has(String(axisId)))
        at(`ルール ${rid}: 未定義の軸 ${String(axisId)} を参照している`);
    }
    if (r.guard !== undefined) {
      if (!isPlainObject(r.guard)) {
        at(`ルール ${rid}: guard が JSON オブジェクトではない`);
      } else {
        for (const [key, value] of Object.entries(
          /** @type {Record<string, unknown>} */ (r.guard),
        )) {
          const dot = key.indexOf(".");
          const axisId = dot === -1 ? "" : key.slice(0, dot);
          const flag = dot === -1 ? "" : key.slice(dot + 1);
          const axis = axisById.get(axisId);
          if (!axis) {
            at(`ルール ${rid}: guard のキー ${key} が <軸 id>.<フラグ名> の形になっていない`);
            continue;
          }
          if (axis.kind !== "element")
            at(`ルール ${rid}: guard は element 軸にしか置けない（${key}）`);
          // 宣言されていないフラグ名は誤記の可能性が高く、黙って「該当なし」＝候補ゼロで通る。
          else if (!axis.flags.includes(flag))
            at(`ルール ${rid}: 軸 ${axisId} に宣言の無いフラグ ${flag} を参照している`);
          if (typeof value !== "boolean") at(`ルール ${rid}: guard ${key} の値が真偽値ではない`);
          if (!ruleAxes.map(String).includes(axisId))
            at(`ルール ${rid}: guard が axes に無い軸 ${axisId} を参照している`);
        }
      }
    }
  });

  const required = Array.isArray(p.required_rules) ? p.required_rules : [];
  for (const rid of required) {
    if (!ruleIds.has(String(rid)))
      at(`required_rules: 未定義のルール ${String(rid)} を参照している`);
  }

  // enumeration ブロックは形式の正本（profile-schema.json）が必須にしている。
  // とくに sources が空だと readEnumeration の source.kind 検査が「候補ゼロ」で黙って素通りし、
  // どの列挙元でも通ってしまう（fail-open）。procedure / fail_closed / pitfalls が空のプロファイルは
  // 列挙手順・落ちやすい経路・ソースを読めない場合の扱いを持たないまま配布されるため、ここで落とす。
  const enumeration = isPlainObject(p.enumeration)
    ? /** @type {Record<string, unknown>} */ (p.enumeration)
    : null;
  if (!enumeration) {
    at("enumeration が無い（列挙元・手順・fail-closed の扱いが宣言されていない）");
  } else {
    const sources = Array.isArray(enumeration.sources)
      ? enumeration.sources.filter(nonEmptyString)
      : [];
    if (sources.length === 0) {
      at("enumeration.sources が空（列挙元の kind を検査できず、どの値でも通る）");
    }
    for (const key of ["procedure", "fail_closed"]) {
      if (!nonEmptyString(enumeration[key])) at(`enumeration.${key} が空`);
    }
    const pitfalls = Array.isArray(enumeration.pitfalls)
      ? enumeration.pitfalls.filter(nonEmptyString)
      : [];
    if (pitfalls.length === 0) {
      at("enumeration.pitfalls が空（列挙から落ちやすい経路が宣言されていない）");
    }
  }

  const equivalence = isPlainObject(p.equivalence)
    ? /** @type {Record<string, unknown>} */ (p.equivalence)
    : null;
  if (equivalence) {
    const reducible = Array.isArray(equivalence.reducible_axes) ? equivalence.reducible_axes : [];
    for (const axisId of reducible) {
      if (!axisById.has(String(axisId)))
        at(`equivalence.reducible_axes: 未定義の軸 ${String(axisId)} を参照している`);
    }
  }
  return problems;
}

/**
 * 同梱プロファイルを読み込む。壊れたものは無視せず問題として返す（静かな候補ゼロを作らない）。
 * @param {string} dir - プロファイルディレクトリ
 * @param {{readdir?: (d: string) => string[], readFile?: (p: string) => string}} [deps]
 * @returns {{profiles: Map<string, Record<string, unknown>>, problems: string[]}}
 */
export function loadProfiles(dir, deps = {}) {
  const readdir = deps.readdir ?? ((d) => readdirSync(d));
  const readFile = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
  /** @type {Map<string, Record<string, unknown>>} */
  const profiles = new Map();
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  let names;
  try {
    names = readdir(dir);
  } catch (e) {
    return { profiles, problems: [`プロファイルディレクトリを読めない: ${dir}: ${String(e)}`] };
  }
  // 読み込み順を固定して決定論的にする（readdir の順序は環境依存）。
  for (const name of [...names].sort()) {
    if (!name.endsWith(".json")) continue;
    // スキーマ（形式の説明）はプロファイル実体ではない。
    if (name === "profile-schema.json") continue;
    const path = join(dir, name);
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(readFile(path));
    } catch (e) {
      problems.push(`${name}: JSON として読めない: ${String(e)}`);
      continue;
    }
    const found = validateProfile(parsed, name);
    if (found.length > 0) {
      problems.push(...found);
      continue;
    }
    const p = /** @type {Record<string, unknown>} */ (parsed);
    const id = String(p.id);
    if (id !== name.slice(0, -".json".length)) {
      problems.push(`${name}: id（${id}）がファイル名と一致しない`);
      continue;
    }
    if (profiles.has(id)) {
      problems.push(`${name}: プロファイル id ${id} が重複している`);
      continue;
    }
    profiles.set(id, p);
  }
  return { profiles, problems };
}

/**
 * インスタンスの列挙（enumeration）を検査して element 軸ごとの要素を取り出す。
 * @param {unknown} enumeration
 * @param {Record<string, unknown>} profile
 * @param {string} label - エラーメッセージ用のラベル
 * @returns {{elements: Map<string, Array<{id: string, flags: Record<string, boolean>}>>, problems: string[], usable: boolean}}
 */
export function readEnumeration(enumeration, profile, label) {
  /** @type {string[]} */
  const problems = [];
  /** @type {Map<string, Array<{id: string, flags: Record<string, boolean>}>>} */
  const elements = new Map();
  if (!isPlainObject(enumeration)) {
    problems.push(`${label}: enumeration が無い（候補を展開できない。未列挙として扱う）`);
    return { elements, problems, usable: false };
  }
  const en = /** @type {Record<string, unknown>} */ (enumeration);

  const source = isPlainObject(en.source)
    ? /** @type {Record<string, unknown>} */ (en.source)
    : null;
  if (!source) {
    problems.push(`${label}: enumeration.source が無い（来歴が残らない）`);
  } else {
    for (const key of ["kind", "ref", "version", "extracted_at", "condition"]) {
      if (!nonEmptyString(source[key])) problems.push(`${label}: enumeration.source.${key} が空`);
    }
    const allowed = isPlainObject(profile.enumeration)
      ? /** @type {Record<string, unknown>} */ (profile.enumeration).sources
      : null;
    const kinds = Array.isArray(allowed) ? allowed.map(String) : [];
    if (kinds.length > 0 && nonEmptyString(source.kind) && !kinds.includes(String(source.kind))) {
      problems.push(
        `${label}: enumeration.source.kind（${String(source.kind)}）がプロファイルの sources にない`,
      );
    }
  }

  // complete: false は「ソースを読めなかった」の記録。候補を展開せず未列挙として扱う（fail-closed）。
  // 真偽値でないときも合格に倒さない（未設定を「完全」と読まない）。
  if (en.complete !== true) {
    if (en.complete === false) {
      if (!nonEmptyString(en.incomplete_reason)) {
        problems.push(
          `${label}: complete: false なのに incomplete_reason が空（不足と実 UI からの列挙手順が残らない）`,
        );
      } else {
        problems.push(
          `${label}: 列挙が未完了（${String(en.incomplete_reason)}）— 確認済みにしない`,
        );
      }
    } else {
      problems.push(
        `${label}: enumeration.complete が true ではない（未設定を「完全」と読まない）`,
      );
    }
    return { elements, problems, usable: false };
  }

  const axes = Array.isArray(profile.axes) ? profile.axes : [];
  const raw = isPlainObject(en.elements)
    ? /** @type {Record<string, unknown>} */ (en.elements)
    : {};
  if (!isPlainObject(en.elements))
    problems.push(`${label}: enumeration.elements が JSON オブジェクトではない`);
  for (const axis of axes) {
    const a = /** @type {Record<string, unknown>} */ (axis);
    if (a.kind !== "element") continue;
    const axisId = String(a.id);
    const declaredFlags = Array.isArray(a.flags) ? a.flags.map(String) : [];
    const list = Array.isArray(raw[axisId]) ? /** @type {unknown[]} */ (raw[axisId]) : null;
    if (list === null) {
      // 軸ごと欠けているのは「その軸の要素が無い」ではなく「列挙していない」。空配列と区別する。
      problems.push(`${label}: 軸 ${axisId} の列挙が無い（要素が無いなら空配列と根拠を残す）`);
      elements.set(axisId, []);
      continue;
    }
    /** @type {Array<{id: string, flags: Record<string, boolean>}>} */
    const parsed = [];
    /** @type {Set<string>} */
    const seen = new Set();
    list.forEach((el, i) => {
      if (!isPlainObject(el)) {
        problems.push(`${label}: 軸 ${axisId}[${i}] が JSON オブジェクトではない`);
        return;
      }
      const e = /** @type {Record<string, unknown>} */ (el);
      if (!nonEmptyString(e.id)) {
        problems.push(`${label}: 軸 ${axisId}[${i}]: id が空（候補 id を組めない）`);
        return;
      }
      const id = String(e.id);
      if (id.includes(ID_SEPARATOR)) {
        problems.push(
          `${label}: 軸 ${axisId} の要素 ${id}: id に "${ID_SEPARATOR}" を含む（候補 id が衝突する）`,
        );
        return;
      }
      if (seen.has(id)) {
        problems.push(`${label}: 軸 ${axisId} の要素 ${id} が重複している（先勝ちにしない）`);
        return;
      }
      seen.add(id);
      /** @type {Record<string, boolean>} */
      const flags = {};
      const rawFlags = isPlainObject(e.flags)
        ? /** @type {Record<string, unknown>} */ (e.flags)
        : {};
      for (const flag of declaredFlags) {
        const v = rawFlags[flag];
        if (typeof v !== "boolean") {
          problems.push(
            `${label}: 軸 ${axisId} の要素 ${id}: フラグ ${flag} が真偽値で記録されていない`,
          );
          flags[flag] = false;
          continue;
        }
        flags[flag] = v;
      }
      for (const key of Object.keys(rawFlags)) {
        if (!declaredFlags.includes(key)) {
          problems.push(
            `${label}: 軸 ${axisId} の要素 ${id}: プロファイルに宣言の無いフラグ ${key} がある`,
          );
        }
      }
      parsed.push({ id, flags });
    });
    elements.set(axisId, parsed);
  }

  const { absences, problems: absenceProblems } = readJustifiedAbsences(
    en.justified_absences,
    elements,
    label,
  );
  problems.push(...absenceProblems);
  return { elements, absences, problems, usable: problems.length === 0 };
}

/**
 * 「その軸／その要素は無い」の根拠（enumeration.justified_absences）を読む。
 * 根拠を読む経路が無いと、候補ゼロの fail-closed が行き止まりになり、
 * 「実際には無いのにフラグを true と偽って absent を測る」以外の逃げ道が消える。
 * scope は `<軸 id>`（軸ごと空）か `<軸 id>/<要素 id>`（要素は在るがどの候補にもならない）。
 * @param {unknown} raw - enumeration.justified_absences
 * @param {Map<string, Array<{id: string, flags: Record<string, boolean>}>>} elements
 * @param {string} label
 * @returns {{absences: {axes: Set<string>, elements: Set<string>}, problems: string[]}}
 */
export function readJustifiedAbsences(raw, elements, label) {
  /** @type {string[]} */
  const problems = [];
  /** @type {Set<string>} */
  const axes = new Set();
  /** @type {Set<string>} */
  const elementScopes = new Set();
  if (raw === undefined) return { absences: { axes, elements: elementScopes }, problems };
  if (!Array.isArray(raw)) {
    problems.push(`${label}: justified_absences が配列ではない`);
    return { absences: { axes, elements: elementScopes }, problems };
  }
  raw.forEach((entry, i) => {
    if (!isPlainObject(entry)) {
      problems.push(`${label}: justified_absences[${i}] が JSON オブジェクトではない`);
      return;
    }
    const e = /** @type {Record<string, unknown>} */ (entry);
    if (!nonEmptyString(e.scope)) {
      problems.push(`${label}: justified_absences[${i}]: scope が空`);
      return;
    }
    if (!nonEmptyString(e.reason)) {
      // 根拠のない免除は「測っていない」と区別が付かない。
      problems.push(
        `${label}: justified_absences[${i}]（${String(e.scope)}）: reason が空（無いことを確かめた手順が残らない）`,
      );
      return;
    }
    const scope = String(e.scope);
    const sep = scope.indexOf(ID_SEPARATOR);
    const axisId = sep === -1 ? scope : scope.slice(0, sep);
    const list = elements.get(axisId);
    if (list === undefined) {
      problems.push(
        `${label}: justified_absences[${i}]: 未定義の element 軸 ${axisId} を参照している`,
      );
      return;
    }
    if (sep === -1) {
      if (list.length > 0) {
        // 軸ごとの免除は「1 件も列挙されていない」ときだけ。要素が在るなら要素ごとに根拠を出す。
        problems.push(
          `${label}: justified_absences[${i}]: 軸 ${axisId} には要素が ${list.length} 件あり、軸ごとの免除は使えない（要素ごとの scope にする）`,
        );
        return;
      }
      axes.add(axisId);
      return;
    }
    const elementId = scope.slice(sep + 1);
    if (!list.some((el) => el.id === elementId)) {
      problems.push(
        `${label}: justified_absences[${i}]: 軸 ${axisId} に列挙されていない要素 ${elementId} を参照している`,
      );
      return;
    }
    elementScopes.add(scope);
  });
  return { absences: { axes, elements: elementScopes }, problems };
}

/**
 * プロファイルの candidate_rules とインスタンスの列挙から候補集合を展開する。
 * 候補 id は `<ルール id>/<軸値をルールの axes 順に "/" 連結>` で決定論的に組む。
 * @param {Record<string, unknown>} profile
 * @param {Map<string, Array<{id: string, flags: Record<string, boolean>}>>} elements
 * @returns {Array<{id: string, rule: string, axes: Record<string, string>}>}
 */
export function expandCandidates(profile, elements) {
  const axes = Array.isArray(profile.axes) ? profile.axes : [];
  /** @type {Map<string, {kind: string, values: string[]}>} */
  const axisById = new Map();
  for (const axis of axes) {
    const a = /** @type {Record<string, unknown>} */ (axis);
    axisById.set(String(a.id), {
      kind: String(a.kind),
      values: Array.isArray(a.values) ? a.values.map(String) : [],
    });
  }
  const rules = Array.isArray(profile.candidate_rules) ? profile.candidate_rules : [];
  /** @type {Array<{id: string, rule: string, axes: Record<string, string>}>} */
  const candidates = [];
  for (const rule of rules) {
    const r = /** @type {Record<string, unknown>} */ (rule);
    const ruleId = String(r.id);
    const ruleAxes = (Array.isArray(r.axes) ? r.axes : []).map(String);
    const guard = isPlainObject(r.guard) ? /** @type {Record<string, boolean>} */ (r.guard) : {};
    /** @type {Array<Array<{value: string, flags: Record<string, boolean>}>>} */
    const columns = [];
    let expandable = true;
    for (const axisId of ruleAxes) {
      const axis = axisById.get(axisId);
      if (!axis) {
        expandable = false;
        break;
      }
      if (axis.kind === "enum") {
        columns.push(axis.values.map((value) => ({ value, flags: {} })));
        continue;
      }
      const list = elements.get(axisId) ?? [];
      // guard はこの軸のフラグだけを見る。全て満たす要素だけが候補になる。
      const filtered = list.filter((el) =>
        Object.entries(guard).every(([key, want]) => {
          const dot = key.indexOf(".");
          if (dot === -1 || key.slice(0, dot) !== axisId) return true;
          return el.flags[key.slice(dot + 1)] === want;
        }),
      );
      columns.push(filtered.map((el) => ({ value: el.id, flags: el.flags })));
    }
    if (!expandable || columns.some((c) => c.length === 0)) continue;
    // 直積を入力順で展開する（最後の軸が最も速く回る）。
    /** @type {string[][]} */
    let rows = [[]];
    for (const column of columns) {
      /** @type {string[][]} */
      const next = [];
      for (const row of rows) for (const cell of column) next.push([...row, cell.value]);
      rows = next;
    }
    for (const row of rows) {
      /** @type {Record<string, string>} */
      const axisValues = {};
      ruleAxes.forEach((axisId, i) => {
        axisValues[axisId] = row[i];
      });
      candidates.push({ id: [ruleId, ...row].join(ID_SEPARATOR), rule: ruleId, axes: axisValues });
    }
  }
  return candidates;
}

/**
 * 必須ルールの候補ゼロが「根拠付きで空」かを判定する。
 * ルールが使う element 軸のうち 1 つでも、軸ごと空（軸スコープの免除あり）か
 * 全要素が要素スコープの免除を持つなら、そのルールが 0 件になるのは説明が付く。
 * @param {Record<string, unknown>} profile
 * @param {string} ruleId
 * @param {Map<string, Array<{id: string, flags: Record<string, boolean>}>>} elements
 * @param {{axes: Set<string>, elements: Set<string>}} absences
 * @returns {string[]|null} 根拠になった scope の一覧。説明が付かなければ null
 */
export function justifiedEmptyAxis(profile, ruleId, elements, absences) {
  const rules = Array.isArray(profile.candidate_rules) ? profile.candidate_rules : [];
  const rule = rules.find(
    (r) => isPlainObject(r) && String(/** @type {Record<string, unknown>} */ (r).id) === ruleId,
  );
  if (!rule) return null;
  const ruleAxes = (
    Array.isArray(/** @type {Record<string, unknown>} */ (rule).axes)
      ? /** @type {unknown[]} */ (/** @type {Record<string, unknown>} */ (rule).axes)
      : []
  ).map(String);
  for (const axisId of ruleAxes) {
    const list = elements.get(axisId);
    if (list === undefined) continue; // enum 軸は列挙を持たないので免除の対象外
    if (list.length === 0) {
      if (absences.axes.has(axisId)) return [axisId];
      continue;
    }
    const scopes = list.map((el) => `${axisId}${ID_SEPARATOR}${el.id}`);
    if (scopes.every((scope) => absences.elements.has(scope))) return scopes;
  }
  return null;
}

/**
 * 同値クラスを検査する。宣言が空なら削減していない（全候補を個別に採取した）とみなして検査しない。
 * 1 つでも宣言されたら、全候補の所属を要求する（部分的な削減を「宣言した分だけ」で通さない）。
 * @param {unknown} classes - components[].equivalence_classes
 * @param {Record<string, unknown>} profile
 * @param {Map<string, {rule: string, axes: Record<string, string>}>} candidateIndex - "<instance>/<candidate>" → 候補
 * @param {string} label
 * @returns {string[]}
 */
export function checkEquivalenceClasses(classes, profile, candidateIndex, label) {
  /** @type {string[]} */
  const problems = [];
  const list = Array.isArray(classes) ? classes : [];
  if (list.length === 0) return problems;
  const equivalence = isPlainObject(profile.equivalence)
    ? /** @type {Record<string, unknown>} */ (profile.equivalence)
    : {};
  const reducible = Array.isArray(equivalence.reducible_axes)
    ? equivalence.reducible_axes.map(String)
    : [];

  /** @type {Map<string, string>} メンバー → 最初に所属したクラス id */
  const owner = new Map();
  /** @type {Set<string>} */
  const classIds = new Set();
  list.forEach((cls, i) => {
    if (!isPlainObject(cls)) {
      problems.push(`${label}: equivalence_classes[${i}] が JSON オブジェクトではない`);
      return;
    }
    const c = /** @type {Record<string, unknown>} */ (cls);
    const cid = nonEmptyString(c.id) ? String(c.id) : `#${i}`;
    if (!nonEmptyString(c.id)) problems.push(`${label}: equivalence_classes[${i}]: id が空`);
    else if (classIds.has(cid)) problems.push(`${label}: 同値クラス ${cid} の id が重複している`);
    classIds.add(cid);
    if (!nonEmptyString(c.rationale)) {
      problems.push(
        `${label}: 同値クラス ${cid}: rationale が空（「同じに見えたから」は根拠にしない）`,
      );
    }
    const axisId = nonEmptyString(c.axis) ? String(c.axis) : null;
    if (!axisId)
      problems.push(`${label}: 同値クラス ${cid}: axis が空（どの軸で束ねたか残らない）`);
    else if (!reducible.includes(axisId)) {
      problems.push(
        `${label}: 同値クラス ${cid}: 軸 ${axisId} は reducible_axes にない（束ねると差分が見えなくなる）`,
      );
    }

    const members = (Array.isArray(c.members) ? c.members : []).filter(nonEmptyString).map(String);
    if (members.length === 0) {
      problems.push(`${label}: 同値クラス ${cid}: members が空`);
      return;
    }
    /** @type {Array<{rule: string, axes: Record<string, string>}>} */
    const resolved = [];
    for (const member of members) {
      const candidate = candidateIndex.get(member);
      if (!candidate) {
        problems.push(`${label}: 同値クラス ${cid}: 候補に無いメンバー ${member} を参照している`);
        continue;
      }
      const previous = owner.get(member);
      if (previous !== undefined) {
        problems.push(
          `${label}: 候補 ${member} が同値クラス ${previous} と ${cid} の両方に属している`,
        );
        continue;
      }
      owner.set(member, cid);
      resolved.push(candidate);
    }
    const representative = nonEmptyString(c.representative) ? String(c.representative) : null;
    if (!representative)
      problems.push(`${label}: 同値クラス ${cid}: representative が空（採取する候補が決まらない）`);
    else if (!members.includes(representative)) {
      problems.push(
        `${label}: 同値クラス ${cid}: representative ${representative} が members に含まれていない`,
      );
    }
    // 束ねてよいのは宣言した軸だけ。他の軸やルールが違うメンバーが混ざると、
    // 代表 1 件の採取では別物の差分が見えなくなる。
    if (axisId && resolved.length > 1) {
      const [first, ...rest] = resolved;
      for (const other of rest) {
        if (other.rule !== first.rule) {
          problems.push(
            `${label}: 同値クラス ${cid}: ルールの違う候補が混ざっている（${first.rule} と ${other.rule}）`,
          );
          break;
        }
      }
      const sharedAxes = Object.keys(first.axes).filter((a) => a !== axisId);
      for (const other of resolved) {
        for (const a of sharedAxes) {
          if (other.axes[a] !== first.axes[a]) {
            problems.push(`${label}: 同値クラス ${cid}: 軸 ${axisId} 以外（${a}）でも束ねている`);
            break;
          }
        }
      }
    }
  });

  for (const key of candidateIndex.keys()) {
    if (!owner.has(key)) {
      problems.push(
        `${label}: 候補 ${key} がどの同値クラスにも属していない（削減するなら全候補の所属が要る）`,
      );
    }
  }
  return problems;
}

/**
 * 被覆表とプロファイルを照合する。
 * @param {unknown} coverage - component-coverage.json をパースしたもの
 * @param {Map<string, Record<string, unknown>>} profiles
 * @returns {{ok: boolean, components: Array<Record<string, unknown>>, problems: string[], candidates: number, unmeasured: number}}
 */
export function reconcile(coverage, profiles) {
  /** @type {string[]} */
  const problems = [];
  /** @type {Array<Record<string, unknown>>} */
  const report = [];
  let candidateTotal = 0;
  let unmeasured = 0;
  if (!isPlainObject(coverage)) {
    return {
      ok: false,
      components: [],
      problems: ["被覆表が JSON オブジェクトではない"],
      candidates: 0,
      unmeasured: 1,
    };
  }
  const cov = /** @type {Record<string, unknown>} */ (coverage);
  const components = Array.isArray(cov.components) ? cov.components : [];
  if (components.length === 0) problems.push("components が空");

  // セル行を 部品／項目／インスタンス で索引する（キーは JSON 配列にして区切り文字の衝突を避ける）。
  const rows = Array.isArray(cov.cells) ? cov.cells : [];
  /** @type {Map<string, Record<string, unknown>>} */
  const byKey = new Map();
  /** @type {Set<string>} */
  const duplicated = new Set();
  const keyOf = (c, i, n) => JSON.stringify([c, i, n]);
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    const r = /** @type {Record<string, unknown>} */ (row);
    if (!nonEmptyString(r.component) || !nonEmptyString(r.item) || !nonEmptyString(r.instance))
      continue;
    const key = keyOf(String(r.component), String(r.item), String(r.instance));
    if (byKey.has(key)) duplicated.add(key);
    else byKey.set(key, r);
  }

  for (const [index, component] of components.entries()) {
    if (!isPlainObject(component)) {
      problems.push(`components[${index}]: JSON オブジェクトではない`);
      continue;
    }
    const c = /** @type {Record<string, unknown>} */ (component);
    const cid = nonEmptyString(c.id) ? String(c.id) : `#${index}`;
    if (!nonEmptyString(c.id)) problems.push(`components[${index}]: id が空`);

    // profile キーの欠落を「汎用扱い」に倒さない。プロファイル無しを選ぶには理由が要る。
    if (!("profile" in c)) {
      problems.push(
        `部品 ${cid}: profile キーが無い（適合プロファイルが無いなら profile: null ＋ profile_absent_reason を書く。暗黙の汎用扱いにしない）`,
      );
      continue;
    }
    if (c.profile === null) {
      if (!nonEmptyString(c.profile_absent_reason)) {
        problems.push(
          `部品 ${cid}: profile: null なのに profile_absent_reason が空（未検証の根拠が残らない）`,
        );
      }
      report.push({
        component: cid,
        profile: null,
        judged: false,
        reason: nonEmptyString(c.profile_absent_reason) ? String(c.profile_absent_reason) : null,
      });
      continue;
    }
    if (!nonEmptyString(c.profile)) {
      problems.push(`部品 ${cid}: profile が空でない文字列でも null でもない`);
      continue;
    }
    const profileId = String(c.profile);
    const profile = profiles.get(profileId);
    if (!profile) {
      problems.push(`部品 ${cid}: プロファイル ${profileId} が同梱ディレクトリに無い`);
      continue;
    }
    if (
      nonEmptyString(c.profile_version) &&
      String(c.profile_version) !== String(profile.version)
    ) {
      problems.push(
        `部品 ${cid}: 記録されたプロファイル版（${String(c.profile_version)}）が同梱プロファイル（${String(profile.version)}）と違う — 候補を展開し直す`,
      );
    }

    const instances = Array.isArray(c.instances) ? c.instances : [];
    if (instances.length === 0) problems.push(`部品 ${cid}: instances が空（列挙が起きていない）`);

    // 項目 id → 記録された candidate（余剰の検出に使う）。
    const items = Array.isArray(c.items) ? c.items : [];
    /** @type {Map<string, Record<string, unknown>>} */
    const itemById = new Map();
    for (const [i, item] of items.entries()) {
      if (!isPlainObject(item)) {
        problems.push(`部品 ${cid}: items[${i}] が JSON オブジェクトではない`);
        continue;
      }
      const it = /** @type {Record<string, unknown>} */ (item);
      if (!nonEmptyString(it.id)) {
        problems.push(`部品 ${cid}: items[${i}]: id が空`);
        continue;
      }
      if (itemById.has(String(it.id))) {
        problems.push(`部品 ${cid}: 項目 id ${String(it.id)} が重複している`);
        continue;
      }
      itemById.set(String(it.id), it);
    }

    /** @type {Map<string, {rule: string, axes: Record<string, string>}>} */
    const candidateIndex = new Map();
    /** @type {Array<Record<string, unknown>>} */
    const instanceReports = [];
    /** @type {Set<string>} */
    const seenInstances = new Set();

    for (const [i, instance] of instances.entries()) {
      if (!isPlainObject(instance)) {
        problems.push(`部品 ${cid}: instances[${i}] が JSON オブジェクトではない`);
        continue;
      }
      const inst = /** @type {Record<string, unknown>} */ (instance);
      const iid = nonEmptyString(inst.id) ? String(inst.id) : `#${i}`;
      if (!nonEmptyString(inst.id)) {
        problems.push(`部品 ${cid}: instances[${i}]: id が空`);
        continue;
      }
      // インスタンス id は候補キー（"<インスタンス id>/<候補 id>"）と同値クラスの members の前半になる。
      // 区切り文字を含むと前半と後半を切り分けられず、余剰判定が全項目を誤検出する。
      if (iid.includes(ID_SEPARATOR)) {
        problems.push(
          `部品 ${cid}: instances[${i}]: id ${iid} に "${ID_SEPARATOR}" を含む（候補キー・同値クラスの members が切り分けられない）`,
        );
        continue;
      }
      if (seenInstances.has(iid)) {
        problems.push(`部品 ${cid}: インスタンス id ${iid} が重複している（先勝ちにしない）`);
        continue;
      }
      seenInstances.add(iid);
      const label = `部品 ${cid} / インスタンス ${iid}`;
      const {
        elements,
        absences,
        problems: enumProblems,
        usable,
      } = readEnumeration(inst.enumeration, profile, label);
      problems.push(...enumProblems);
      if (!usable) {
        // 列挙できないインスタンスは候補ゼロで素通りさせず、1 件の未測定として数える。
        unmeasured += 1;
        instanceReports.push({ instance: iid, usable: false, candidates: 0 });
        continue;
      }

      const candidates = expandCandidates(profile, elements);
      const required = Array.isArray(profile.required_rules)
        ? profile.required_rules.map(String)
        : [];
      const usedAbsences = new Set();
      for (const rid of required) {
        if (candidates.some((cand) => cand.rule === rid)) continue;
        // 「その部品には無い」の主張は、ルールが使う element 軸のいずれかが
        // 根拠付きで空（軸ごと空、または全要素が要素ごとの免除を持つ）のときだけ通す。
        const justifiedBy = justifiedEmptyAxis(profile, rid, elements, absences);
        if (justifiedBy) {
          for (const scope of justifiedBy) usedAbsences.add(scope);
          continue;
        }
        problems.push(
          `${label}: 必須ルール ${rid} の候補が 0 件（列挙されていないのか、その部品に無いのかを区別できない。無いなら enumeration.justified_absences に根拠を残す）`,
        );
        unmeasured += 1;
      }
      // 列挙した要素が候補へ 1 件も現れないのは、フラグの記録漏れかルールの取りこぼし。
      // 「40 列を列挙したが候補は代表 1 列だけ」をここで落とす。
      // 根拠付きの免除（justified_absences）がある要素だけを通す。
      for (const [axisId, list] of elements) {
        for (const el of list) {
          if (candidates.some((cand) => cand.axes[axisId] === el.id)) continue;
          const scope = `${axisId}${ID_SEPARATOR}${el.id}`;
          if (absences.elements.has(scope)) {
            usedAbsences.add(scope);
            continue;
          }
          problems.push(
            `${label}: 列挙した ${axisId} の要素 ${el.id} がどの候補にも現れない（フラグの記録漏れか、ルールの取りこぼし。意図的なら enumeration.justified_absences に根拠を残す）`,
          );
          unmeasured += 1;
        }
      }
      // 使われない免除を黙って残さない（状況が変わったのに根拠だけが残る＝古い免除が効いているように見える）。
      for (const scope of [...absences.axes, ...absences.elements]) {
        if (!usedAbsences.has(scope)) {
          problems.push(
            `${label}: justified_absences の ${scope} は効いていない（候補が展開されている。古い免除を残さない）`,
          );
        }
      }

      candidateTotal += candidates.length;
      for (const cand of candidates) {
        candidateIndex.set(`${iid}${ID_SEPARATOR}${cand.id}`, { rule: cand.rule, axes: cand.axes });
        const item = itemById.get(cand.id);
        if (!item) {
          problems.push(`${label}: 候補 ${cand.id} に対応する項目が被覆表に無い（欠落）`);
          unmeasured += 1;
          continue;
        }
        const recorded = isPlainObject(item.candidate)
          ? /** @type {Record<string, unknown>} */ (item.candidate)
          : null;
        if (!recorded) {
          problems.push(
            `${label}: 項目 ${cand.id} に candidate（ルール id と軸値）が記録されていない`,
          );
        } else {
          if (String(recorded.rule) !== cand.rule) {
            problems.push(
              `${label}: 項目 ${cand.id} の candidate.rule（${String(recorded.rule)}）が展開結果（${cand.rule}）と違う`,
            );
          }
          const recordedAxes = isPlainObject(recorded.axes)
            ? /** @type {Record<string, unknown>} */ (recorded.axes)
            : {};
          for (const [axisId, value] of Object.entries(cand.axes)) {
            if (String(recordedAxes[axisId]) !== value) {
              problems.push(
                `${label}: 項目 ${cand.id} の candidate.axes.${axisId}（${String(recordedAxes[axisId])}）が展開結果（${value}）と違う`,
              );
            }
          }
        }

        // セルの判定規則は coverage.md「部品被覆表」が正本。候補由来の期待セルへ同じ規則を当てる。
        const key = keyOf(cid, cand.id, iid);
        if (duplicated.has(key)) {
          problems.push(`${label}: 候補 ${cand.id} のセル行が複数ある（先勝ちにしない）`);
          unmeasured += 1;
          continue;
        }
        const row = byKey.get(key);
        if (!row) {
          problems.push(`${label}: 候補 ${cand.id} のセルが無い（行の無い組み合わせは未測定）`);
          unmeasured += 1;
          continue;
        }
        const value = row.value;
        if (typeof value !== "string" || !VALUES.includes(value)) {
          problems.push(
            `${label}: 候補 ${cand.id}: value が ${VALUES.join(" / ")} のいずれでもない`,
          );
          unmeasured += 1;
          continue;
        }
        if (value === "unmeasured") {
          unmeasured += 1;
          continue;
        }
        if (!nonEmptyString(row.evidence)) {
          problems.push(`${label}: 候補 ${cand.id}: value: ${value} なのに evidence が空`);
          unmeasured += 1;
          continue;
        }
        if (value === "present") {
          const coveredBy = Array.isArray(row.covered_by)
            ? row.covered_by.filter(nonEmptyString)
            : [];
          if (coveredBy.length === 0) {
            problems.push(
              `${label}: 候補 ${cand.id}: value: present なのに covered_by が空（assertion に落ちていない）`,
            );
            unmeasured += 1;
          }
        }
      }

      // 記録された候補が展開結果とズレていたら、parity-diff 側の数え直しが別物になる。
      if (Array.isArray(inst.candidates)) {
        const recorded = inst.candidates.filter(nonEmptyString).map(String);
        const expected = candidates.map((cand) => cand.id);
        const missing = expected.filter((id) => !recorded.includes(id));
        const extra = recorded.filter((id) => !expected.includes(id));
        if (missing.length > 0)
          problems.push(
            `${label}: instances[].candidates に展開結果の候補が足りない（${missing.length} 件）`,
          );
        if (extra.length > 0)
          problems.push(
            `${label}: instances[].candidates に展開結果に無い候補がある（${extra.length} 件）`,
          );
      } else {
        problems.push(
          `${label}: instances[].candidates が無い（parity-diff が数え直せない。--write で書き出す）`,
        );
      }
      instanceReports.push({ instance: iid, usable: true, candidates: candidates.length });
    }

    // 余剰: 候補集合に無い項目が candidate 付きで載っている（列挙とズレている）。
    // インスタンス id に区切り文字が無いことは上で保証済みなので、最初の区切りで切り分けられる。
    const candidateIds = new Set(
      [...candidateIndex.keys()].map((k) => k.slice(k.indexOf(ID_SEPARATOR) + 1)),
    );
    // 列挙できなかったインスタンスがあると候補集合が不完全なので、余剰の判定は行わない
    // （全項目が「余剰」に化けて本当の原因〈列挙の問題〉を覆い隠す）。
    if (instanceReports.every((r) => r.usable)) {
      for (const [itemId, item] of itemById) {
        if (item.candidate !== undefined && !candidateIds.has(itemId)) {
          problems.push(`部品 ${cid}: 項目 ${itemId} は候補集合に無い（列挙とズレている。余剰）`);
        }
      }
    }

    problems.push(
      ...checkEquivalenceClasses(c.equivalence_classes, profile, candidateIndex, `部品 ${cid}`),
    );
    report.push({
      component: cid,
      profile: profileId,
      profile_version: String(profile.version),
      judged: true,
      instances: instanceReports,
      candidates: [...candidateIndex.keys()].length,
    });
  }

  return {
    ok: problems.length === 0 && unmeasured === 0,
    components: report,
    problems,
    candidates: candidateTotal,
    unmeasured,
  };
}

/**
 * 被覆表へ展開結果（instances[].candidates と profile_version）を書き戻す。
 * 測定値（cells の value / evidence / covered_by）には触れない。
 * 照合の前に呼ぶ——記録された候補が古い／無いことを理由にした問題を、書き戻しで先に解消してから
 * 残る欠落だけを報告するため（書き戻しても直らない欠落だけが問題として残る）。
 * @param {Record<string, unknown>} coverage
 * @param {Map<string, Record<string, unknown>>} profiles
 * @returns {Record<string, unknown>}
 */
export function fillCandidates(coverage, profiles) {
  const components = Array.isArray(coverage.components) ? coverage.components : [];
  for (const component of components) {
    if (!isPlainObject(component)) continue;
    const c = /** @type {Record<string, unknown>} */ (component);
    if (!nonEmptyString(c.profile)) continue;
    const profile = profiles.get(String(c.profile));
    if (!profile) continue;
    c.profile_version = String(profile.version);
    const instances = Array.isArray(c.instances) ? c.instances : [];
    for (const instance of instances) {
      if (!isPlainObject(instance)) continue;
      const inst = /** @type {Record<string, unknown>} */ (instance);
      const label = `部品 ${String(c.id)} / インスタンス ${String(inst.id)}`;
      const { elements, usable } = readEnumeration(inst.enumeration, profile, label);
      inst.candidates = usable ? expandCandidates(profile, elements).map((cand) => cand.id) : [];
    }
  }
  return coverage;
}

/**
 * 照合結果を conformance として被覆表へ記録する。parity-diff はプロファイルを読まないため、
 * ここに残った ok が「展開ルールまで含めて適合したか」の唯一の記録になる。
 * @param {Record<string, unknown>} coverage
 * @param {{ok: boolean, problems: string[], candidates: number, unmeasured: number}} result
 * @returns {Record<string, unknown>}
 */
export function recordConformance(coverage, result) {
  coverage.conformance = {
    tool: "coverage-expand",
    tool_version: VERSION,
    ok: result.ok,
    candidates: result.candidates,
    unmeasured: result.unmeasured,
    problems: result.problems,
  };
  return coverage;
}

/**
 * CLI 本体。
 * `node coverage-expand.mjs --coverage <component-coverage.json> [--profiles <dir>] [--write]`
 * `node coverage-expand.mjs --list-profiles [--profiles <dir>]`
 * 終了コード: 0 ＝ 適合／1 ＝ 欠落・未測定・不整合が残る／2 ＝ 使い方の誤り・読み込み失敗。
 * @param {string[]} argv - process.argv.slice(2)
 * @param {{readFile?: (p: string) => string, readdir?: (d: string) => string[], writeFile?: (p: string, s: string) => void, defaultProfilesDir?: string}} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const readFile = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
  const writeFile = deps.writeFile ?? ((p, s) => writeFileSync(p, s));
  const usage =
    "usage: node coverage-expand.mjs --coverage <component-coverage.json> [--profiles <dir>] [--write]\n" +
    "       node coverage-expand.mjs --list-profiles [--profiles <dir>]\n";
  /** @type {Record<string, string>} */
  const opts = {};
  let write = false;
  let list = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--write") {
      write = true;
      continue;
    }
    if (a === "--list-profiles") {
      list = true;
      continue;
    }
    if (a === "--coverage" || a === "--profiles") {
      const v = argv[i + 1];
      if (v === undefined) {
        process.stderr.write(usage);
        return 2;
      }
      if (opts[a.slice(2)] !== undefined) {
        // 同じフラグの重複指定を黙って後勝ちにしない（どちらを読んだか出力から分からなくなる）。
        process.stderr.write(`error: ${a} が複数回指定されている\n${usage}`);
        return 2;
      }
      opts[a.slice(2)] = v;
      i += 1;
      continue;
    }
    process.stderr.write(`unknown argument: ${a}\n${usage}`);
    return 2;
  }
  if (!list && !opts.coverage) {
    process.stderr.write(usage);
    return 2;
  }

  const profilesDir =
    opts.profiles ??
    deps.defaultProfilesDir ??
    resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets", "coverage-profiles");
  const { profiles, problems: loadProblems } = loadProfiles(profilesDir, {
    readFile,
    readdir: deps.readdir,
  });
  for (const p of loadProblems) process.stderr.write(`error: プロファイル: ${p}\n`);
  if (loadProblems.length > 0) return 2;
  if (profiles.size === 0) {
    // 0 件を「照合するものが無い」で素通りさせない（同梱の取りこぼしを合格に倒さない）。
    process.stderr.write(`error: プロファイルが 1 件も読み込めなかった: ${profilesDir}\n`);
    return 2;
  }

  if (list) {
    process.stdout.write(
      `${JSON.stringify(
        {
          tool: "coverage-expand",
          version: VERSION,
          profiles_dir: profilesDir,
          profiles: [...profiles.values()].map((p) => ({
            id: String(p.id),
            version: String(p.version),
            name: String(p.name ?? ""),
            applies_to: String(p.applies_to ?? ""),
          })),
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  /** @type {unknown} */
  let coverage;
  try {
    coverage = JSON.parse(readFile(opts.coverage));
  } catch (e) {
    process.stderr.write(`error: 被覆表を読めない: ${opts.coverage}: ${String(e)}\n`);
    return 2;
  }

  if (write && !isPlainObject(coverage)) {
    process.stderr.write("error: 被覆表が JSON オブジェクトではないので書き戻せない\n");
    return 2;
  }
  // 書き戻しは照合の前に行う。候補の記録漏れを書き戻しで埋めたうえで、
  // 埋めても直らない欠落（項目・セルが無い、証拠が無い）だけを問題として残す。
  if (write) fillCandidates(/** @type {Record<string, unknown>} */ (coverage), profiles);
  const result = reconcile(coverage, profiles);
  if (write) {
    recordConformance(/** @type {Record<string, unknown>} */ (coverage), result);
    try {
      writeFile(opts.coverage, `${JSON.stringify(coverage, null, 2)}\n`);
    } catch (e) {
      process.stderr.write(`error: 被覆表を書き戻せない: ${opts.coverage}: ${String(e)}\n`);
      return 2;
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        tool: "coverage-expand",
        version: VERSION,
        profiles_dir: profilesDir,
        source: opts.coverage,
        written: write,
        ok: result.ok,
        candidates: result.candidates,
        unmeasured: result.unmeasured,
        components: result.components,
        problems: result.problems,
      },
      null,
      2,
    )}\n`,
  );
  for (const p of result.problems) process.stderr.write(`warn: ${p}\n`);
  if (result.unmeasured > 0) {
    process.stderr.write(
      `error: 候補由来の未測定 ${result.unmeasured} 件 / 候補 ${result.candidates} 件 — 収束させず測定へ戻す\n`,
    );
  }
  if (result.problems.length > 0) {
    process.stderr.write(
      `error: プロファイル適合の問題 ${result.problems.length} 件（上の warn を参照）\n`,
    );
  }
  return result.ok ? 0 : 1;
}

// CLI エントリ判定は両辺を実パスに解決してから突き合わせる。
// process.argv[1] は起動時のパスのまま、import.meta.url も --preserve-symlinks(-main)
// （NODE_OPTIONS 経由でも付く）では未解決のままなので、片側だけ解決すると
// シンボリックリンク経由（.claude/skills/<name> → .agents/skills/<name>）の起動で条件が偽になり、
// main() が呼ばれず何も出力せず exit 0 になる（サイレント no-op）。
const invokedAsCli = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    // 実パス解決に失敗したら生パスで突き合わせる（サイレント no-op より誤検出を選ぶ）。
    return entry === self;
  }
})();

if (invokedAsCli) {
  process.exit(main(process.argv.slice(2)));
}
