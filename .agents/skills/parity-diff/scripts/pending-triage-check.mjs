// 意図的差異の保留（intentional_diffs.pending）の棚卸しを数え直して、収束の条件を判定する（原本）。
// 原本はこのスキルの中にあり、スキルのディレクトリから直接実行する。
// プロジェクトへはコピーしない。gh skill update の自動更新を反映させるためである。
//
// registries.json の intentional_diffs.pending から、この機能の棚卸しの対象を列挙する。
// それを diff-metadata.json の intentional_diffs_pending の記録と突き合わせ、
// 未棚卸し（対象なのに記録が無い）と不整合（移したと書いてあるのに移っていない、など）を数える。
// 宣言された件数は参照せず、必ず数え直す。宣言の値を信用すると、棚卸しをせずに件数だけ 0 と書けてしまう。
//
// 分類の判断（keep と may_change のどちらへ移すか）は人が行い、ここでは行わない。
// 設定ファイルも書き換えない（pending から keep や may_change へ移すのは人である）。
//
// 棚卸しの対象は次の 3 群である（references/convergence.md「intentional_diffs.pending の棚卸し」で定義する）。
//   - この機能に帰属する pending（slug が一致する）
//   - 機能に帰属しない pending（slug: cross-cutting）。閉じる工程を持たないので、毎回提示する
//   - 帰属不明の pending（ただの文字列の旧形式、または slug の欠落）。警告なしに対象外にすると、
//     いちばん古くから溜まっている保留だけが、誰の目にも触れなくなる
//
// intentional_diffs_pending のキーが無いときは「旧成果物」として合格にせず、未実施として失敗にする
// （棚卸しは、対象が 0 件でも記録を求める。0 件と無記録を同じ出力にしない）。
// 「移した」と記録されたのに pending に残っているものと、移動先に見つからないものは、不整合として失敗にする
// （記録だけで通ると、棚卸しが「書けば通るチェックリスト」になる）。
// 照合キー（item の文言）が pending の中で重複していたら、警告なしに先のものを採らず、不整合として失敗にする。
// registries.json が読めない形（オブジェクトでない、intentional_diffs や pending が無い）のときも、
// 「対象 0 件で合格」とせず exit 2 で終わる（空集合として扱うと、全件が警告なしに対象外になる）。
//
// 乱数と現在時刻に依存しない。入力の順を保って数える。
// TypeScript の構文は使わない（型は JSDoc で書く）。

import { readFileSync } from "node:fs";
import { isArray } from "./lib/is-array.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import { parseFlagOpts } from "./lib/flag-opts.mjs";
import { isPlainObject, nonEmptyString } from "./lib/guards.mjs";
import { intentionalEntryText } from "./lib/intentional.mjs";
import { valueText } from "./lib/value-text.mjs";

/**
 * ツールのバージョン（原本）。判定の処理や出力の形を変えたら上げる。
 * diff-metadata.json の differ_versions.pending_triage_check に記録する値はこれを使う（手入力にしない）。
 *
 * @type {string}
 */
export const VERSION = "4";

/** 機能に帰属しない追記を表す予約語（replace-strategy の references/project-config.md で定義する）。 */
export const CROSS_CUTTING = "cross-cutting";

/**
 * slug に機能 slug を書けないスキル（追記は必ず CROSS_CUTTING）。
 * parity-component では、部品の slug が機能の slug と別の名前空間にある。書かれると inScope がどの機能でも偽になり、
 * いつまでも棚卸しされない。replace-strategy では、意図的差異レジストリを作る工程（setup の手順 8）が
 * 機能の slug の採番（同じく手順 9）より前にあるので、追記する時点では書ける機能の slug がまだ無い。
 * replace-strategy の references/project-config.md「pending 要素の形」で定義する。
 *
 * **この集合が変えるのは診断文言だけ**である。cross-cutting を強制しているのは FEATURE_SLUG_WRITERS に
 * 入っていないこと（= namespaceVerified が偽になる）であって、この集合は namespaceVerified の判定に入らない。
 * したがって書き手を両方の集合に入れると、この集合に入れたままでも cross-cutting の強制は外れる。
 * 新しい書き手を足すときは、どちらの集合に入れるかで挙動が決まる（両方には入れない）。
 */
const CROSS_CUTTING_ONLY_WRITERS = new Set(["parity-component", "replace-strategy"]);

/**
 * slug に機能の slug を書けるスキル（replace-strategy の references/project-config.md で定義する）。
 * 帰属を信用してよいのは、書き手が読めて、その書き手がこの集合にいるときだけである。
 * 書き手が読めない（欠落・unknown・未知の名前）要素の slug は、名前空間を確認できないので帰属不明として扱う。
 * 書き手を増やすときは、次の 2 つを同時に更新する。
 * replace-strategy の references/project-config.md「pending 要素の形」の added_by の一覧と、
 * この集合か CROSS_CUTTING_ONLY_WRITERS のどちらか一方である。
 * 一覧だけを増やすと、その書き手の追記が帰属不明と判定されてしまう。
 */
const FEATURE_SLUG_WRITERS = new Set(["golden-dataset", "parity-suite", "parity-replace"]);

/** 棚卸しで記録できる処置。 */
const DISPOSITIONS = ["keep", "may_change", "carried_over"];

