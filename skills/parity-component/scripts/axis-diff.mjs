#!/usr/bin/env node
// 部品インスタンス間で「固定の軸」と「可変の軸」を決定論的に割り出す（正本）。
//
// 何のためか: 共通部品の引数（props）は「どこが可変か」を決めてから設計する。これをモデルの
// 目視で決めると、現行に 6 種あるバリアントを 3 種で作る類の取りこぼしが、実装が終わってから
// 人の目でしか出ない（Issue #326 の往復 1 の実例）。同じ部品の複数インスタンスを採ってあれば、
// **インスタンス間で値が割れた軸が可変、割れない軸が固定**であることは機械的に決まる。
// 本ツールはその割り出しだけを行い、「どれを引数にするか」の判断は呼び出し側（人・エージェント）が行う。
//
// 入力は採取物のマニフェスト（JSON）。特性は `parity-suite` の trait-capture.mjs が返す形
// （computed / before / after / rect）をそのまま入れる。
//
//   {
//     "component": "button",
//     "instances": [
//       { "id": "orders-list", "states": [ { "state": "default", "traits": { ... } } ] }
//     ]
//   }
//
// fail-closed の方針:
//   - インスタンスが 1 つしか無いと、固定と可変は原理的に区別できない。0 件の「可変軸なし」を
//     返さず問題として落とす（「1 画面で測った結果を部品の値として固定しない」という
//     parity-suite の被覆表と同じ理由）。
//   - インスタンスごとに採った状態集合が違うときも落とす。片方にしか無い状態は
//     「その状態では割れない」ではなく「測っていない」なので、固定側へ倒さない。
//
// 使い方: node axis-diff.mjs <manifest.json> [--out <path>]

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** ツールのバージョン（正本）。出力スキーマを変えたら上げる。 */
export const VERSION = "1";

// 状態名と軸名を 1 つのキーに畳むときの区切り。空白やスラッシュは軸名（`::before/content` 等）に
// 現れうるので、CSS のプロパティ名にも状態名にも現れない制御文字を使う。
const SEPARATOR = String.fromCharCode(31);

/**
 * 1 つの採取物（trait-capture.mjs の返り値の形）を「軸名 → 値」の平坦な表に畳む。
 * 擬似要素は content が無いと null で返るため、その不在自体を値として扱う
 * （片方のインスタンスだけ ::before で描いている、という差が可変軸として出る）。
 *
 * **`null`（測って不在）と キーの欠落（測っていない）を同一視しない。** 同一視すると、擬似要素を
 * 採らずに組んだマニフェストが `<present>: "false"` の固定軸として通り、本ツールが防ごうとしている
 * 「未測定が固定軸に化ける」経路そのものになる。欠落は軸ごと出さず、突き合わせの段で
 * 「一部インスタンスでしか採れていない軸」として problems に落とす（全インスタンスで欠落していれば
 * 軸が存在しないだけで、固定とは主張しない）。
 * @param {{computed?: object, before?: object|null, after?: object|null, rect?: object}} traits
 * @returns {Record<string, string>}
 */
export function flattenTraits(traits) {
  const flat = {};
  for (const [property, value] of Object.entries(traits.computed || {})) flat[property] = value;
  for (const pseudo of ["before", "after"]) {
    const prefix = `::${pseudo}/`;
    if (!(pseudo in traits)) continue; // 測っていない——固定側へ倒さず軸を出さない
    const captured = traits[pseudo];
    if (captured == null) {
      flat[`${prefix}<present>`] = "false";
      continue;
    }
    flat[`${prefix}<present>`] = "true";
    for (const [property, value] of Object.entries(captured)) flat[prefix + property] = value;
  }
  for (const [key, value] of Object.entries(traits.rect || {})) {
    if (key === "x" || key === "y") continue; // 絶対座標は比較に使わない（parity-suite の規約）
    flat[`rect/${key}`] = String(value);
  }
  return flat;
}

