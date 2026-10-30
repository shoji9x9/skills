// 「要求単位の根拠」の書き戻しの抜けを数える。判定の規則は、このファイルで定義する。
//
// .replace/features.md の「要求単位の根拠」列は、口の要求単位を確定した本人が、
// replace-strategy evidence で 推定 → 実測 へ更新する。確定できなかった口は 推定 のまま残す。
// 測るまで機能を閉じさせないものは、parity-suite が .replace/parity/<slug>/metadata.json の unmeasured へ宣言する。
// どちらも行われないと、確定済みの口が status の未検証領域に残り続け、未検証領域の一覧が実態より多く出る（読まれなくなる）。
//
// このツールが数えるのは、「未確認の口」のうち unmeasured にも宣言されていないもの（書き戻しか宣言の抜け）の 1 つだけである。
//
// 未確認の口は、次のどれかに当たる口である（原本は references/status.md の導出項目 11）。
//
// - 根拠が 推定 の口。
// - API 列にあるのに、根拠列のどのエントリにも対応づかない口（根拠が無い＝未確認）。
// - 根拠の語彙が 実測: と 推定: のどちらでもない口。語彙にないものは未確認として扱う（判定できないときは失敗として扱う）。
//   区切りまで見て判定する。前方一致だと、「実測できず」が 実測 と誤って判定される。
//
// 対応づけの単位（宣言）は、口の文字列の完全一致である。根拠エントリの `<口> → <根拠>` の矢印より前を
// `,` と `、` で分割し、空白を 1 つに畳んでから、API 列の口と突き合わせる。
// 散文（「両方」など）は口に一致しないので、対応づかないものとして数える。
// 曖昧な対応づけを許すと、書き戻しの抜けが「まとめて書いてある」と誤って判定される。
// unmeasured の側も同じ単位で、entries[].endpoint の完全一致だけを宣言として数える。
// item の散文に口が含まれることは、宣言に数えない。部分一致では、別の口が宣言済みと誤って判定される。
// unmeasured.declared: false は「宣言を持たない」という意味なので、entries を読まない。
// parity-suite の artifact-health-check.mjs はその節を判定しないので、読むと、誰も確かめていない宣言で通ってしまう。
//
// 判定できないときは失敗として扱う。列が無い・宣言の有無を判定できない・入力が不正なものを、合格として扱わない。
// 対象外（バッチ・「その他の Issue」の行）は不合格ではないものの、exit 0 とも分ける。
// 口を持たない行と「口はあるが未確認 0 件」を同じ出口にすると、表を置き間違えた行が合格と誤って判定される。
//
// 決定論的に動く（乱数・現在時刻・ネットワークに依存しない）。TypeScript の構文は使わない（型は JSDoc で書く）。

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isArray } from "./lib/is-array.mjs";
import { isPlainObject } from "./lib/guards.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import { parseFlags } from "./lib/flags.mjs";
import { parseJsonOrThrow } from "./lib/json.mjs";
import { collapse, parseTables, unclosedFenceMessage } from "./lib/markdown.mjs";

/**
 * JSON の値の型を、利用者に表示する名前で返す（object や配列でない値を報告するときに使う）。
 * @param {unknown} value
 * @returns {string}
 */
function valueKind(value) {
  if (value === null) return "null";
  if (isArray(value)) return "配列";
  return typeof value;
}

/** ツールのバージョン（このファイルで定義する）。判定のロジックや出力の形を変えたら上げる。 */
export const VERSION = "5";

/** 使い方の誤り・入力の不備（exit 2）。 */
export class UsageError extends Error {}

/** 判定不能（exit 3）。合格としても不合格としても扱わない。 */
export class UndecidableError extends Error {}

/**
 * 対象外（exit 4）。口を持たない表の行（バッチ・「その他の Issue」）。
 * チェックすべき口が無いので不合格ではない。ただし、「チェックした結果 0 件」とも区別する
 * （exit 0 に畳むと、口を持つ行を表に置き間違えたときに、合格と誤って判定される）。
 */
export class NotApplicableError extends Error {}

/** 根拠列の見出し（原本は features.md）。 */
const EVIDENCE_HEADER = "要求単位の根拠";

/** 口を並べる列の見出し（機能一覧は「新規実装 API」、横断 API 表は「API」）。 */
const ENDPOINT_HEADERS = ["新規実装 API", "API"];

