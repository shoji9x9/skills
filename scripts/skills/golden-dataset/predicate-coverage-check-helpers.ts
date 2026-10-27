// predicate-coverage-check.test.ts のヘルパー。
import { parseJsonAs } from "../../lib/parse-as.ts";
import {
  main,
  checkPredicateCoverage,
} from "../../../skills/golden-dataset/scripts/predicate-coverage-check.mjs";

/** 欠陥の無い features.md（3 表とも在り、参照テーブルが埋まっている）。 */
export const FEATURES = `# 機能インベントリ（features）

## 機能一覧

| slug | 機能名 | テーブル | Issue |
|---|---|---|---|
| order | 注文管理 | orders, order_items | 未起票 |
| report | レポート | reports | 未起票 |

## 横断 API（リソース単位）

| slug | リソース | fan-out（利用機能 slug） | 参照テーブル | Issue |
|---|---|---|---|---|
| user | ユーザー | order, report | users, roles | 未起票 |

## バッチ

| slug | バッチ名 | 入力 | 参照テーブル | Issue |
|---|---|---|---|---|
| monthly-summary | 月次集計 | ゴールデンデータセット | orders | 未起票 |
`;

// designOf が、差し替えを渡されなかった表に使う欠陥の無い行。
const DEFAULT_TARGETS = [
  "| orders | order, monthly-summary | 41 | 投入する | FK 親 |",
  "| order_items | order | 80 | 投入する | orders の子 |",
  "| reports | report | 6 | 投入する | - |",
  "| users | user | 4 | 投入する | - |",
  "| roles | user | 3 | 投入する | - |",
];
const DEFAULT_PREDICATES = [
  "| orders-status | orders | order | status = 'shipped' | 画面の入力値（変換なし） | 3 | 38 | 踏める | - | /orders の SELECT を読了 |",
  "| orders-month | orders | monthly-summary | ordered_at の月境界 | 画面の入力値（変換なし） | 12 | 29 | 踏める | - | バッチの入力条件 |",
  "| items-order | order_items | order | order_id = :id | 画面の入力値（変換なし） | 4 | 76 | 踏める | - | 明細の絞り込み |",
  "| reports-owner | reports | report | owner_id = :me | 画面の入力値（変換なし） | 2 | 4 | 踏める | - | 一覧の所有者条件 |",
  "| users-active | users | user | active = true | 画面の入力値（変換なし） | 3 | 1 | 踏める | - | 共通ヘッダの利用者 |",
  "| roles-admin | roles | user | role = 'admin' | 画面の入力値（変換なし） | 1 | 2 | 踏める | - | ロール表示 |",
];
const DEFAULT_PARAMS = [
  "| order | orders | status | ordered_at DESC | 20 | 実測 |",
  "| order | order_items | order_id | id ASC | - | 実測 |",
  "| report | reports | owner_id | created_at DESC | 20 | 実測 |",
  "| user | users | active | id ASC | - | 実測 |",
  "| user | roles | role | id ASC | - | 実測 |",
  "| monthly-summary | orders | ordered_at | - | - | 実測 |",
];
const DEFAULT_ID_RANGES = [
  "| orders | id | 900000000001〜900000000041（12 桁） | 1〜99999999（8 桁・BIGINT） | order, monthly-summary | 文字列のまま SQL のパラメータへ渡す（変換なし） | 届く | - | /orders の詳細と月次集計の入力を読了 |",
  "| order_items | order_id | orders の帯と同じ | orders.id と同じ | order | - | 届く | - | 明細は親の id を文字列で受け取る |",
  "| reports | id | 900001〜900006 | 1〜99999 | report | - | 届く | - | 一覧は id を受け取らない |",
  "| users | id | 9001〜9004 | 1〜999 | user | int.Parse（32 ビット） | 届く | - | 共通ヘッダの利用者 |",
  "| roles | id | 91〜93 | 1〜9 | user | - | 届く | - | ロールは名前で引く |",
];

/** 識別子の値の範囲の節。null は「表そのものが無い」（旧版テンプレートで作った design.md）。 */
function idRangeSectionOf(idRanges: string[] | null) {
  return idRanges === null
    ? ""
    : `
## 識別子の値の範囲

| テーブル | 列 | データセットの値の範囲 | 実運用の値の範囲 | 消費側 slug | 受け取る型・変換 | 届くか | 扱い | 根拠 |
|---|---|---|---|---|---|---|---|---|
${idRanges.join("\n")}
`;
}

/**
 * 欠陥の無い design.md を組み立てる。差し替えたい行だけを渡す。
 * @param {{ targets?: string[], predicates?: string[], params?: string[], idRanges?: string[] | null }} [override]
 */