/**
 * 照合キーの表記ゆれ（前後の空白・連続空白）だけを吸収する。
 * 大文字小文字は畳まない。散文の宣言は固有名を含み、畳むと別の宣言が同一視されうるためである。
 *
 * @param {unknown} v
 * @returns {string}
 */
export function matchKey(v) {
  return valueText(v).trim().replace(/\s+/g, " ");
}

/**
 * slug 表の中の 1 行を読み、表の状態を進める。本体の行なら 1 列目を、ヘッダと区切りの行なら null を返す。
 *
 * @param {{ sawSlugTable: boolean, inSlugTable: boolean, sawSeparator: boolean, headerCells: number }} table - 読んでいる表の状態（この関数が更新する）。headerCells はヘッダの列の数
 * @param {string[]} cells
 * @returns {string|null}
 */
function readSlugTableRow(table, cells) {
  if (!table.inSlugTable) {
    if (cells[0]?.toLowerCase() === "slug") {
      table.inSlugTable = true;
      table.sawSlugTable = true;
      table.sawSeparator = false;
      table.headerCells = cells.length;
    }
    return null;
  }
  if (!table.sawSeparator) {
    // 区切り行が無い表はヘッダと本体を区別できないので読まない。
    // GFM の区切り行のハイフンは 1 個以上（`|-|-|` も区切り行）。1 列目の空欄を `-` で書いた本体の行と分けるため、すべての列を見る。
    // GFM は列の数がヘッダと違う区切り行を表として読まない。
    const separator = cells.length === table.headerCells && cells.every((c) => /^:?-+:?$/.test(c));
    if (separator) table.sawSeparator = true;
    else table.inSlugTable = false;
    return null;
  }
  return cells[0] ?? "";
}

/**
 * 機能インベントリ（`.replace/features.md`）から slug の集合を読む。
 *
 * slug は、機能・横断 API・バッチ・その他の Issue で**同じ名前空間**を共有する（replace-strategy の
 * `assets/features-template.md` で定義する）。どれも 1 列目が `slug` の表に並ぶ。ここではその表だけを読む。
 * **slug 表が 1 つも無いファイルは読めなかったものとして null を返す**。空集合を返すと
 * 「インベントリに 1 件も無い」と区別が付かない。
 *
 * @param {string} markdown
 * @returns {Set<string>|null}
 */
export function parseFeatureSlugs(markdown) {
  /** @param {string} line */
  // GFM と同じく、エスケープした `\|` は列の区切りにしない（ヘッダと区切り行の列の数を比べるため）
  const cellsOf = (line) =>
    line
      .replace(/^\|/, "")
      .replace(/(?<!\\)\|$/, "")
      .split(/(?<!\\)\|/)
      .map((c) => c.trim().replaceAll("\\|", "|"));
  const slugs = new Set();
  const table = { sawSlugTable: false, inSlugTable: false, sawSeparator: false, headerCells: 0 };
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("|")) {
      table.inSlugTable = false;
      table.sawSeparator = false;
      continue;
    }
    const slug = readSlugTableRow(table, cellsOf(line));
    if (slug !== null && slug !== "") slugs.add(slug);
  }
  return table.sawSlugTable ? slugs : null;
}

/**
 * ただの文字列の pending 要素を正規化する（旧形式。帰属不明にする）。
 *
 * @param {string} entry
 * @param {number} index
 * @returns {{ item: ({key:string, slug:(string|null), index:number}|null), issues: {index:number, slug:(string|null), message:string}[] }}
 */
function normalizeStringEntry(entry, index) {
  const key = matchKey(entry);
  if (key === "") {
    return {
      item: null,
      issues: [
        {
          index,
          slug: null,
          message: `intentional_diffs.pending[${index}]: 空の要素（照合に使えない）`,
        },
      ],
    };
  }
  return { item: { key, slug: null, index }, issues: [] };
}

/**
 * pending 要素の書き手と slug を読み、slug の名前空間を確認できるかを決める。
 *
 * @param {Record<string, unknown>} rec
 * @param {Set<string>|null} knownSlugs
 * @returns {{ writer: (string|null), writerWritesFeatureSlug: boolean, namespaceVerified: boolean, attribution: (string|null), knownSlugs: (Set<string>|null) }}
 */
function slugNamespace(rec, knownSlugs) {
  const writer = nonEmptyString(rec.added_by) ? String(rec.added_by).trim() : null;
  const rawSlug = nonEmptyString(rec.slug) ? String(rec.slug).trim() : null;
  // 帰属を信用できるのは、書き手が読めていてその書き手が機能 slug を書け、かつその slug が
  // 機能インベントリに実在する場合だけ。書き手が読めない要素（added_by の欠落・unknown・未知の名前）も、
  // 実在しない slug（綴り違い・部品 slug）も、別機能に帰属すると読めていることにならない。
  // どちらもその「担当機能」が現れないまま永久に棚卸しされない。
  // インベントリを読めていない（knownSlugs が null）ときは何も検証できないので緩和を適用しない。
  // cross-cutting は書き手に依らず帰属不明と同じ範囲（全機能）なのでそのまま信用してよい。
  const writerWritesFeatureSlug = writer !== null && FEATURE_SLUG_WRITERS.has(writer);
  const slugInInventory = knownSlugs !== null && rawSlug !== null && knownSlugs.has(rawSlug);
  const namespaceVerified =
    rawSlug === null || rawSlug === CROSS_CUTTING || (writerWritesFeatureSlug && slugInInventory);
  // 形の不備を報告するときの帰属。slug が読めない・名前空間を確認できない要素は
  // 帰属不明（＝全機能の棚卸し対象）として扱う。
  const attribution = namespaceVerified ? rawSlug : null;
  return { writer, writerWritesFeatureSlug, namespaceVerified, attribution, knownSlugs };
}