/** 根拠の語彙。 */
const MEASURED = "実測";
const ESTIMATED = "推定";

/**
 * 語彙は区切り（`実測:` / `推定:`）まで見て判定する。前方一致だけだと
 * 「実測できず」「実測不能」「実測予定」が 実測 と誤って判定され、確定していない口が
 * 書き戻し済みとして通ってしまう（語彙にないものを未確認として扱う判定が、この 1 語で逆になる）。
 */
const VERDICT_PATTERNS = [
  { verdict: MEASURED, pattern: /^実測\s*[:：]/u },
  { verdict: ESTIMATED, pattern: /^推定\s*[:：]/u },
];

/** 口の欄に「無い」と書くときの語（口として数えない）。 */
const NO_ENDPOINT_MARKERS = new Set(["-", "‐", "–", "—", "ー", "なし", "無し"]);

/** バッチ表・「その他の Issue」表の見出しに現れる目印（対象外の陽性同定用）。 */
const NON_ENDPOINT_TABLE_MARKERS = ["バッチ名", "比較する出力", "4種に当てはまらない理由"];

/** 空白を全て落とした見出し（列名のずれの検出用）。 */
const ENDPOINT_HEADERS_SQUEEZED = new Set(
  ENDPOINT_HEADERS.map((header) => header.normalize("NFKC").replace(/\s+/gu, "")),
);

/**
 * バッチ表・「その他の Issue」表を陽性に同定する見出しか。
 * 対象外（exit 4）はこの同定が取れたときだけ名乗る。取れないまま対象外にすると、
 * 列の導入前の機能一覧まで「バッチ表にある」という事実と違う記録で通過する。
 * @param {string} header
 * @returns {boolean}
 */
export function looksLikeNonEndpointTableHeader(header) {
  const squeezed = collapse(header).normalize("NFKC").replace(/\s+/gu, "");
  return NON_ENDPOINT_TABLE_MARKERS.some((marker) => squeezed.includes(marker));
}

/**
 * 根拠列「らしい」見出しか。完全一致しないが根拠列のつもりで書かれた見出しを拾う。
 * 根拠列の不在を「列の導入前」（exit 3）として扱うと、完了の判定を止めない。そこで、
 * 列名がずれただけの現役インベントリはここで拾って入力の不備（exit 2）として扱う。
 * @param {string} header
 * @returns {boolean}
 */
export function looksLikeEvidenceHeader(header) {
  const squeezed = collapse(header).normalize("NFKC").replace(/\s+/gu, "");
  if (squeezed.length === 0) return false;
  if (squeezed === EVIDENCE_HEADER.normalize("NFKC").replace(/\s+/gu, "")) return true;
  return squeezed.includes("根拠");
}

/**
 * 口の列「らしい」見出しか。完全一致しないが口の列のつもりで書かれた見出しを拾う。
 * 対象外（exit 4）を「口の列が無い」で決めると、列名がずれた機能行が痕跡なく通過するため、
 * ここで拾って入力の不備（exit 2）として扱う。
 * @param {string} header
 * @returns {boolean}
 */
export function looksLikeEndpointHeader(header) {
  // NFKC で全角を畳む。`ＡＰＩ` のような表記を拾えないと、口の列を持つ機能行が
  // 対象外（exit 4）で素通りする。
  const squeezed = collapse(header).normalize("NFKC").replace(/\s+/gu, "");
  if (squeezed.length === 0) return false;
  if (ENDPOINT_HEADERS_SQUEEZED.has(squeezed)) return true;
  return /api/iu.test(squeezed);
}

/**
 * 口の一覧を列のセルから取り出す。
 * @param {string} cell
 * @returns {string[]}
 */
export function parseEndpoints(cell) {
  return cell
    .split(/[,、]/u)
    .map(collapse)
    .filter((value) => value.length > 0 && !NO_ENDPOINT_MARKERS.has(value));
}

/**
 * 根拠セルをエントリへ分解する。
 * @param {string} cell
 * @returns {{ endpoints: string[], verdict: string, raw: string }[]}
 */
