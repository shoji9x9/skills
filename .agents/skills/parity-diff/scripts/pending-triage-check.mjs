// 意図的差異の保留（intentional_diffs.pending）の棚卸しを数え直して収束条件を判定する（正本）。
// 正本はこのスキル側にあり、実行時はスキルディレクトリ内から直接実行する
// （プロジェクトへコピーしない。gh skill update の自動更新を効かせるため）。
//
// 何をするか: registries.json の intentional_diffs.pending からこの機能の棚卸し対象を列挙し、
// diff-metadata.json の intentional_diffs_pending の記録と突き合わせて、
// 未棚卸し（対象なのに記録が無い）と不整合（移したと書いてあるのに移っていない等）を数える。
// 宣言された件数は参照せず必ず数え直す（宣言値を信用すると、棚卸しをせずに件数だけ 0 と書けてしまう）。
//
// 何をしないか: 分類の判断（keep / may_change のどちらへ移すか）は人間の仕事で、ここでは行わない。
// 設定ファイルの書き換えもしない（pending から keep / may_change へ移すのは人間）。
//
// 棚卸しの対象は 3 群ある（正本は references/convergence.md「intentional_diffs.pending の棚卸し」）:
//   - この機能に帰属する pending（slug 一致）
//   - 機能に帰属しない pending（slug: cross-cutting）——閉じる工程を持たないので毎回提示する
//   - 帰属不明の pending（素の文字列の旧形式 / slug 欠落）——黙って対象外にすると、
//     いちばん古くから積んでいる保留だけが誰の目にも触れなくなる
//
// fail-closed: intentional_diffs_pending キーが無いときは「旧成果物」として合格に倒さず未実施として落とす
// （棚卸しは対象 0 件でも記録を要求する。0 件を無記録と同じ出力にしない）。
// 「移した」と記録されたのに pending に残っている・移動先に見つからないものは不整合として落とす
// （記録だけで通ると、棚卸しが「書けば通るチェックリスト」になる）。
// 照合キー（item の文言）が pending 内で重複していたら、黙って先勝ちにせず不整合として落とす。
// registries.json 側が読めない形（オブジェクトでない・intentional_diffs / pending が無い）のときも
// 「対象 0 件で合格」に倒さず exit 2 で落とす（空集合に倒すと全件が黙って対象外になる）。
//
// 決定論的: 乱数・現在時刻に依存しない。入力順を保って数える。
// TypeScript 構文は使わない（型は JSDoc）。

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * ツールのバージョン（正本）。判定ロジック・出力形状を変えたら上げる。
 * diff-metadata.json の differ_versions.pending_triage_check に記録する値はこれを使う（手入力にしない）。
 * @type {string}
 */
export const VERSION = "1";

/** 機能に帰属しない追記を表す予約語（正本は replace-strategy の references/project-config.md）。 */
export const CROSS_CUTTING = "cross-cutting";

/** 棚卸しで記録できる処置。 */
const DISPOSITIONS = ["keep", "may_change", "carried_over"];

/**
 * 意図的差異レジストリの 1 要素から照合に使う散文テキストを取り出す。
 *
 * `pending` は追記元（slug / added_by / added_at）を持つオブジェクト形式で書かれるため、
 * 照合キーは `item` である（要素の形の正本は replace-strategy の
 * references/project-config.md「`pending` 要素の形」）。素の文字列の要素も読む（旧形式）。
 * `item` が文字列でないオブジェクトは照合に使わない（fail-closed）。
 *
 * diff-normalize.mjs にも同じ関数がある。**同梱スクリプトは互いを import しない**——
 * シンボリックリンク経由の起動（`--preserve-symlinks-main`）では相対 import が
 * リンク先ではなくリンクの置き場所を基準に解決され、ERR_MODULE_NOT_FOUND で落ちる
 * （SKILL.md が案内する実行パスは常にリンク経由になる）。片方を直したらもう片方も直す。
 * @param {unknown} entry
 * @returns {string} 照合に使うテキスト（取り出せなければ空文字列）
 */
export function intentionalEntryText(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const item = /** @type {{ item?: unknown }} */ (entry).item;
    return typeof item === "string" ? item : "";
  }
  return "";
}

/**
 * 空でない文字列か。
 * @param {unknown} v
 * @returns {boolean}
 */
function nonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * 照合キーの表記ゆれ（前後の空白・連続空白）だけを吸収する。
 * 大文字小文字は畳まない——散文の宣言は固有名を含み、畳むと別の宣言が同一視されうる。
 * @param {unknown} v
 * @returns {string}
 */
export function matchKey(v) {
  return String(v ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * プレーンオブジェクトか（配列・null を除く）。
 * @param {unknown} v
 * @returns {boolean}
 */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * registries.json の intentional_diffs.pending を正規化する。
 *
 * 素の文字列は旧形式として読むが帰属不明にする（slug: null）。
 * オブジェクトは item / slug / added_by / added_at を検証し、欠けていれば不整合として数える
 * （帰属が読めない追記は棚卸しの対象を決められないため、黙って帰属不明へ倒さない）。
 * @param {unknown[]} entries
 * @returns {{ items: {key:string, slug:(string|null), index:number}[], problems: string[] }}
 */
export function normalizePending(entries) {
  /** @type {{key:string, slug:(string|null), index:number}[]} */
  const items = [];
  /** @type {string[]} */
  const problems = [];
  entries.forEach((entry, index) => {
    if (typeof entry === "string") {
      const key = matchKey(entry);
      if (key === "") {
        problems.push(`intentional_diffs.pending[${index}]: 空の要素（照合に使えない）`);
        return;
      }
      items.push({ key, slug: null, index });
      return;
    }
    if (!isPlainObject(entry)) {
      problems.push(
        `intentional_diffs.pending[${index}]: 文字列でもオブジェクトでもない（要素の形の正本は replace-strategy の references/project-config.md「pending 要素の形」）`,
      );
      return;
    }
    const rec = /** @type {Record<string, unknown>} */ (entry);
    const key = matchKey(intentionalEntryText(entry));
    if (key === "") {
      problems.push(
        `intentional_diffs.pending[${index}]: item が空／文字列でない（照合に使えない）`,
      );
      return;
    }
    if (!nonEmptyString(rec.added_by)) {
      problems.push(`intentional_diffs.pending[${index}]: added_by が無い（${key}）`);
    }
    if (!nonEmptyString(rec.added_at)) {
      problems.push(`intentional_diffs.pending[${index}]: added_at が無い（${key}）`);
    }
    if (rec.slug === undefined) {
      // slug 欠落は帰属不明として扱い、どの機能の棚卸しでも提示する（黙って対象外にしない）。
      problems.push(
        `intentional_diffs.pending[${index}]: slug が無い（${key}）— 帰属不明として全機能の棚卸し対象になる`,
      );
      items.push({ key, slug: null, index });
      return;
    }
    if (!nonEmptyString(rec.slug)) {
      problems.push(`intentional_diffs.pending[${index}]: slug が空／文字列でない（${key}）`);
      items.push({ key, slug: null, index });
      return;
    }
    items.push({ key, slug: String(rec.slug).trim(), index });
  });
  return { items, problems };
}

/**
 * 棚卸し対象か（この slug に帰属 / 横断 / 帰属不明）。
 * @param {{slug:(string|null)}} item
 * @param {string} slug
 * @returns {boolean}
 */
function inScope(item, slug) {
  return item.slug === null || item.slug === slug || item.slug === CROSS_CUTTING;
}

/**
 * registries.json の keep / may_change の照合キー集合を作る。
 * @param {unknown} registry
 * @param {'keep'|'may_change'} group
 * @returns {Set<string>}
 */
function targetKeys(registry, group) {
  const list = isPlainObject(registry)
    ? /** @type {Record<string, unknown>} */ (registry)[group]
    : null;
  const set = new Set();
  if (Array.isArray(list)) {
    for (const entry of list) {
      const key = matchKey(intentionalEntryText(entry));
      if (key !== "") set.add(key);
    }
  }
  return set;
}

/**
 * 棚卸しの記録と設定ファイルの pending を突き合わせて数え直す。
 * @param {unknown} registries registries.json の内容
 * @param {unknown} record diff-metadata.json の intentional_diffs_pending
 * @param {string} slug 対象機能の slug
 * @returns {{attributed:number, cross_cutting:number, unattributed:number, resolved:number, carried_over:number, in_scope:number, untriaged:number, problems:string[]}}
 */
export function countTriage(registries, record, slug) {
  /** @type {string[]} */
  const problems = [];
  const intentional = isPlainObject(registries)
    ? /** @type {Record<string, unknown>} */ (registries).intentional_diffs
    : null;
  const rawPending = isPlainObject(intentional)
    ? /** @type {Record<string, unknown>} */ (intentional).pending
    : undefined;
  if (rawPending !== undefined && !Array.isArray(rawPending)) {
    problems.push("intentional_diffs.pending が配列でない");
  }
  const { items, problems: shapeProblems } = normalizePending(
    Array.isArray(rawPending) ? rawPending : [],
  );
  problems.push(...shapeProblems);

  // 同じ文言が pending に複数あると、どの要素を棚卸ししたのか決められない（先勝ちにしない）。
  /** @type {Map<string, number>} */
  const pendingCount = new Map();
  for (const item of items) pendingCount.set(item.key, (pendingCount.get(item.key) ?? 0) + 1);
  for (const [key, n] of pendingCount) {
    if (n > 1) problems.push(`intentional_diffs.pending に同じ文言が ${n} 件ある（${key}）`);
  }

  const scoped = items.filter((item) => inScope(item, slug));
  const pendingKeys = new Set(items.map((item) => item.key));
  /** @type {Map<string, (string|null)>} 照合キー → 設定ファイル側の帰属（重複キーは上の検査で落ちる） */
  const pendingSlugs = new Map(items.map((item) => [item.key, item.slug]));
  const keepKeys = targetKeys(intentional, "keep");
  const mayChangeKeys = targetKeys(intentional, "may_change");

  const entries = isPlainObject(record)
    ? /** @type {Record<string, unknown>} */ (record).entries
    : undefined;
  if (!Array.isArray(entries)) {
    // CLI はこの形を exit 2 で先に落とすため、ここへは main() を経由しない呼び出しだけが来る。
    problems.push("intentional_diffs_pending.entries が配列でない（棚卸しの記録が読めない）");
    return {
      attributed: 0,
      cross_cutting: 0,
      unattributed: 0,
      resolved: 0,
      carried_over: 0,
      in_scope: scoped.length,
      untriaged: scoped.length,
      problems,
    };
  }

  let attributed = 0;
  let crossCutting = 0;
  let unattributed = 0;
  let resolved = 0;
  let carriedOver = 0;
  /** @type {Set<string>} */
  const triaged = new Set();

  entries.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      problems.push(`intentional_diffs_pending.entries[${index}]: オブジェクトでない`);
      return;
    }
    const rec = /** @type {Record<string, unknown>} */ (entry);
    // 文字列以外は matchKey で "[object Object]" 等へ潰れて照合キーに化けるため、型で弾く（registries 側の
    // intentionalEntryText と同じ fail-closed。潰れたキーは pending と偶然一致・不一致を起こす）。
    const key = typeof rec.item === "string" ? matchKey(rec.item) : "";
    if (key === "") {
      problems.push(`intentional_diffs_pending.entries[${index}]: item が空／文字列でない`);
      return;
    }
    if (triaged.has(key)) {
      problems.push(
        `intentional_diffs_pending.entries[${index}]: 同じ item が二重に記録されている（${key}）`,
      );
      return;
    }
    triaged.add(key);

    if (rec.slug !== undefined && rec.slug !== null && typeof rec.slug !== "string") {
      problems.push(`intentional_diffs_pending.entries[${index}]: slug が文字列でない（${key}）`);
      return;
    }
    const entrySlug =
      rec.slug === undefined || rec.slug === null ? null : matchKey(rec.slug) || null;
    // 設定ファイル側にまだ残っている要素は、記録した帰属が設定ファイルの帰属と一致することまで確かめる
    // （別機能に帰属する保留を自機能の slug で記録すると、その機能の棚卸しを素通りで閉じられる）。
    if (pendingSlugs.has(key)) {
      const registrySlug = pendingSlugs.get(key) ?? null;
      if (registrySlug !== entrySlug) {
        problems.push(
          `intentional_diffs_pending.entries[${index}]: 記録した帰属（${entrySlug ?? "帰属不明"}）が設定ファイルの pending の帰属（${registrySlug ?? "帰属不明"}）と違う（${key}）`,
        );
        return;
      }
    }
    if (entrySlug === null) unattributed += 1;
    else if (entrySlug === CROSS_CUTTING) crossCutting += 1;
    else if (entrySlug === slug) attributed += 1;
    else {
      problems.push(
        `intentional_diffs_pending.entries[${index}]: 対象外の slug（${entrySlug}）を棚卸しに記録している（${key}）`,
      );
      return;
    }

    const disposition = typeof rec.disposition === "string" ? rec.disposition : "";
    if (!DISPOSITIONS.includes(disposition)) {
      problems.push(
        `intentional_diffs_pending.entries[${index}]: disposition が ${DISPOSITIONS.join(" / ")} のいずれでもない（${key}）`,
      );
      return;
    }

    if (disposition === "carried_over") {
      carriedOver += 1;
      if (!nonEmptyString(rec.reason)) {
        problems.push(
          `intentional_diffs_pending.entries[${index}]: 持ち越しの理由が空（${key}）— 理由の記録が通過の条件`,
        );
      }
      if (!pendingKeys.has(key)) {
        problems.push(
          `intentional_diffs_pending.entries[${index}]: 持ち越しと記録されているが pending に無い（${key}）`,
        );
      }
      return;
    }

    // keep / may_change は「移した」記録なので、実際に移っていることまで確かめる。
    resolved += 1;
    const promoted =
      rec.promoted_as === undefined || rec.promoted_as === null ? key : matchKey(rec.promoted_as);
    if (promoted === "") {
      problems.push(
        `intentional_diffs_pending.entries[${index}]: promoted_as が空文字列（${key}）`,
      );
      return;
    }
    if (pendingKeys.has(key)) {
      problems.push(
        `intentional_diffs_pending.entries[${index}]: ${disposition} へ移したと記録されているが pending に残っている（${key}）`,
      );
    }
    const dest = disposition === "keep" ? keepKeys : mayChangeKeys;
    if (!dest.has(promoted)) {
      problems.push(
        `intentional_diffs_pending.entries[${index}]: ${disposition} に見つからない（${promoted}）— 文言を変えて移したなら promoted_as に移動後の文言を書く`,
      );
    }
  });

  // 宣言された件数は信用せず、数え直した値と突き合わせる。
  const declared = /** @type {Record<string, unknown>} */ (isPlainObject(record) ? record : {});
  const counted = {
    attributed,
    cross_cutting: crossCutting,
    unattributed,
    resolved,
    carried_over: carriedOver,
  };
  for (const [name, value] of Object.entries(counted)) {
    if (declared[name] !== undefined && declared[name] !== value) {
      problems.push(
        `intentional_diffs_pending.${name}: 宣言 ${JSON.stringify(declared[name])} と数え直した ${value} が一致しない`,
      );
    }
  }

  const untriagedItems = scoped.filter((item) => !triaged.has(item.key));
  for (const item of untriagedItems) {
    problems.push(
      `未棚卸し: intentional_diffs.pending[${item.index}]（${item.slug ?? "帰属不明"}）— ${item.key}`,
    );
  }

  return { ...counted, in_scope: scoped.length, untriaged: untriagedItems.length, problems };
}