/**
 * マニフェストから固定軸・可変軸を割り出す。
 * @param {object} manifest
 * @returns {{component: string|null, tool_version: string, instances: number, states: string[],
 *            fixed: object[], variable: object[], problems: string[], ok: boolean}}
 */
export function diffAxes(manifest) {
  const problems = [];
  const instances = Array.isArray(manifest && manifest.instances) ? manifest.instances : [];

  if (instances.length < 2) {
    problems.push(
      `インスタンスが ${instances.length} 件——固定と可変は 2 件以上を突き合わせないと区別できない`,
    );
  }

  const ids = instances.map((i) => (i && typeof i.id === "string" ? i.id.trim() : ""));
  if (ids.some((id) => id === ""))
    problems.push("id の無いインスタンスがある（照合キーが作れない）");
  const duplicated = ids.filter((id, i) => id !== "" && ids.indexOf(id) !== i);
  if (duplicated.length > 0) {
    problems.push(`id が重複している: ${[...new Set(duplicated)].join(", ")}`);
  }

  // 状態集合の一致を先に確かめる。片方に無い状態を「割れない」に倒すと未測定が固定軸に化ける。
  // 名前が不正な採取（null・非文字列・空文字）は**黙って捨てず問題として数える**。捨ててから
  // 突き合わせると、全インスタンスの状態名が壊れている入力が「状態 0 件・軸 0 件・問題 0 件」に
  // なり、1 件も測っていないのに ok: true を返す（このツールが防ごうとしている fail-open そのもの）。
  const stateSets = instances.map((instance, i) => {
    const entries = Array.isArray(instance && instance.states) ? instance.states : [];
    const names = [];
    let invalid = 0;
    for (const entry of entries) {
      // 空白だけの名前も不正として弾く。`" "` は `!== ""` を通り、状態の和集合に入って
      // 軸を作り ok: true に化ける（前後の空白も揺れの元なので同一視しない）。
      if (
        entry &&
        typeof entry.state === "string" &&
        entry.state.trim() === entry.state &&
        entry.state !== ""
      ) {
        names.push(entry.state);
      } else invalid++;
    }
    if (invalid > 0) {
      problems.push(
        `${ids[i] || `#${i}`}: 状態名が不正な採取が ${invalid} 件（null・非文字列・空文字）`,
      );
    }
    return names;
  });
  // 宣言された到達不能な状態（そのインスタンスでは作れない状態）は、欠落ではなく既知の除外として扱う。
  // 宣言が無い欠落は採り忘れと区別できないので従来どおり問題にする（fail-closed は変えない）。
  const invalidUnreachable = [];
  const declaredUnreachable = instances.map((instance, i) => {
    const declared = instance && instance.unreachable_states;
    if (!Array.isArray(declared)) return new Set();
    // 成果物の契約（metadata.json / references/instances.md）は `{ state, reason }` のオブジェクト形。
    // **これは唯一の緩和経路**（欠落を比較対象から外す）なので、通す入力クラスを閉じた集合として
    // 列挙する——`reason` を持つオブジェクト形だけを受理し、裸の文字列や理由の無い宣言は問題にする。
    // 広く受けると、typo や理由なしの宣言でも欠落が `not_compared` として ok: true に化ける。
    const names = new Set();
    for (const d of declared) {
      if (
        d &&
        typeof d.state === "string" &&
        d.state !== "" &&
        typeof d.reason === "string" &&
        d.reason.trim() !== ""
      ) {
        names.add(d.state);
        continue;
      }
      invalidUnreachable.push({ instance: i, value: d });
    }
    return names;
  });
  for (const bad of invalidUnreachable) {
    problems.push(
      `${ids[bad.instance] || `#${bad.instance}`}: unreachable_states の宣言が契約の形でない（{ state, reason } で reason は非空）`,
    );
  }
  // 候補となる状態は「採れた状態 ∪ 契約の形で宣言された到達不能な状態」。
  // 採取側の和集合だけで作ると、**全インスタンスで到達できない状態が候補から消える**——
  // どのインスタンスにとっても「欠けている状態」でなくなるので not_compared に 1 件も残らず、
  // 除外した組み合わせが成果物から追えない（宣言の typo も、突き合わせる候補が無いので誰も気付かない）。
  const states = [
    ...new Set([...stateSets.flat(), ...declaredUnreachable.flatMap((d) => [...d])]),
  ].sort();
  // 突き合わせる状態が 1 つも残らないなら、比較は成立していない。
  if (states.length === 0) {
    problems.push("採取された状態が 1 つも無い——固定と可変を突き合わせる対象が無い");
  }
  // 全インスタンスが到達不能と宣言した状態は、比較の母集合が空になる。採取条件に載せるべきでない
  // 状態か、状態名の typo のどちらかなので、除外として静かに通さない。
  const unreachableEverywhere = states.filter(
    (st) =>
      !stateSets.some((set) => set.includes(st)) && declaredUnreachable.every((d) => d.has(st)),
  );
  if (unreachableEverywhere.length > 0) {
    problems.push(
      `どのインスタンスでも到達できない状態が宣言されている（${unreachableEverywhere.join(", ")}）——採取条件から外すか状態名を確かめる`,
    );
  }

  // 実際に採れている状態を「到達できない」と宣言している矛盾を落とす。
  // 母集合はこの宣言を引いて作るので、放置すると採取済みの基準が見本も照合も無いまま隠れる。
  declaredUnreachable.forEach((declared, i) => {
    const contradicted = [...declared].filter((st) => stateSets[i].includes(st));
    if (contradicted.length > 0) {
      problems.push(
        `${ids[i] || `#${i}`}: 採取済みの状態を unreachable_states に宣言している（${contradicted.join(", ")}）`,
      );
    }
  });
  const notCompared = [];
  instances.forEach((instance, i) => {
    const missing = states.filter((s) => !stateSets[i].includes(s));
    const undeclared = missing.filter((s) => !declaredUnreachable[i].has(s));
    if (undeclared.length > 0) {
      problems.push(`${ids[i] || `#${i}`}: 未採取の状態 ${undeclared.join(", ")}`);
    }
    for (const s of missing) {
      if (declaredUnreachable[i].has(s))
        notCompared.push({ instance: ids[i] || `#${i}`, state: s });
    }
    const duplicatedStates = stateSets[i].filter((s, j) => stateSets[i].indexOf(s) !== j);
    if (duplicatedStates.length > 0) {
      problems.push(
        `${ids[i] || `#${i}`}: 状態が重複している ${[...new Set(duplicatedStates)].join(", ")}`,
      );
    }
  });

  // 状態 × 軸名 → インスタンスごとの値。
  const table = new Map();
  instances.forEach((instance, i) => {
    for (const entry of Array.isArray(instance && instance.states) ? instance.states : []) {
      if (!entry || typeof entry.state !== "string" || entry.state === "") continue;
      if (!entry.traits || typeof entry.traits !== "object") {
        problems.push(`${ids[i] || `#${i}`} / ${entry.state}: traits が無い`);
        continue;
      }
      // 採取物の形を、採取ツール（`parity-suite` の trait-capture.mjs）が必ず返すフィールドで検証する。
      // 「軸が 1 件以上取れたか」だけを見ると、`{ before: null, after: null }` のように擬似要素の
      // 有無だけが立つ採取が measured 2 を作って通る（本体のスタイルも幾何も測っていない）。
      // 数えた軸の**中身を問わない**条件は、退化形が新しく現れるたびに破られる。
      const missing = [];
      // `typeof [] === "object"` なので配列を明示的に弾く。`computed: ["x"]` は numeric key を
      // 軸として通ってしまい、壊れた採取物でも ok: true になりうる（どちらもレコード形が契約）。
      const isRecord = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
      const computed = entry.traits.computed;
      if (!isRecord(computed) || Object.keys(computed).length === 0) {
        missing.push("computed");
      }
      // trait-capture.mjs は x / y / width / height を常に数値で返す。キーの有無だけを見ると
      // `{ width: null }` のような壊れた採取が通り、軸を作って ok: true に化ける。
      const rect = entry.traits.rect;
      const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);
      if (!isRecord(rect) || !isFiniteNumber(rect.width) || !isFiniteNumber(rect.height)) {
        missing.push("rect");
      }
      // 擬似要素は「測っていない（キーが無い）」「無い（null）」「在る（レコード）」の 3 値が契約。
      // 形を見ずに flattenTraits へ渡すと、`before: "x"` が `::before/0 = "x"` という軸を、
      // `after: []` が `::after/<present> = "true"` だけを作り、壊れた採取物が measured を稼いで
      // ok: true に化ける（computed / rect と同じ fail-open で、擬似要素側だけが素通りしていた）。
      for (const pseudo of ["before", "after"]) {
        if (!(pseudo in entry.traits)) continue;
        const captured = entry.traits[pseudo];
        if (captured === null || isRecord(captured)) continue;
        missing.push(`::${pseudo} の形（null かレコード）`);
      }
      if (missing.length > 0) {
        problems.push(
          `${ids[i] || `#${i}`} / ${entry.state}: 採取に ${missing.join(" と ")} が無い（trait-capture.mjs は常に返す）`,
        );
        continue;
      }
      const flat = Object.entries(flattenTraits(entry.traits));
      // 空の traits（`{}`・computed も rect も空）は 0 軸を返す。そのまま進めると表が空のまま
      // problems も空になり、比較対象が 1 つも無いのに ok: true を返す（`build` は axes.ok だけを
      // 前提に進むので、突き合わせていないベースラインが有効化される）。
      if (flat.length === 0) {
        problems.push(
          `${ids[i] || `#${i}`} / ${entry.state}: traits から軸が 1 つも取れない（空の採取）`,
        );
        continue;
      }
      for (const [axis, value] of flat) {
        const key = `${entry.state}${SEPARATOR}${axis}`;
        if (!table.has(key)) table.set(key, new Map());
        table.get(key).set(ids[i] || `#${i}`, value);
      }
    }
  });

  const fixed = [];
  const variable = [];
  // インスタンスが 1 件だと、全軸が「割れていない」＝固定として並ぶ。`ok: false` は付くが、
  // 読み手が problems を見ずに fixed だけを引くと「この部品に可変軸は無い」と読める——
  // 本ツールが防ごうとしている取りこぼしそのものなので、割り出し自体を行わない。
  if (instances.length < 2) {
    return {
      component: (manifest && manifest.component) || null,
      tool_version: VERSION,
      instances: instances.length,
      states,
      fixed,
      variable,
      measured: 0,
      not_compared: [],
      problems,
      ok: false,
    };
  }
  // 軸の割り出しは「全インスタンスで到達できる状態」だけを対象にする。あるインスタンスで作れない状態は
  // 突き合わせる相手が居ないので、固定とも可変とも言えない（その組み合わせは照合の母集合からも
  // 外れる——到達できないので基準が無く見本も作らない。正本は SKILL.md「比較の母集合」）。
  const comparableStates = new Set(
    states.filter((st) => instances.every((_, i) => stateSets[i].includes(st))),
  );
  for (const [key, byInstance] of [...table.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [state, axis] = key.split(SEPARATOR);
    if (!comparableStates.has(state)) continue;
    // 全インスタンスで採れていない軸は、値が揃っていても固定と呼べない。
    if (byInstance.size !== instances.length) {
      problems.push(
        `${state} / ${axis}: ${byInstance.size}/${instances.length} 件でしか採れていない`,
      );
      continue;
    }
    const values = [...byInstance.values()];
    if (new Set(values).size === 1) {
      fixed.push({ state, axis, value: values[0] });
    } else {
      variable.push({
        state,
        axis,
        values: [...byInstance.entries()].map(([instance, value]) => ({ instance, value })),
      });
    }
  }

  // 合格は「問題が無いこと」ではなく「測れたことの積極的な証拠」で定義する。
  // problems の不在だけを見ると、退化した入力（インスタンス 1 件・状態名が全部不正・空の traits）が
  // 「表が空 → 突き合わせる相手が無い → problems も空 → ok: true」で通る。実際このクラスの
  // fail-open が 1 つのツールから 3 回出ている。個別の分岐を足し続けるのではなく式で閉じる。
  const measured = fixed.length + variable.length;
  if (measured === 0) {
    problems.push("突き合わせられた軸が 0 件——測れたことの証拠が無いので合格にしない");
  }

  return {
    component: (manifest && manifest.component) || null,
    tool_version: VERSION,
    instances: instances.length,
    states,
    fixed,
    variable,
    measured,
    not_compared: notCompared,
    problems,
    ok: problems.length === 0 && measured > 0,
  };
}

export function main(argv) {
  const args = argv.filter((a) => a !== "");
  // 受け付けるオプションは `--out <path>` だけ。`--` で始まるトークンを一括で読み飛ばすと、
  // `--otu=result.json` のような綴り違いや `--out=path` の等号形が黙って捨てられ、
  // 成果物を作らないまま標準出力へ書いて exit 0 になる（--out が軸成果物を生む前提の工程が、
  // ファイルが無いことに気付かないまま次へ進む）。知らないオプションは受理しない。
  const positionals = [];
  let out = null;
  let outSeen = false;
  let badOption = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("-") || a === "-") {
      positionals.push(a);
      continue;
    }
    if (a === "--out") {
      if (outSeen) badOption = badOption || "--out は 1 回だけ指定する";
      outSeen = true;
      const value = args[i + 1];
      if (value === undefined || value.startsWith("-")) {
        badOption = badOption || "--out には出力先パスを続ける";
      } else {
        out = value;
        i++;
      }
      continue;
    }
    badOption = badOption || `未知のオプション: ${a}`;
  }
  const input = positionals[0];
  if (positionals.length !== 1 || badOption) {
    process.stderr.write("usage: node axis-diff.mjs <manifest.json> [--out <path>]\n");
    if (badOption) process.stderr.write(`error: ${badOption}\n`);
    if (positionals.length > 1) {
      process.stderr.write(`error: マニフェストは 1 つだけ指定する: ${positionals.join(", ")}\n`);
    }
    if (positionals.length === 0) process.stderr.write("error: マニフェストを指定する\n");
    return 2;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(input, "utf8"));
  } catch (e) {
    process.stderr.write(`error: マニフェストを読めない: ${e && e.message ? e.message : e}\n`);
    return 2;
  }

  const result = diffAxes(manifest);
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (out) writeFileSync(out, json);
  else process.stdout.write(json);

  for (const problem of result.problems) process.stderr.write(`warn: ${problem}\n`);
  if (!result.ok) {
    process.stderr.write(
      `error: 軸の割り出しに ${result.problems.length} 件の問題——採取へ戻す（固定側へ倒さない）\n`,
    );
  }
  return result.ok ? 0 : 1;
}

// CLI エントリ判定は両辺を実パスに解決してから突き合わせる。
// process.argv[1] は起動時のパスのまま、import.meta.url も --preserve-symlinks(-main) では
// 未解決のままなので、片側だけ解決するとシンボリックリンク経由の起動で main() が呼ばれず
// 何も出力せず exit 0 になる（サイレント no-op）。
const invokedAsCli = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return entry === self;
  }
})();

if (invokedAsCli) {
  process.exit(main(process.argv.slice(2)));
}