export function parseEvidenceEntries(cell) {
  return cell
    .split("／")
    .map((chunk) => collapse(chunk))
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const arrow = chunk.indexOf("→");
      if (arrow < 0) return { endpoints: [], verdict: "", raw: chunk };
      const endpoints = parseEndpoints(chunk.slice(0, arrow));
      const body = collapse(chunk.slice(arrow + 1));
      const matched = VERDICT_PATTERNS.find(({ pattern }) => pattern.test(body));
      return { endpoints, verdict: matched === undefined ? "" : matched.verdict, raw: chunk };
    });
}

/**
 * 表の種別を見出しから 1 回だけ同定する。行ごとの分岐をこの種別に閉じることで、
 * 条件の入れ子が増えるたびに非対称な抜けができるのを防ぐ。
 * @param {string[]} headers
 * @returns {{ kind: "feature" | "legacy" | "not-applicable" | "missing-endpoint-column" } | { kind: "malformed-endpoint", headers: string[], missingEvidence: boolean } | { kind: "malformed-evidence", headers: string[] }}
 */
export function classifyTable(headers) {
  const hasEndpoint = headers.some((header) => ENDPOINT_HEADERS.includes(header));
  const hasEvidence = headers.includes(EVIDENCE_HEADER);
  const endpointish = headers.filter(looksLikeEndpointHeader);
  const evidenceish = headers.filter(looksLikeEvidenceHeader);
  const batchMarker = headers.some(looksLikeNonEndpointTableHeader);

  if (hasEndpoint && hasEvidence) return { kind: "feature" };
  if (hasEndpoint) {
    // 根拠列らしい見出しがあるのに完全一致しないのは列名のずれ。判定不能（exit 3）として扱うと、
    // 完了の判定を止めないので、推定の口が残る現役のインベントリが通ってしまう。
    return evidenceish.length > 0
      ? { kind: "malformed-evidence", headers: evidenceish }
      : { kind: "legacy" };
  }
  if (hasEvidence) {
    // 口の列らしい見出しが 1 つも無いなら、直す対象は「名前」ではなく「列そのものの不在」。
    // 改名を案内すると存在しない見出しを探すことになる（対称な根拠列側と同じ扱いにする）。
    return endpointish.length > 0
      ? { kind: "malformed-endpoint", headers: endpointish, missingEvidence: false }
      : { kind: "missing-endpoint-column" };
  }
  // 口の列も根拠列も無い表は 3 通りある。設計上どちらも持たないバッチ・「その他の Issue」、
  // 列の導入前の機能一覧、そして列名がずれた表。
  // **バッチかどうかを最初に判定する。** 見出しに `API` を含むバッチ表（`比較する出力（API レスポンス…）`）が
  // あるので、口の列らしさの判定を先に置くと正当なバッチ表が列名のずれ（exit 2）と誤って判定され、
  // batch モードの完了判定が通らなくなる。
  if (batchMarker) return { kind: "not-applicable" };
  if (endpointish.length > 0)
    return { kind: "malformed-endpoint", headers: endpointish, missingEvidence: true };
  if (evidenceish.length > 0) return { kind: "malformed-evidence", headers: evidenceish };
  // どれとも同定できない表は対象外とせず、判定不能として扱う（対象外にすると、列の導入前の
  // 機能一覧まで「バッチ表にある」という事実と違う記録で通過する）。
  return { kind: "legacy" };
}

/**
 * 列名のずれで判定できない表の種別について、直し方を添えた理由を返す。
 * 扱いを決めていない種別は例外にする（classifyTable に種別を足したときに、ここへの追加を忘れたことが分かる）。
 * @param {ReturnType<typeof classifyTable>} kind
 * @param {string} slug
 * @returns {string}
 */
function malformedReason(kind, slug) {
  if (kind.kind === "missing-endpoint-column") {
    return `slug ${slug} の行の表は「${EVIDENCE_HEADER}」列を持つのに口の列（${ENDPOINT_HEADERS.join(" / ")}）が無い。列を追加する（改名ではない）`;
  }
  if (kind.kind === "malformed-endpoint") {
    return (
      `slug ${slug} の行の表は口の列らしい見出し（${kind.headers.join(" / ")}）を持つが、規約名（${ENDPOINT_HEADERS.join(" / ")}）と一致しない。見出しを規約名に揃える` +
      (kind.missingEvidence
        ? `（「${EVIDENCE_HEADER}」列も無いので、列名を揃えた後に列の追加も要る）`
        : "")
    );
  }
  if (kind.kind === "malformed-evidence") {
    return `slug ${slug} の行の表は根拠列らしい見出し（${kind.headers.join(" / ")}）を持つが、規約名（${EVIDENCE_HEADER}）と一致しない。見出しを規約名に揃える`;
  }
  throw new TypeError(`表の種別 ${kind.kind} の扱いが決まっていない`);
}