/**
 * 名前空間を確認できない slug について、確認できない理由を返す。
 *
 * @param {ReturnType<typeof slugNamespace>} ns
 * @returns {string}
 */
function unverifiedSlugReason(ns) {
  const { writer } = ns;
  if (writer !== null && CROSS_CUTTING_ONLY_WRITERS.has(writer)) {
    return `added_by が ${writer} なのに slug が ${CROSS_CUTTING} でない`;
  }
  if (!ns.writerWritesFeatureSlug) {
    return `slug の名前空間を確認できない（${writer === null ? "added_by が無い" : `added_by が ${writer}`}）`;
  }
  if (ns.knownSlugs === null) {
    return "機能インベントリを読めていないので slug の実在を確認できない";
  }
  return "slug が機能インベントリに無い";
}

/**
 * slug を帰属として使えない理由を返す。使えるなら null を返す。
 *
 * @param {Record<string, unknown>} rec
 * @param {string} key
 * @param {ReturnType<typeof slugNamespace>} ns
 * @returns {string|null}
 */
function slugIssue(rec, key, ns) {
  if (rec.slug === undefined) {
    // slug の欠落は帰属不明として扱い、どの機能の棚卸しでも提示する（警告なしに対象外にしない）。
    return `slug が無い（${key}）— 帰属不明として全機能の棚卸し対象になる`;
  }
  if (!nonEmptyString(rec.slug)) return `slug が空／文字列でない（${key}）`;
  // 名前空間を確認できない slug は、どの機能の inScope にも入らず、いつまでも棚卸しされない。
  // 帰属不明（slug: null）として扱い、すべての機能の対象にする（合格として扱わない）。
  if (!ns.namespaceVerified) {
    return `${unverifiedSlugReason(ns)}（${key}）— 機能 slug と読めないため帰属不明として全機能の棚卸し対象になる`;
  }
  return null;
}

/**
 * オブジェクトの pending 要素を正規化する。item・slug・added_by・added_at を検証する。
 *
 * @param {Record<string, unknown>} rec
 * @param {number} index
 * @param {Set<string>|null} knownSlugs
 * @returns {{ item: ({key:string, slug:(string|null), index:number}|null), issues: {index:number, slug:(string|null), message:string}[] }}
 */
function normalizeObjectEntry(rec, index, knownSlugs) {
  /** @type {{index:number, slug:(string|null), message:string}[]} */
  const issues = [];
  /**
   * @param {string|null} slug
   * @param {string} message
   */
  const push = (slug, message) =>
    issues.push({ index, slug, message: `intentional_diffs.pending[${index}]: ${message}` });
  const key = matchKey(intentionalEntryText(rec));
  const ns = slugNamespace(rec, knownSlugs);
  if (key === "") {
    push(ns.attribution, "item が空／文字列でない（照合に使えない）");
    return { item: null, issues };
  }
  if (!nonEmptyString(rec.added_by)) push(ns.attribution, `added_by が無い（${key}）`);
  if (!nonEmptyString(rec.added_at)) push(ns.attribution, `added_at が無い（${key}）`);
  const issue = slugIssue(rec, key, ns);
  if (issue !== null) {
    push(null, issue);
    return { item: { key, slug: null, index }, issues };
  }
  return { item: { key, slug: String(rec.slug).trim(), index }, issues };
}

/**
 * registries.json の intentional_diffs.pending を正規化する。
 *
 * ただの文字列は旧形式として読むが、帰属不明にする（slug: null）。
 * slug の名前空間を確認できない要素も、どの機能の inScope にも入らないので、帰属不明として扱い、すべての機能の対象にする。
 * 当たるのは、書き手が読めない要素（added_by の欠落・unknown・未知の名前）と、
 * 機能の slug を書けないスキル（CROSS_CUTTING_ONLY_WRITERS）が cross-cutting 以外を書いた要素である。
 * オブジェクトは item・slug・added_by・added_at を検証し、欠けていれば不整合として数える
 * （帰属が読めない追記は棚卸しの対象を決められないので、警告なしに帰属不明として扱わない）。
 *
 * 不整合には、その要素の帰属（読めた slug。読めなければ null ＝帰属不明）を添えて返す。
 * 呼び出し側が「棚卸しの対象と同じ範囲」だけを終了コードに入れるためである。
 * 別の機能に帰属すると読めている要素の形の不備で、いま閉じたい機能を止めない。
 * その要素は、その機能の棚卸しで失敗にする。
 * slug を読めない要素は帰属不明として全機能の対象になるので、どの機能でも失敗にする。
 * 当たるのは、ただの空文字列、文字列でもオブジェクトでもない要素、slug が無い・空・文字列でない要素である。
 * item が読めなくても slug が読めるなら、その slug の機能の棚卸しで失敗にする。
 *
 * @param {unknown[]} entries
 * @param {Set<string>|null} knownSlugs 機能インベントリの slug 集合（読めなければ null ＝何も検証できない）
 * @returns {{ items: {key:string, slug:(string|null), index:number}[], problems: string[], issues: {index:number, slug:(string|null), message:string}[] }}
 */