/**
 * CLI 本体。
 * @param {string[]} argv
 * @param {{ readFile?: (p:string)=>string }} deps
 * @returns {number} 終了コード
 */
export function main(argv, deps = {}) {
  const readFile = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
  const usage =
    "usage: node pending-triage-check.mjs --registries <registries.json> --metadata <diff-metadata.json>\n";
  /** @type {Record<string, string>} */
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--registries" || a === "--metadata") {
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
  if (!opts.registries || !opts.metadata) {
    process.stderr.write(usage);
    return 2;
  }

  /** @type {unknown} */
  let registries;
  try {
    registries = JSON.parse(readFile(opts.registries));
  } catch (e) {
    process.stderr.write(`error: registries.json を読めない: ${opts.registries}: ${String(e)}\n`);
    return 2;
  }
  // 空集合に倒すと「対象 0 件で合格」になり、間違ったファイル・キー欠落の設定が黙って通る。
  if (!isPlainObject(registries)) {
    process.stderr.write(`error: registries.json がオブジェクトでない: ${opts.registries}\n`);
    return 2;
  }
  const intentionalDiffs = /** @type {Record<string, unknown>} */ (registries).intentional_diffs;
  if (!isPlainObject(intentionalDiffs)) {
    process.stderr.write(
      `error: registries.json に intentional_diffs が無い／オブジェクトでない（棚卸しの対象を決められない）: ${opts.registries}\n`,
    );
    return 2;
  }
  if (!Array.isArray(/** @type {Record<string, unknown>} */ (intentionalDiffs).pending)) {
    process.stderr.write(
      `error: registries.json の intentional_diffs.pending が無い／配列でない（設定ファイルでは空でも [] を書く）: ${opts.registries}\n`,
    );
    return 2;
  }
  /** @type {unknown} */
  let metadata;
  try {
    metadata = JSON.parse(readFile(opts.metadata));
  } catch (e) {
    process.stderr.write(`error: diff-metadata.json を読めない: ${opts.metadata}: ${String(e)}\n`);
    return 2;
  }
  if (!isPlainObject(metadata)) {
    process.stderr.write(`error: diff-metadata.json がオブジェクトでない: ${opts.metadata}\n`);
    return 2;
  }
  const meta = /** @type {Record<string, unknown>} */ (metadata);
  if (!nonEmptyString(meta.slug)) {
    // slug が無いと棚卸しの対象を決められない。空集合に倒すと全件が黙って対象外になる。
    process.stderr.write(`error: diff-metadata.json に slug が無い: ${opts.metadata}\n`);
    return 2;
  }
  const slug = String(meta.slug).trim();

  const record = meta.intentional_diffs_pending;
  if (record === undefined) {
    // 旧成果物として合格に倒さない（棚卸しは対象 0 件でも記録を要求する）。
    process.stdout.write(
      `${JSON.stringify({ tool: "pending-triage-check", version: VERSION, slug, recorded: false, in_scope: null, attributed: 0, cross_cutting: 0, unattributed: 0, resolved: 0, carried_over: 0, untriaged: null, problems: ["intentional_diffs_pending が無い（棚卸し未実施）"] }, null, 2)}\n`,
    );
    process.stderr.write(
      `error: diff-metadata.json に intentional_diffs_pending が無い（棚卸し未実施）— 収束させず棚卸しを行う: ${opts.metadata}\n`,
    );
    return 1;
  }
  if (!isPlainObject(record)) {
    process.stderr.write(
      `error: intentional_diffs_pending がオブジェクトでない: ${opts.metadata}\n`,
    );
    return 2;
  }
  if (!Array.isArray(/** @type {Record<string, unknown>} */ (record).entries)) {
    // 成果物の型崩れは「未棚卸し」(exit 1) と混ぜず、型崩れ・使い方の誤り (exit 2) に寄せる
    // （両方を 1 で返すと、自動化が「棚卸しをやり直せば直る」と「成果物が壊れている」を区別できない）。
    process.stderr.write(
      `error: intentional_diffs_pending.entries が配列でない（棚卸しの記録が読めない）: ${opts.metadata}\n`,
    );
    return 2;
  }

  const counted = countTriage(registries, record, slug);
  const ok = counted.untriaged === 0 && counted.problems.length === 0;
  process.stdout.write(
    `${JSON.stringify({ tool: "pending-triage-check", version: VERSION, slug, recorded: true, ...counted }, null, 2)}\n`,
  );
  for (const p of counted.problems) process.stderr.write(`warn: ${p}\n`);
  // 対象 0 件でも「何を何件見たか」を必ず出す（0 件と未実行を同じ出力にしない）。
  // 内訳（この機能 / 横断 / 帰属不明）は棚卸しの記録から、in_scope は設定ファイルの pending から数えており
  // 出所が違う（確定させた分は pending から消えている）ので、同じ数として並べない。
  const recordedTotal = counted.attributed + counted.cross_cutting + counted.unattributed;
  process.stderr.write(
    `note: 棚卸しの記録 ${recordedTotal} 件（この機能 ${counted.attributed} / 横断 ${counted.cross_cutting} / 帰属不明 ${counted.unattributed}）、確定 ${counted.resolved} 件、持ち越し ${counted.carried_over} 件。設定ファイルの pending に残る対象 ${counted.in_scope} 件（うち未棚卸し ${counted.untriaged} 件）: ${opts.registries}\n`,
  );
  if (counted.untriaged > 0) {
    process.stderr.write(
      `error: 未棚卸し ${counted.untriaged} 件 — 収束させず人へ提示して keep / may_change へ移すか持ち越し理由を記録する\n`,
    );
  }
  if (counted.problems.length > counted.untriaged) {
    process.stderr.write(`error: 棚卸し記録の不整合（上の warn を参照）— 収束させず直す\n`);
  }
  return ok ? 0 : 1;
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