/**
 * @typedef {{ endpointCell: string, endpoints: string[], entries: ReturnType<typeof parseEvidenceEntries> }} EvidenceRow
 * @typedef {{ matched: EvidenceRow[], legacyRows: number, nonEndpointRows: number, malformed: string[] }} RowTally
 */

/**
 * 対象 slug の行を表の種別ごとに振り分けて数える。
 * @param {ReturnType<typeof parseTables>["tables"]} tables
 * @param {string} slug
 * @returns {RowTally}
 */
function tallyRows(tables, slug) {
  /** @type {RowTally} */
  const tally = { matched: [], legacyRows: 0, nonEndpointRows: 0, malformed: [] };
  // 判定できない行は理由の別で数える。同じ終了コードへ畳むと、呼び出し側が
  // 直す場所（列名・列の追加・表の置き場所）を取り違える。
  for (const table of tables) {
    const slugIndex = table.headers.indexOf("slug");
    if (slugIndex < 0) continue;
    const kind = classifyTable(table.headers);
    for (const row of table.rows) {
      if (collapse(row[slugIndex] ?? "") !== slug) continue;
      tallyRow(tally, { table, row, kind, slug });
    }
  }
  return tally;
}

/**
 * 対象 slug の 1 行を、表の種別に応じて tally へ足す。
 * @param {RowTally} tally
 * @param {{ table: ReturnType<typeof parseTables>["tables"][number], row: string[], kind: ReturnType<typeof classifyTable>, slug: string }} options
 */
function tallyRow(tally, { table, row, kind, slug }) {
  if (kind.kind === "legacy") {
    tally.legacyRows += 1;
    return;
  }
  if (kind.kind === "not-applicable") {
    tally.nonEndpointRows += 1;
    return;
  }
  // 口の列と根拠の列を持つ表（feature）だけを判定に使う。ほかの種別は列名のずれとして理由を数える。
  if (kind.kind !== "feature") {
    tally.malformed.push(malformedReason(kind, slug));
    return;
  }
  const endpointIndex = table.headers.findIndex((header) => ENDPOINT_HEADERS.includes(header));
  const evidenceIndex = table.headers.indexOf(EVIDENCE_HEADER);
  tally.matched.push({
    endpointCell: collapse(row[endpointIndex] ?? ""),
    endpoints: parseEndpoints(row[endpointIndex] ?? ""),
    entries: parseEvidenceEntries(row[evidenceIndex] ?? ""),
  });
}

/**
 * 判定できる行が無いときに、理由に応じた例外を投げる。
 * @param {RowTally} tally
 * @param {{ slug: string, tables: ReturnType<typeof parseTables>["tables"], strayRows: ReturnType<typeof parseTables>["strayRows"] }} context
 * @returns {never}
 */
function throwNoRow(tally, { slug, tables, strayRows }) {
  if (tally.malformed.length > 0) {
    throw new UsageError(`${tally.malformed[0]}。対象外としても判定不能としても扱わない`);
  }
  if (tally.nonEndpointRows > 0) {
    throw new NotApplicableError(
      `slug ${slug} の行はバッチ・「その他の Issue」の表にある（見出しから同定）。要求単位の根拠は口ごとの記録なので、この行に検査対象は無い`,
    );
  }
  if (tally.legacyRows > 0) {
    throw new UndecidableError(
      `slug ${slug} の行の表に「${EVIDENCE_HEADER}」列が無い（列の導入前に作られたインベントリ）。列の追加は replace-strategy の setup / issues が行う`,
    );
  }
  // 表の途中の空行や HTML コメントの行で表が切れると、その後ろの行は表の外になり、ここでは見つからない。
  // 画面では行が見えるので、表に属さない行の位置を添えて、どこで表が切れたかを示す。
  // GFM は行頭の `|` を省けるので、slug 列を持つ表と同じセル数の行も、表の行を意図したものとして挙げる。
  const widths = new Set(
    tables.filter((table) => table.headers.includes("slug")).map((table) => table.headers.length),
  );
  const outside = strayRows
    .filter((stray) => stray.leadingPipe || widths.has(stray.cells))
    .map((stray) => stray.line);
  throw new UsageError(
    `slug ${slug} の行がインベントリに無い` +
      (outside.length > 0
        ? `（${outside.join(", ")} 行目は表に属さない。表の途中の空行か HTML コメントの行で表が切れていないかを確かめる）`
        : ""),
  );
}