export function normalizePending(entries, knownSlugs = null) {
  /** @type {{key:string, slug:(string|null), index:number}[]} */
  const items = [];
  /** @type {{index:number, slug:(string|null), message:string}[]} */
  const issues = [];
  entries.forEach((entry, index) => {
    let normalized;
    if (typeof entry === "string") {
      normalized = normalizeStringEntry(entry, index);
    } else if (isPlainObject(entry)) {
      normalized = normalizeObjectEntry(entry, index, knownSlugs);
    } else {
      normalized = {
        item: null,
        issues: [
          {
            index,
            slug: null,
            message: `intentional_diffs.pending[${index}]: 文字列でもオブジェクトでもない（要素の形は replace-strategy の references/project-config.md「pending 要素の形」で定義する）`,
          },
        ],
      };
    }
    issues.push(...normalized.issues);
    if (normalized.item !== null) items.push(normalized.item);
  });
  return { items, problems: issues.map((issue) => issue.message), issues };
}

/**
 * 棚卸し対象か（この slug に帰属 / 横断 / 帰属不明）。
 *
 * @param {{slug:(string|null)}} item
 * @param {string} slug
 * @returns {boolean}
 */
function inScope(item, slug) {
  return item.slug === null || item.slug === slug || item.slug === CROSS_CUTTING;
}

/**
 * registries.json の keep / may_change の照合キー集合を作る。
 *
 * @param {unknown} registry
 * @param {'keep'|'may_change'} group
 * @returns {Set<string>}
 */
function targetKeys(registry, group) {
  const list = isPlainObject(registry) ? registry[group] : null;
  const set = new Set();
  if (isArray(list)) {
    for (const entry of list) {
      const key = matchKey(intentionalEntryText(entry));
      if (key !== "") set.add(key);
    }
  }
  return set;
}

/**
 * @typedef {object} ProblemSink
 * @property {string[]} problems すべての不整合
 * @property {string[]} registry 登録簿（設定ファイル）側の不整合で、棚卸しの対象範囲に入るもの
 * @property {string[]} record 棚卸し記録（成果物）側の不整合
 * @property {string[]} outOfScope 別機能に帰属すると読めている要素の形の不備（報告のみ）
 */

/**
 * 棚卸し記録の側の不整合を足す。
 *
 * @param {ProblemSink} sink
 * @param {string} message
 */
function addRecordProblem(sink, message) {
  sink.problems.push(message);
  sink.record.push(message);
}

/**
 * 登録簿の側の不整合を、棚卸しの対象範囲に入るかで分けて足す。
 *
 * @param {ProblemSink} sink
 * @param {string} message
 * @param {boolean} inTarget
 */
function addRegistryProblem(sink, message, inTarget) {
  sink.problems.push(message);
  if (inTarget) sink.registry.push(message);
  else sink.outOfScope.push(message);
}

/**
 * 設定ファイルの pending を読み、形の不備と、同じ文言の重複を不整合として足す。
 *
 * @param {unknown} intentional registries.json の intentional_diffs
 * @param {{ slug: string, knownSlugs: (Set<string>|null), sink: ProblemSink }} ctx
 * @returns {{key:string, slug:(string|null), index:number}[]}
 */
function readPendingItems(intentional, ctx) {
  const { slug, sink } = ctx;
  const rawPending = isPlainObject(intentional) ? intentional.pending : undefined;
  if (rawPending !== undefined && !isArray(rawPending)) {
    // 登録簿そのものが読めない。帰属を決められないので対象範囲に入れる。
    addRegistryProblem(sink, "intentional_diffs.pending が配列でない", true);
  }
  const { items, issues: shapeIssues } = normalizePending(
    isArray(rawPending) ? rawPending : [],
    ctx.knownSlugs,
  );
  for (const issue of shapeIssues) addRegistryProblem(sink, issue.message, inScope(issue, slug));

  // 同じ文言が pending に複数あると、どの要素を棚卸ししたのか決められない（先勝ちにしない）。
  /** @type {Map<string, number>} */
  const pendingCount = new Map();
  for (const item of items) pendingCount.set(item.key, (pendingCount.get(item.key) ?? 0) + 1);
  for (const [key, n] of pendingCount) {
    if (n > 1) {
      // 1 件でも対象に入る要素があれば、この機能の照合が決まらない。全て別機能なら報告だけにする。
      addRegistryProblem(
        sink,
        `intentional_diffs.pending に同じ文言が ${n} 件ある（${key}）`,
        items.some((item) => item.key === key && inScope(item, slug)),
      );
    }
  }
  return items;
}

/**
 * @typedef {object} TriageState
 * @property {string} slug 対象機能の slug
 * @property {Map<string, (string|null)>} pendingSlugs 照合キー → 設定ファイル側の帰属
 * @property {Set<string>} pendingKeys 設定ファイルの pending の照合キー
 * @property {Set<string>} keepKeys
 * @property {Set<string>} mayChangeKeys
 * @property {Set<string>} triaged 記録済みの照合キー
 * @property {{attributed:number, cross_cutting:number, unattributed:number, resolved:number, carried_over:number}} tally
 * @property {ProblemSink} sink
 */