export function designOf(
  override: {
    targets?: string[];
    predicates?: string[];
    params?: string[];
    idRanges?: string[] | null;
  } = {},
) {
  const targets = override.targets ?? DEFAULT_TARGETS;
  const predicates = override.predicates ?? DEFAULT_PREDICATES;
  const params = override.params ?? DEFAULT_PARAMS;
  const idRangeSection = idRangeSectionOf(
    override.idRanges === undefined ? DEFAULT_ID_RANGES : override.idRanges,
  );
  return `# データ設計（design）

## 対象テーブル

| テーブル | features.md の機能／リソース | 件数 | 役割 | 備考（FK 親・必須項目） |
|---|---|---|---|---|
${targets.join("\n")}

## 消費側パラメータ

| 機能／リソース slug | テーブル | 絞り込み列・条件 | 並び替え列・方向・同値順 | ページサイズ／切替候補 | 根拠 |
|---|---|---|---|---|---|
${params.join("\n")}

## 述語ごとの分岐網羅

| 述語 id | テーブル | 消費側 slug | 述語（列・条件） | 値の出どころ | 真の行数 | 偽の行数 | 判定 | 扱い | 根拠 |
|---|---|---|---|---|---:|---:|---|---|---|
${predicates.join("\n")}
${idRangeSection}`;
}

/** main が出す JSON の、テストで確かめる欄。 */
type CheckOutput = {
  ok: boolean;
  structural?: boolean;
  findings: { code: string; message: string }[];
};

/**
 * main をメモリ上のファイルで回す。
 * @param {string[]} argv
 * @param {Record<string, string>} files
 */
export function run(argv: string[], files: Record<string, string>) {
  let output = "";
  let errorOutput = "";
  const code = main(argv, {
    cwd: "/w",
    readFile: (path) => {
      if (!(path in files)) throw new Error("ENOENT");
      return files[path];
    },
    write: (s) => {
      output += s;
    },
    writeErr: (s) => {
      errorOutput += s;
    },
  });
  return {
    code,
    stderr: errorOutput,
    result: output === "" ? null : parseJsonAs<CheckOutput>(output),
  };
}

/**
 * 既定の入力で検査し、findings の code 一覧を返す。
 * @param {{ features?: string, design?: string, verification?: string | null }} [input]
 */
export function codesOf(
  input: { features?: string; design?: string; verification?: string | null } = {},
) {
  const result = checkPredicateCoverage({
    featuresMarkdown: input.features ?? FEATURES,
    designMarkdown: input.design ?? designOf(),
    verificationMarkdown: input.verification ?? null,
  });
  return result.findings.map((f) => f.code);
}

// Issue #498: データセットが決めた識別子の値（採番帯）が消費側の変換で別の値になると、
// 述語は設計どおり真でも消費側が引く行は 0 件になる。分岐の網羅は設計者の値で数えるので「踏める」のまま残る。

/** 既定の識別子の値の範囲のうち、orders の行だけを差し替えた一覧。 */
export function idRangesWith(ordersRows: string[]) {
  return [
    ...ordersRows,
    "| order_items | order_id | orders の帯と同じ | orders.id と同じ | order | - | 届く | - | 明細は親の id を文字列で受け取る |",
    "| reports | id | 900001〜900006 | 1〜99999 | report | - | 届く | - | 一覧は id を受け取らない |",
    "| users | id | 9001〜9004 | 1〜999 | user | int.Parse（32 ビット） | 届く | - | 共通ヘッダの利用者 |",
    "| roles | id | 91〜93 | 1〜9 | user | - | 届く | - | ロールは名前で引く |",
  ];
}

/** 既定の述語に、orders.id の述語を 1 行足した一覧。 */
export function predicatesWithOrderId(row: string) {
  return [
    "| orders-status | orders | order | status = 'shipped' | 画面の入力値（変換なし） | 3 | 38 | 踏める | - | /orders の SELECT を読了 |",
    "| orders-month | orders | monthly-summary | ordered_at の月境界 | 画面の入力値（変換なし） | 12 | 29 | 踏める | - | バッチの入力条件 |",
    "| items-order | order_items | order | order_id = :id | 画面の入力値（変換なし） | 4 | 76 | 踏める | - | 明細の絞り込み |",
    "| reports-owner | reports | report | owner_id = :me | 画面の入力値（変換なし） | 2 | 4 | 踏める | - | 一覧の所有者条件 |",
    "| users-active | users | user | active = true | 画面の入力値（変換なし） | 3 | 1 | 踏める | - | 共通ヘッダの利用者 |",
    "| roles-admin | roles | user | role = 'admin' | 画面の入力値（変換なし） | 1 | 2 | 踏める | - | ロール表示 |",
    row,
  ];
}