/**
 * 見つかった行の API 列が空欄でなく、口が重複していないことを確かめる。
 * @param {EvidenceRow} row
 * @param {string} slug
 */
function assertEndpointCell(row, slug) {
  if (row.endpointCell.length === 0) {
    throw new UsageError(
      `slug ${slug} の API 列が空欄。口が無いことを確かめたなら \`-\` か \`なし\` と書く。空欄は未調査であり、口 0 件（合格）として扱わない`,
    );
  }
  const seen = new Set();
  for (const endpoint of row.endpoints) {
    if (seen.has(endpoint)) throw new UsageError(`口 ${endpoint} が API 列に重複している`);
    seen.add(endpoint);
  }
}

/**
 * features.md から対象 slug の口と根拠を取り出す。
 * @param {string} text
 * @param {string} slug
 * @returns {{ endpointCell: string, endpoints: string[], entries: { endpoints: string[], verdict: string, raw: string }[] }}
 */
export function readRow(text, slug) {
  const { tables, strayRows, unclosedFence } = parseTables(text);
  if (unclosedFence !== null)
    throw new UsageError(`インベントリの ${unclosedFenceMessage(unclosedFence)}`);
  const tally = tallyRows(tables, slug);
  const total =
    tally.matched.length + tally.legacyRows + tally.nonEndpointRows + tally.malformed.length;
  if (total > 1) {
    throw new UsageError(
      `slug ${slug} の行が ${total} 件ある（slug はインベントリ全体で一意。どちらが正かを決めるまで判定しない）`,
    );
  }
  if (tally.matched.length === 0) throwNoRow(tally, { slug, tables, strayRows });
  const row = tally.matched[0];
  assertEndpointCell(row, slug);
  return row;
}

/**
 * @typedef {{ declared: Set<string>, legacyArtifact: boolean, invalidEndpoints: number, invalidEntries: number, emptyEndpoints: number }} Declaration
 */

/**
 * 宣言を 1 つも持たない結果を作る。
 * @param {boolean} legacyArtifact
 * @returns {Declaration}
 */
function emptyDeclaration(legacyArtifact) {
  return {
    declared: new Set(),
    legacyArtifact,
    invalidEndpoints: 0,
    invalidEntries: 0,
    emptyEndpoints: 0,
  };
}

/**
 * unmeasured.entries を宣言として数える。数えない要素は理由の別に件数を残す。
 * @param {unknown[]} entries
 * @returns {Declaration}
 */
function countDeclaredEntries(entries) {
  /** @type {Set<string>} */
  const declared = new Set();
  // 型が違う endpoint は宣言に数えないが、警告なしに捨てない。`artifact-health-check.mjs` は
  // このキーを検査しないので、捨てた件数を出さないと「宣言したのに未宣言と言われる」が読めない。
  let invalidEndpoints = 0;
  // 捨てる理由は 3 つあり、症状（exit 1・未宣言扱い）は同じ。種別を分けて数えないと
  // 「宣言したのに未宣言と言われる」の切り分け材料が出ない。
  let invalidEntries = 0;
  let emptyEndpoints = 0;
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null || isArray(entry)) {
      invalidEntries += 1;
      continue;
    }
    const endpoint = "endpoint" in entry ? entry.endpoint : undefined;
    if (endpoint === undefined || endpoint === null) continue;
    if (typeof endpoint !== "string") {
      invalidEndpoints += 1;
      continue;
    }
    const normalized = collapse(endpoint);
    if (normalized.length === 0) {
      emptyEndpoints += 1;
      continue;
    }
    declared.add(normalized);
  }
  return { declared, legacyArtifact: false, invalidEndpoints, invalidEntries, emptyEndpoints };
}

/**
 * parity-suite の metadata.json から宣言済みの口を取り出す。
 * @param {string} text
 * @param {string} path
 * @returns {Declaration}
 */