/**
 * @typedef {object} EntryContext
 * @property {string} key 記録の照合キー
 * @property {(message: string) => void} fail 記録の位置を添えて不整合を足す
 */

/**
 * 記録した帰属を確かめて数える。記録が不整合なら false を返す。
 *
 * @param {Record<string, unknown>} rec
 * @param {EntryContext} ctx
 * @param {TriageState} state
 * @returns {boolean}
 */
function tallyAttribution(rec, ctx, state) {
  const { key, fail } = ctx;
  if (rec.slug !== undefined && rec.slug !== null && typeof rec.slug !== "string") {
    fail(`slug が文字列でない（${key}）`);
    return false;
  }
  const entrySlug = rec.slug === undefined || rec.slug === null ? null : matchKey(rec.slug) || null;
  // 設定ファイル側にまだ残っている要素は、記録した帰属が設定ファイルの帰属と一致することまで確かめる
  // （別機能に帰属する保留を自機能の slug で記録すると、その機能の棚卸しを素通りで閉じられる）。
  if (state.pendingSlugs.has(key)) {
    const registrySlug = state.pendingSlugs.get(key) ?? null;
    if (registrySlug !== entrySlug) {
      fail(
        `記録した帰属（${entrySlug ?? "帰属不明"}）が設定ファイルの pending の帰属（${registrySlug ?? "帰属不明"}）と違う（${key}）`,
      );
      return false;
    }
  }
  if (entrySlug === null) state.tally.unattributed += 1;
  else if (entrySlug === CROSS_CUTTING) state.tally.cross_cutting += 1;
  else if (entrySlug === state.slug) state.tally.attributed += 1;
  else {
    fail(`対象外の slug（${entrySlug}）を棚卸しに記録している（${key}）`);
    return false;
  }
  return true;
}

/**
 * 持ち越しの記録を確かめて数える。
 *
 * @param {Record<string, unknown>} rec
 * @param {EntryContext} ctx
 * @param {TriageState} state
 */
function checkCarriedOver(rec, ctx, state) {
  const { key, fail } = ctx;
  state.tally.carried_over += 1;
  if (!nonEmptyString(rec.reason)) {
    fail(`持ち越しの理由が空（${key}）— 理由の記録が通過の条件`);
  }
  if (!state.pendingKeys.has(key)) {
    fail(`持ち越しと記録されているが pending に無い（${key}）`);
  }
}

/**
 * keep / may_change へ移したという記録を、実際に移っていることまで確かめて数える。
 *
 * @param {Record<string, unknown>} rec
 * @param {EntryContext & { disposition: string }} ctx
 * @param {TriageState} state
 */
function checkPromoted(rec, ctx, state) {
  const { key, fail, disposition } = ctx;
  state.tally.resolved += 1;
  const promoted =
    rec.promoted_as === undefined || rec.promoted_as === null ? key : matchKey(rec.promoted_as);
  if (promoted === "") {
    fail(`promoted_as が空文字列（${key}）`);
    return;
  }
  if (state.pendingKeys.has(key)) {
    fail(`${disposition} へ移したと記録されているが pending に残っている（${key}）`);
  }
  const dest = disposition === "keep" ? state.keepKeys : state.mayChangeKeys;
  if (!dest.has(promoted)) {
    fail(
      `${disposition} に見つからない（${promoted}）— 文言を変えて移したなら promoted_as に移動後の文言を書く`,
    );
  }
}

/**
 * 棚卸しの記録 1 件を確かめて数える。
 *
 * @param {unknown} entry
 * @param {number} index
 * @param {TriageState} state
 */
function triageEntry(entry, index, state) {
  /** @param {string} message */
  const fail = (message) =>
    addRecordProblem(state.sink, `intentional_diffs_pending.entries[${index}]: ${message}`);
  if (!isPlainObject(entry)) {
    fail("オブジェクトでない");
    return;
  }
  // 文字列以外は matchKey で "[object Object]" などに潰れ、誤って照合キーとして使われる。そのため型で弾く
  // （registries の側の intentionalEntryText と同じ扱い。潰れたキーは、pending と偶然に一致や不一致を起こす）。
  const key = typeof entry.item === "string" ? matchKey(entry.item) : "";
  if (key === "") {
    fail("item が空／文字列でない");
    return;
  }
  if (state.triaged.has(key)) {
    fail(`同じ item が二重に記録されている（${key}）`);
    return;
  }
  state.triaged.add(key);
  const ctx = { key, fail };
  if (!tallyAttribution(entry, ctx, state)) return;

  const disposition = typeof entry.disposition === "string" ? entry.disposition : "";
  if (!DISPOSITIONS.includes(disposition)) {
    fail(`disposition が ${DISPOSITIONS.join(" / ")} のいずれでもない（${key}）`);
    return;
  }
  if (disposition === "carried_over") checkCarriedOver(entry, ctx, state);
  else checkPromoted(entry, { ...ctx, disposition }, state);
}

/**
 * 宣言された件数を、数え直した値と突き合わせる（宣言は信用しない）。
 *
 * @param {unknown} record
 * @param {TriageState["tally"]} tally
 * @param {ProblemSink} sink
 */
function checkDeclaredCounts(record, tally, sink) {
  /** @type {Record<string, unknown>} */
  const declared = isPlainObject(record) ? record : {};
  for (const [name, value] of Object.entries(tally)) {
    if (declared[name] !== undefined && declared[name] !== value) {
      addRecordProblem(
        sink,
        `intentional_diffs_pending.${name}: 宣言 ${JSON.stringify(declared[name])} と数え直した ${value} が一致しない`,
      );
    }
  }
}