export function readDeclaredEndpoints(text, path) {
  const parsed = parseJsonOrThrow(
    text,
    (message) => new UsageError(`${path} を JSON として読めない: ${message}`),
  );
  // 配列も typeof が "object" なので、別に拒否する。通すと unmeasured が無いとして旧成果物に数えてしまう。
  if (!isPlainObject(parsed)) {
    throw new UsageError(`${path} が object でない（${valueKind(parsed)}）`);
  }
  const unmeasured = "unmeasured" in parsed ? parsed.unmeasured : undefined;
  // 宣言の置き場所そのものが無い成果物なので、未確認の口は 1 つも宣言されていない。
  // 判定不能（exit 3）として扱うと、消費する側が完了を止めず、推定の口が残ったまま通過する。
  // 「判定できない」ではなく「宣言ゼロ」が事実なので、未宣言として数える。
  if (unmeasured === undefined) return emptyDeclaration(true);
  if (!isPlainObject(unmeasured)) {
    throw new UsageError(`${path} の unmeasured が object でない（${valueKind(unmeasured)}）`);
  }
  // declared の扱いは parity-suite の artifact-health-check.mjs と揃える。向こうは
  // declared: false で節ごと判定せず entries の妥当性も見ない。ここだけが entries を
  // 宣言として数えると、「誰も確かめていない宣言」で合格と判定されてしまう。
  const declaredFlag = "declared" in unmeasured ? unmeasured.declared : undefined;
  if (typeof declaredFlag !== "boolean") {
    throw new UsageError(
      `${path} の unmeasured.declared が真偽値でない（parity-suite の成果物として不備）`,
    );
  }
  if (!declaredFlag) return emptyDeclaration(false);
  const entries = "entries" in unmeasured ? unmeasured.entries : undefined;
  if (entries === undefined) return emptyDeclaration(false);
  if (!isArray(entries)) {
    throw new UsageError(`${path} の unmeasured.entries が配列でない（${valueKind(entries)}）`);
  }
  return countDeclaredEntries(entries);
}

/**
 * 根拠エントリを API 列の口へ対応づける。対応づかないエントリは notes に残す。
 * @param {EvidenceRow} row
 * @param {string[]} notes
 * @returns {Map<string, Set<string>>} 口 → 対応づいた根拠の語彙
 */
function mapVerdicts(row, notes) {
  /** @type {Map<string, Set<string>>} */
  const verdicts = new Map();
  for (const endpoint of row.endpoints) verdicts.set(endpoint, new Set());
  for (const entry of row.entries) {
    const unmatched = entry.endpoints.filter((endpoint) => !verdicts.has(endpoint));
    for (const endpoint of unmatched) {
      notes.push(
        `根拠エントリの口 ${endpoint} は API 列に無い（対応づかないエントリ）: ${entry.raw}`,
      );
    }
    if (entry.endpoints.length === 0) {
      notes.push(`口を名指ししていない根拠エントリ（対応づかない）: ${entry.raw}`);
    }
    for (const endpoint of entry.endpoints) {
      const bucket = verdicts.get(endpoint);
      if (bucket !== undefined) bucket.add(entry.verdict);
    }
  }
  return verdicts;
}

/**
 * 宣言を読んだ結果のうち、宣言に数えなかったものを notes に残す。
 * @param {Declaration | null} declaration
 * @param {string | null | undefined} unmeasuredPath
 * @param {string[]} notes
 */
function noteDeclarationIssues(declaration, unmeasuredPath, notes) {
  if (declaration !== null && declaration.legacyArtifact) {
    notes.push(
      `${unmeasuredPath} に unmeasured キーが無い（列の導入前の parity-suite 成果物）。宣言ゼロとして数える`,
    );
  }
  /** @type {[number, string][]} */
  const discarded = [
    [declaration?.invalidEndpoints ?? 0, "endpoint が文字列でない要素"],
    [declaration?.invalidEntries ?? 0, "オブジェクトでない要素"],
    [declaration?.emptyEndpoints ?? 0, "endpoint が空文字の要素"],
  ];
  for (const [count, label] of discarded) {
    if (count > 0) {
      notes.push(`unmeasured.entries の${label}が ${count} 件あるが、宣言に数えていない`);
    }
  }
}