/**
 * countTriage の戻り値を組み立てる。
 *
 * @param {TriageState["tally"]} tally
 * @param {{ inScope: number, untriaged: number }} scope
 * @param {ProblemSink} sink
 */
function triageResult(tally, scope, sink) {
  return {
    ...tally,
    in_scope: scope.inScope,
    untriaged: scope.untriaged,
    problems: sink.problems,
    registry_problems: sink.registry,
    record_problems: sink.record,
    out_of_scope_problems: sink.outOfScope,
  };
}

/**
 * 棚卸しの記録と設定ファイルの pending を突き合わせて数え直す。
 *
 * 不整合は、不備のある場所で分けて返す。`registry_problems` は設定ファイルの登録簿
 * （`intentional_diffs.pending`）、`record_problems` は成果物の棚卸し記録
 * （`intentional_diffs_pending.entries`）。終了コードへ入れるのはこの 2 つと未棚卸しだけで、
 * 別機能に帰属すると読めている要素の形の不備は `out_of_scope_problems` として報告だけする
 * （棚卸しの対象範囲と終了コードの範囲を揃える。対象 0 件の機能が、無関係な要素で閉じられなくならないため）。
 *
 * @param {object} input
 * @param {unknown} input.registries registries.json の内容
 * @param {unknown} input.record diff-metadata.json の intentional_diffs_pending
 * @param {string} input.slug 対象機能の slug
 * @param {Set<string>|null} [input.knownSlugs] 機能インベントリの slug 集合（読めなければ null）
 * @returns {{attributed:number, cross_cutting:number, unattributed:number, resolved:number, carried_over:number, in_scope:number, untriaged:number, problems:string[], registry_problems:string[], record_problems:string[], out_of_scope_problems:string[]}}
 */
export function countTriage({ registries, record, slug, knownSlugs = null }) {
  /** @type {ProblemSink} */
  const sink = { problems: [], registry: [], record: [], outOfScope: [] };
  const intentional = isPlainObject(registries) ? registries.intentional_diffs : null;
  const items = readPendingItems(intentional, { slug, knownSlugs, sink });
  const scoped = items.filter((item) => inScope(item, slug));
  const tally = { attributed: 0, cross_cutting: 0, unattributed: 0, resolved: 0, carried_over: 0 };

  const entries = isPlainObject(record) ? record.entries : undefined;
  if (!isArray(entries)) {
    // CLI はこの形を exit 2 で先に落とすため、ここへは main() を経由しない呼び出しだけが来る。
    addRecordProblem(
      sink,
      "intentional_diffs_pending.entries が配列でない（棚卸しの記録が読めない）",
    );
    return triageResult(tally, { inScope: scoped.length, untriaged: scoped.length }, sink);
  }

  /** @type {TriageState} */
  const state = {
    slug,
    // 照合キー → 設定ファイル側の帰属。重複キーは上で不整合として報告するが、全て別機能に帰属する重複は
    // 報告だけ（out_of_scope）なので終了コードには出ない。その場合ここは後勝ちになる。ただし、
    // その帰属を記録した棚卸しは「対象外の slug」または「帰属が違う」で落ちるため、素通りにはならない。
    pendingSlugs: new Map(items.map((item) => [item.key, item.slug])),
    pendingKeys: new Set(items.map((item) => item.key)),
    keepKeys: targetKeys(intentional, "keep"),
    mayChangeKeys: targetKeys(intentional, "may_change"),
    triaged: new Set(),
    tally,
    sink,
  };
  entries.forEach((entry, index) => triageEntry(entry, index, state));
  checkDeclaredCounts(record, tally, sink);

  const untriagedItems = scoped.filter((item) => !state.triaged.has(item.key));
  for (const item of untriagedItems) {
    sink.problems.push(
      `未棚卸し: intentional_diffs.pending[${item.index}]（${item.slug ?? "帰属不明"}）— ${item.key}`,
    );
  }
  return triageResult(tally, { inScope: scoped.length, untriaged: untriagedItems.length }, sink);
}

const USAGE =
  "usage: node pending-triage-check.mjs --registries <registries.json> --metadata <diff-metadata.json> --features <features.md>\n";

/**
 * 引数を読む。使い方の誤りなら stderr に書いて null を返す。
 *
 * @param {string[]} argv
 * @returns {Record<string, string>|null}
 */
function parseArgs(argv) {
  const opts = parseFlagOpts(argv, ["--registries", "--metadata", "--features"], USAGE);
  if (opts === null) return null;
  if (!opts.registries || !opts.metadata) {
    process.stderr.write(USAGE);
    return null;
  }
  return opts;
}

/**
 * stderr にエラーを書いて、使い方や入力の誤りを表す終了コード 2 を返す。
 *
 * @param {string} message
 * @returns {{ exit: number }}
 */
function exit2(message) {
  process.stderr.write(message);
  return { exit: 2 };
}

/**
 * 機能インベントリを読む。渡されなければ何も検証できないので、別の機能への緩和を当てない（null）。
 *
 * @param {string|undefined} path
 * @param {(p:string)=>string} readFile
 * @returns {{ exit: number } | { value: (Set<string>|null) }}
 */
function loadFeatureSlugs(path, readFile) {
  if (!path) return { value: null };
  /** @type {string} */
  let featuresText;
  try {
    featuresText = readFile(path);
  } catch (e) {
    return exit2(`error: features.md を読めない: ${path}: ${String(e)}\n`);
  }
  const knownSlugs = parseFeatureSlugs(featuresText);
  if (knownSlugs === null) {
    // 読めたのに slug 表が無いのは、別のファイルを渡したか形式が変わったかのどちらか。
    // 警告なしに緩和を当てないと、緩和が当たらない理由が出力から分からない。
    return exit2(
      `error: features.md に slug 列の表が無い（機能インベントリとして読めない）: ${path}\n`,
    );
  }
  return { value: knownSlugs };
}

/**
 * registries.json を読み、棚卸しの対象を決められる形かを確かめる。
 *
 * @param {string} path
 * @param {(p:string)=>string} readFile
 * @returns {{ exit: number } | { value: Record<string, unknown> }}
 */
function loadRegistries(path, readFile) {
  /** @type {unknown} */
  let registries;
  try {
    registries = JSON.parse(readFile(path));
  } catch (e) {
    return exit2(`error: registries.json を読めない: ${path}: ${String(e)}\n`);
  }
  // 空集合として扱うと「対象 0 件で合格」になり、間違ったファイルやキーの欠けた設定が警告なしに通る。
  if (!isPlainObject(registries)) {
    return exit2(`error: registries.json がオブジェクトでない: ${path}\n`);
  }
  const intentionalDiffs = registries.intentional_diffs;
  if (!isPlainObject(intentionalDiffs)) {
    return exit2(
      `error: registries.json に intentional_diffs が無い／オブジェクトでない（棚卸しの対象を決められない）: ${path}\n`,
    );
  }
  if (!isArray(intentionalDiffs.pending)) {
    return exit2(
      `error: registries.json の intentional_diffs.pending が無い／配列でない（設定ファイルでは空でも [] を書く）: ${path}\n`,
    );
  }
  return { value: registries };
}

/**
 * diff-metadata.json を読み、slug を取り出す。
 *
 * @param {string} path
 * @param {(p:string)=>string} readFile
 * @returns {{ exit: number } | { value: { slug: string, meta: Record<string, unknown> } }}
 */
function loadMetadata(path, readFile) {
  /** @type {unknown} */
  let metadata;
  try {
    metadata = JSON.parse(readFile(path));
  } catch (e) {
    return exit2(`error: diff-metadata.json を読めない: ${path}: ${String(e)}\n`);
  }
  if (!isPlainObject(metadata)) {
    return exit2(`error: diff-metadata.json がオブジェクトでない: ${path}\n`);
  }
  if (!nonEmptyString(metadata.slug)) {
    // slug が無いと棚卸しの対象を決められない。空集合として扱うと、全件が警告なしに対象外になる。
    return exit2(`error: diff-metadata.json に slug が無い: ${path}\n`);
  }
  return { value: { slug: String(metadata.slug).trim(), meta: metadata } };
}

/**
 * 棚卸しの記録が無いときの出力を書き、終了コード 1 を返す（旧成果物として合格にしない）。
 *
 * @param {string} slug
 * @param {string} metadataPath
 * @returns {{ exit: number }}
 */
function reportMissingRecord(slug, metadataPath) {
  // 旧成果物として合格にしない（棚卸しは、対象が 0 件でも記録を求める）。
  process.stdout.write(
    `${JSON.stringify({ tool: "pending-triage-check", version: VERSION, slug, recorded: false, in_scope: null, attributed: 0, cross_cutting: 0, unattributed: 0, resolved: 0, carried_over: 0, untriaged: null, problems: ["intentional_diffs_pending が無い（棚卸し未実施）"], registry_problems: [], record_problems: ["intentional_diffs_pending が無い（棚卸し未実施）"], out_of_scope_problems: [] }, null, 2)}\n`,
  );
  process.stderr.write(
    `error: diff-metadata.json に intentional_diffs_pending が無い（棚卸し未実施）。収束させずに棚卸しする: ${metadataPath}\n`,
  );
  return { exit: 1 };
}

/**
 * 棚卸しの記録（intentional_diffs_pending）を取り出し、読める形かを確かめる。
 *
 * @param {{ slug: string, meta: Record<string, unknown> }} metadata
 * @param {string} metadataPath
 * @returns {{ exit: number } | { value: Record<string, unknown> }}
 */
function readTriageRecord(metadata, metadataPath) {
  const record = metadata.meta.intentional_diffs_pending;
  if (record === undefined) return reportMissingRecord(metadata.slug, metadataPath);
  if (!isPlainObject(record)) {
    return exit2(`error: intentional_diffs_pending がオブジェクトでない: ${metadataPath}\n`);
  }
  if (!isArray(record.entries)) {
    // 成果物の型の誤りは「未棚卸し」(exit 1) とまとめず、型の誤りや使い方の誤り (exit 2) として返す
    // （両方を 1 で返すと、自動化が「棚卸しをやり直せば直る」と「成果物が不正」を区別できない）。
    return exit2(
      `error: intentional_diffs_pending.entries が配列でない（棚卸しの記録が読めない）: ${metadataPath}\n`,
    );
  }
  return { value: record };
}