/**
 * 実測でない口について、未確認とする理由を返す。
 * @param {Set<string>} bucket
 * @returns {string}
 */
function unresolvedReason(bucket) {
  if (bucket.size === 0) return "根拠のエントリが対応づかない";
  if (bucket.has(MEASURED) && bucket.has(ESTIMATED)) return "実測と推定の両方が対応づく（矛盾）";
  if (bucket.has(ESTIMATED)) return "根拠が推定";
  return "根拠の語彙が実測でも推定でもない";
}

/**
 * 口に対応づく根拠が実測だけか。
 * @param {Map<string, Set<string>>} verdicts
 * @param {string} endpoint
 * @returns {boolean}
 */
function isMeasured(verdicts, endpoint) {
  const bucket = verdicts.get(endpoint);
  return bucket !== undefined && bucket.size === 1 && bucket.has(MEASURED);
}

/**
 * 口ごとに実測か未確認かを判定し、未確認の口は宣言の有無で notes か findings に振り分ける。
 * @param {{ endpoints: string[], verdicts: Map<string, Set<string>>, declared: Set<string> | null, notes: string[] }} options
 * @returns {{ findings: string[], measured: number, unresolved: number, declaredCount: number }}
 */
function judgeEndpoints({ endpoints, verdicts, declared, notes }) {
  /** @type {string[]} */
  const findings = [];
  let measured = 0;
  let unresolved = 0;
  let declaredCount = 0;
  for (const endpoint of endpoints) {
    if (isMeasured(verdicts, endpoint)) {
      measured += 1;
      continue;
    }
    const reason = unresolvedReason(verdicts.get(endpoint) ?? new Set());
    unresolved += 1;
    if (declared !== null && declared.has(endpoint)) {
      declaredCount += 1;
      notes.push(`未確認の口 ${endpoint}（${reason}）は unmeasured に宣言済み`);
      continue;
    }
    findings.push(`未確認の口 ${endpoint}（${reason}）が unmeasured にも宣言されていない`);
  }
  return { findings, measured, unresolved, declaredCount };
}

/**
 * 判定する。
 * @param {{ featuresText: string, slug: string, unmeasuredPath?: string | null }} input
 * @returns {{ findings: string[], notes: string[], counts: Record<string, number> }}
 */
export function check(input) {
  // 行の分類を先に済ませる。`--unmeasured` を先に読むと、metadata.json が未生成の
  // バッチ slug が対象外（exit 4）ではなく ENOENT（exit 2）になり、
  // 「インベントリを直す」という誤った直し方へ案内してしまう。
  const row = readRow(input.featuresText, input.slug);
  /** @type {string[]} */
  const notes = [];
  const verdicts = mapVerdicts(row, notes);

  // 未確認の口が 1 つも無いなら宣言は判定に寄与しないので読まない。旧成果物
  // （unmeasured キーが無い）でも全て `実測` の行は exit 0 にする。判定不能が
  // 日常化すると、消費する側が exit 3 を無視する運用になってしまう。
  const hasUnresolved = row.endpoints.some((endpoint) => !isMeasured(verdicts, endpoint));
  const declaration =
    !hasUnresolved || input.unmeasuredPath === undefined || input.unmeasuredPath === null
      ? null
      : readDeclaredEndpoints(readFileSync(input.unmeasuredPath, "utf8"), input.unmeasuredPath);
  const declared = declaration === null ? null : declaration.declared;
  noteDeclarationIssues(declaration, input.unmeasuredPath, notes);

  const { findings, measured, unresolved, declaredCount } = judgeEndpoints({
    endpoints: row.endpoints,
    verdicts,
    declared,
    notes,
  });
  return {
    findings,
    notes,
    counts: {
      endpoints: row.endpoints.length,
      measured,
      unresolved,
      declared: declaredCount,
      missing: findings.length,
    },
  };
}

/**
 * @param {string[]} argv
 * @returns {{ features: string, slug: string, unmeasured: string | null }}
 */
export function parseArgs(argv) {
  const parsed = parseFlags(argv, { values: ["--features", "--slug", "--unmeasured"] });
  if (parsed.error !== undefined) throw new UsageError(parsed.error);
  const { strings } = parsed;
  const features = strings["--features"];
  const slug = strings["--slug"];
  const unmeasured = strings["--unmeasured"];
  if (!features) throw new UsageError("--features は必須（探索先を推測させない）");
  if (!slug) throw new UsageError("--slug は必須（対象を推測させない）");
  return {
    features: resolve(features),
    slug: collapse(slug),
    unmeasured: unmeasured === undefined ? null : resolve(unmeasured),
  };
}

/** 使い方（stderr に出す）。 */
const usage = [
  "usage: evidence-gap-check.mjs --features <features.md> --slug <slug> [--unmeasured <parity metadata.json>]",
  "  --features    .replace/features.md のパス（必須）",
  "  --slug        対象の slug（必須。機能一覧・横断 API 表のどちらでもよい）",
  "  --unmeasured  .replace/parity/<slug>/metadata.json（省略すると宣言を考慮せず、未確認の口があれば落とす）",
  "exit: 0 = 未確認の口が無い、または全て unmeasured に宣言済み / 1 = 宣言の無い未確認の口がある（書き戻しか宣言の抜け）",
  "      2 = 使い方の誤り・入力の不備 / 3 = 判定不能（根拠列が無い。unmeasured キーが無い成果物は宣言ゼロとして数える）",
  "      4 = 対象外（口を持たない表の行＝バッチ・その他の Issue。検査対象が無い）",
].join("\n");

/**
 * main で捕まえた例外を stderr に出し、終了コードを返す。
 * @param {unknown} e
 * @returns {number}
 */
function reportError(e) {
  if (e instanceof NotApplicableError) {
    process.stderr.write(`not-applicable: ${e.message}\n`);
    return 4;
  }
  if (e instanceof UndecidableError) {
    process.stderr.write(`undecidable: ${e.message}\n`);
    return 3;
  }
  if (e instanceof UsageError) {
    process.stderr.write(`error: ${e.message}\n${usage}\n`);
    return 2;
  }
  // 読めない入力（ENOENT だけでなく EISDIR / EACCES 等）は入力の不備。
  // 投げ直すと未捕捉例外の exit 1 になり、「宣言の無い未確認の口がある」と同じ終了コードになってしまう。
  if (e instanceof Error && "code" in e && typeof e.code === "string") {
    process.stderr.write(`error: ${e.message}\n${usage}\n`);
    return 2;
  }
  // errno を持たない想定外の例外も同じ理由で exit 2（判定していない）として扱う。
  // 投げ直すと Node の未捕捉例外が exit 1 になり、消費側が「書き戻しの抜けがある」と読んで
  // 存在しない口を探すことになる。原因を追えるようスタックはそのまま出す。
  const detail = e instanceof Error ? (e.stack ?? e.message) : String(e);
  process.stderr.write(`error: 判定できない例外で終了した: ${detail}\n${usage}\n`);
  return 2;
}

/**
 * @param {string[]} argv
 * @returns {number}
 */
export function main(argv) {
  try {
    const args = parseArgs(argv);
    const featuresText = readFileSync(args.features, "utf8");
    const { findings, notes, counts } = check({
      featuresText,
      slug: args.slug,
      unmeasuredPath: args.unmeasured,
    });
    for (const note of notes) process.stdout.write(`note: ${note}\n`);
    for (const finding of findings) process.stdout.write(`warn: ${finding}\n`);
    process.stdout.write(
      `measured: 口 ${counts.endpoints} 件（実測 ${counts.measured} / 未確認 ${counts.unresolved}` +
        `〈宣言済み ${counts.declared} / 未宣言 ${counts.missing}〉）\n`,
    );
    if (findings.length > 0) {
      process.stdout.write(
        `error: 未確認のまま宣言もされていない口が ${findings.length} 件ある — replace-strategy evidence で書き戻すか、parity-suite の unmeasured へ宣言する\n`,
      );
      return 1;
    }
    process.stdout.write(`ok: 書き戻しの抜けは無い（evidence-gap-check ${VERSION}）\n`);
    return 0;
  } catch (e) {
    return reportError(e);
  }
}

if (isCliEntry(import.meta.url)) {
  // process.exit は書き込み中の stdout を捨てるため、終了コードだけ設定して自然終了させる
  // （判定の根拠は measured: 行なので、パイプ出力で欠けると判定そのものが読めなくなる）。
  process.exitCode = main(process.argv.slice(2));
}