/**
 * 入力をすべて読み、数え直しに渡せる形にする。
 *
 * @param {Record<string, string>} opts
 * @param {(p:string)=>string} readFile
 * @returns {{ exit: number } | { value: { registries: unknown, record: unknown, slug: string, knownSlugs: (Set<string>|null) } }}
 */
function loadInputs(opts, readFile) {
  const features = loadFeatureSlugs(opts.features, readFile);
  if ("exit" in features) return features;
  const registries = loadRegistries(opts.registries, readFile);
  if ("exit" in registries) return registries;
  const metadata = loadMetadata(opts.metadata, readFile);
  if ("exit" in metadata) return metadata;
  const record = readTriageRecord(metadata.value, opts.metadata);
  if ("exit" in record) return record;
  const knownSlugs = features.value;
  const { slug } = metadata.value;
  // 対象の機能の slug そのものがインベントリに無いなら、比較の基準が誤っている（綴りが違えば、
  // すべての帰属が「別の機能」に見え、対象 0 件で閉じられる）。合格にせず、成果物の不整合として失敗にする。
  if (knownSlugs !== null && !knownSlugs.has(slug)) {
    return exit2(`error: 対象 slug が機能インベントリに無い（${slug}）: ${opts.features}\n`);
  }
  return { value: { registries: registries.value, record: record.value, slug, knownSlugs } };
}

/**
 * 数え直した結果の要約と、収束させない理由を stderr に書く。
 *
 * @param {ReturnType<typeof countTriage>} counted
 * @param {Record<string, string>} opts
 * @param {boolean} hasFeatures
 */
function reportTriage(counted, opts, hasFeatures) {
  for (const p of counted.problems) process.stderr.write(`warn: ${p}\n`);
  // 対象 0 件でも「何を何件見たか」を必ず出す（0 件と未実行を同じ出力にしない）。
  // 内訳（この機能 / 横断 / 帰属不明）は棚卸しの記録から、in_scope は設定ファイルの pending から数えており
  // 出所が違う（確定させた分は pending から消えている）ので、同じ数として並べない。
  const recordedTotal = counted.attributed + counted.cross_cutting + counted.unattributed;
  process.stderr.write(
    `note: 棚卸しの記録 ${recordedTotal} 件（この機能 ${counted.attributed} / 横断 ${counted.cross_cutting} / 帰属不明 ${counted.unattributed}）、確定 ${counted.resolved} 件、持ち越し ${counted.carried_over} 件。設定ファイルの pending に残る対象 ${counted.in_scope} 件（うち未棚卸し ${counted.untriaged} 件）: ${opts.registries}\n`,
  );
  if (counted.out_of_scope_problems.length > 0) {
    // 数を出さないと「対象外だから見なくてよい」と「検査が動いていない」が同じ見え方になる。
    process.stderr.write(
      `note: 別機能に帰属する pending の形の不備 ${counted.out_of_scope_problems.length} 件は warn のみ（その機能の棚卸しが落とす）: ${opts.registries}\n`,
    );
  }
  if (!hasFeatures) {
    // 緩和が当たらない理由を出す（--features が無いと、「別の機能へ回す」判断ができない）。
    process.stderr.write(
      "note: --features を渡していないので、別機能に帰属する要素の緩和を適用していない（slug の実在を確認できないため全件を対象にした）\n",
    );
  }
  if (counted.untriaged > 0) {
    process.stderr.write(
      `error: 未棚卸し ${counted.untriaged} 件 — 収束させず人へ提示して keep / may_change へ移すか持ち越し理由を記録する\n`,
    );
  }
  if (counted.registry_problems.length > 0) {
    // 不備があるのは設定ファイルの登録簿で、成果物ではない（直す場所を取り違えさせない）。
    process.stderr.write(
      `error: 設定ファイルの登録簿の不整合（intentional_diffs.pending。上の warn を参照）— 収束させず直す: ${opts.registries}\n`,
    );
  }
  if (counted.record_problems.length > 0) {
    process.stderr.write(
      `error: 棚卸し記録の不整合（intentional_diffs_pending.entries。上の warn を参照）— 収束させず直す: ${opts.metadata}\n`,
    );
  }
}

/**
 * CLI 本体。
 *
 * @param {string[]} argv
 * @param {{ readFile?: (p:string)=>string }} [deps]
 * @returns {number} 終了コード
 */
export function main(argv, deps = {}) {
  const readFile = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
  const opts = parseArgs(argv);
  if (opts === null) return 2;
  const inputs = loadInputs(opts, readFile);
  if ("exit" in inputs) return inputs.exit;
  const { slug, knownSlugs } = inputs.value;
  const counted = countTriage(inputs.value);
  // 終了コードへ入れるのは棚卸しの対象範囲だけ（未棚卸し・登録簿側の対象内の不整合・棚卸し記録の不整合）。
  // 別機能に帰属すると読めている要素の形の不備は warn として出すが、この機能の収束は妨げない。
  const ok =
    counted.untriaged === 0 &&
    counted.registry_problems.length === 0 &&
    counted.record_problems.length === 0;
  process.stdout.write(
    `${JSON.stringify({ tool: "pending-triage-check", version: VERSION, slug, recorded: true, ...counted }, null, 2)}\n`,
  );
  reportTriage(counted, opts, knownSlugs !== null);
  return ok ? 0 : 1;
}

if (isCliEntry(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
