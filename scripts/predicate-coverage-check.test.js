// golden-dataset の参照表の役割・行数の検査（predicate-coverage-check.mjs）の回帰テスト（Issue #388）。
//
// 設計の段で「入れたもので消費側のどの分岐が踏めるか」を数えていないと、
// 踏めない分岐は下流がベースラインを採り終えてから見つかり、行を足すと採取物が陳腐化する。
//
// 陽性コントロール（欠陥の無い設計が exit 0）を置く——これが無いと「常に落とす」実装と区別できない。
// 欠陥は 1 件ずつ独立に注入し、注入した欠陥の code が出ることまで確かめる（件数が非ゼロなだけでは検出能力の証拠にならない）。

import { test, expect } from "vitest";
import {
  main,
  parseTables,
  splitList,
  collectConsumers,
  checkPredicateCoverage,
  filterColumn,
} from "../skills/golden-dataset/scripts/predicate-coverage-check.mjs";

/** 欠陥の無い features.md（3 表とも在り、参照テーブルが埋まっている）。 */
const FEATURES = `# 機能インベントリ（features）

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

/**
 * 欠陥の無い design.md を組み立てる。差し替えたい行だけを渡す。
 * @param {{ targets?: string[], predicates?: string[], params?: string[], idRanges?: string[] | null }} [override]
 */
function designOf(override = {}) {
  const targets = override.targets ?? [
    "| orders | order, monthly-summary | 41 | 投入する | FK 親 |",
    "| order_items | order | 80 | 投入する | orders の子 |",
    "| reports | report | 6 | 投入する | - |",
    "| users | user | 4 | 投入する | - |",
    "| roles | user | 3 | 投入する | - |",
  ];
  const predicates = override.predicates ?? [
    "| orders-status | orders | order | status = 'shipped' | 画面の入力値（変換なし） | 3 | 38 | 踏める | - | /orders の SELECT を読了 |",
    "| orders-month | orders | monthly-summary | ordered_at の月境界 | 画面の入力値（変換なし） | 12 | 29 | 踏める | - | バッチの入力条件 |",
    "| items-order | order_items | order | order_id = :id | 画面の入力値（変換なし） | 4 | 76 | 踏める | - | 明細の絞り込み |",
    "| reports-owner | reports | report | owner_id = :me | 画面の入力値（変換なし） | 2 | 4 | 踏める | - | 一覧の所有者条件 |",
    "| users-active | users | user | active = true | 画面の入力値（変換なし） | 3 | 1 | 踏める | - | 共通ヘッダの利用者 |",
    "| roles-admin | roles | user | role = 'admin' | 画面の入力値（変換なし） | 1 | 2 | 踏める | - | ロール表示 |",
  ];
  const params = override.params ?? [
    "| order | orders | status | ordered_at DESC | 20 | 実測 |",
    "| order | order_items | order_id | id ASC | - | 実測 |",
    "| report | reports | owner_id | created_at DESC | 20 | 実測 |",
    "| user | users | active | id ASC | - | 実測 |",
    "| user | roles | role | id ASC | - | 実測 |",
    "| monthly-summary | orders | ordered_at | - | - | 実測 |",
  ];
  // null は「表そのものが無い」（旧版テンプレートで作った design.md）。
  const idRanges =
    override.idRanges === undefined
      ? [
          "| orders | id | 900000000001〜900000000041（12 桁） | 1〜99999999（8 桁・BIGINT） | order, monthly-summary | 文字列のまま SQL のパラメータへ渡す（変換なし） | 届く | - | /orders の詳細と月次集計の入力を読了 |",
          "| order_items | order_id | orders の帯と同じ | orders.id と同じ | order | - | 届く | - | 明細は親の id を文字列で受け取る |",
          "| reports | id | 900001〜900006 | 1〜99999 | report | - | 届く | - | 一覧は id を受け取らない |",
          "| users | id | 9001〜9004 | 1〜999 | user | int.Parse（32 ビット） | 届く | - | 共通ヘッダの利用者 |",
          "| roles | id | 91〜93 | 1〜9 | user | - | 届く | - | ロールは名前で引く |",
        ]
      : override.idRanges;
  const idRangeSection =
    idRanges === null
      ? ""
      : `
## 識別子の値の範囲

| テーブル | 列 | データセットの値の範囲 | 実運用の値の範囲 | 消費側 slug | 受け取る型・変換 | 届くか | 扱い | 根拠 |
|---|---|---|---|---|---|---|---|---|
${idRanges.join("\n")}
`;
  return `# データ設計（design）

## 対象テーブル

| テーブル | features.md の機能／リソース | 件数 | 役割 | 備考（FK 親・必須項目） |
|---|---|---|---|---|
${targets.join("\n")}

## 消費側パラメータ

| 機能／リソース slug | テーブル | 絞り込み列・条件 | 並び替え列・方向・同値順 | ページサイズ／切替候補 | 根拠 |
|---|---|---|---|---|---|
${params.join("\n")}

## 述語ごとの分岐被覆

| 述語 id | テーブル | 消費側 slug | 述語（列・条件） | 値の出どころ | 真の行数 | 偽の行数 | 判定 | 扱い | 根拠 |
|---|---|---|---|---|---:|---:|---|---|---|
${predicates.join("\n")}
${idRangeSection}`;
}

/** 欠陥の無い verification.md（設計値と一致する実測）。 */
const VERIFICATION = `# 検証レポート（verification）

## フェーズ A（現行フェーズ）

### 述語ごとの該当行数

| 述語 id | 真の実測行数 | 偽の実測行数 | 判定 | 数えたクエリ／観測 |
|---|---:|---:|---|---|
| orders-status | 3 | 38 | 踏める | count(*) |
| orders-month | 12 | 29 | 踏める | count(*) |
| items-order | 4 | 76 | 踏める | count(*) |
| reports-owner | 2 | 4 | 踏める | count(*) |
| users-active | 3 | 1 | 踏める | count(*) |
| roles-admin | 1 | 2 | 踏める | count(*) |
`;

/**
 * main をメモリ上のファイルで回す。
 * @param {string[]} argv
 * @param {Record<string, string>} files
 */
function run(argv, files) {
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
  return { code, stderr: errorOutput, result: output === "" ? null : JSON.parse(output) };
}

/**
 * 既定の入力で検査し、findings の code 一覧を返す。
 * @param {{ features?: string, design?: string, verification?: string | null }} [input]
 */
function codesOf(input = {}) {
  const result = checkPredicateCoverage({
    featuresMarkdown: input.features ?? FEATURES,
    designMarkdown: input.design ?? designOf(),
    verificationMarkdown: input.verification ?? null,
  });
  return result.findings.map((f) => f.code);
}

test("表のパーサは見出しごとに表を拾い、区切り行の無い塊を表にしない", () => {
  const tables = parseTables("## 見出し\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n| x |\n| y |\n");
  expect(tables).toHaveLength(1);
  expect(tables[0].heading).toBe("見出し");
  expect(tables[0].headers).toEqual(["a", "b"]);
  expect(tables[0].rows).toEqual([["1", "2"]]);
});

test("一覧セルは空欄（未調査）と `-`（ゼロ件）を書き分ける", () => {
  expect(splitList("").kind).toBe("blank");
  expect(splitList("-").kind).toBe("none");
  expect(splitList("orders, order_items").items).toEqual(["orders", "order_items"]);
});

test("区切りは引用符・括弧の外だけで効く（条件の中のカンマで割らない）", () => {
  expect(splitList("status IN ('pending','canceled')").items).toEqual([
    "status IN ('pending','canceled')",
  ]);
  expect(splitList("COALESCE(owner_id, assignee_id) = :me").items).toEqual([
    "COALESCE(owner_id, assignee_id) = :me",
  ]);
  expect(splitList("status, owner_id").items).toEqual(["status", "owner_id"]);
});

test("条件の中にカンマがある絞り込みでも、述語行があれば通る", () => {
  const codes = codesOf({
    design: designOf({
      params: [
        "| order | orders | status IN ('pending','canceled') | ordered_at DESC | 20 | 実測 |",
        "| order | order_items | order_id | id ASC | - | 実測 |",
        "| report | reports | owner_id | created_at DESC | 20 | 実測 |",
        "| user | users | active | id ASC | - | 実測 |",
        "| user | roles | role | id ASC | - | 実測 |",
        "| monthly-summary | orders | ordered_at | - | - | 実測 |",
      ],
    }),
  });
  expect(codes).toEqual([]);
});

test("エスケープされたパイプはセルの区切りにしない（列がずれて無関係な finding になる）", () => {
  const tables = parseTables("## 見出し\n\n| a | b |\n|---|---|\n| status = 'x\\|y' | 2 |\n");
  expect(tables[0].rows).toEqual([["status = 'x|y'", "2"]]);
});

test("features.md の (slug, テーブル) に消費側パラメータの行が無ければ落ちる", () => {
  // 行が無いとループが 0 回になり、「絞り込みを調べていない」が「絞り込みが無い」に見える。
  const codes = codesOf({
    design: designOf({
      params: [
        "| order | order_items | order_id | id ASC | - | 実測 |",
        "| report | reports | owner_id | created_at DESC | 20 | 実測 |",
        "| user | users | active | id ASC | - | 実測 |",
        "| user | roles | role | id ASC | - | 実測 |",
        "| monthly-summary | orders | ordered_at | - | - | 実測 |",
      ],
    }),
  });
  expect(codes).toContain("param-row-missing");

  // 調べた結果として `-` を書いた行があれば通る（行そのものは要る）。
  const withSentinel = codesOf({
    design: designOf({
      params: [
        "| order | orders | - | ordered_at DESC | 20 | 実測 |",
        "| order | order_items | order_id | id ASC | - | 実測 |",
        "| report | reports | owner_id | created_at DESC | 20 | 実測 |",
        "| user | users | active | id ASC | - | 実測 |",
        "| user | roles | role | id ASC | - | 実測 |",
        "| monthly-summary | orders | ordered_at | - | - | 実測 |",
      ],
    }),
  });
  expect(withSentinel).not.toContain("param-row-missing");
});

test("消費側は 3 表すべてから集める（1 表しか読まないと写し漏れを検出できない）", () => {
  const { consumers, structural } = collectConsumers(FEATURES);
  expect(structural).toBe(false);
  expect([...consumers.get("orders")].sort()).toEqual(["monthly-summary", "order"]);
  expect([...consumers.get("roles")]).toEqual(["user"]);
});

test("陽性コントロール: 欠陥の無い設計は exit 0（常に落とす実装ではない）", () => {
  const { code, result } = run(["--features", "f.md", "--design", "d.md"], {
    "/w/f.md": FEATURES,
    "/w/d.md": designOf(),
  });
  expect(result.findings).toEqual([]);
  expect(result.ok).toBe(true);
  expect(code).toBe(0);
});

test("陽性コントロール: 実測が設計と一致する verification も exit 0", () => {
  const { code, result } = run(
    ["--features", "f.md", "--design", "d.md", "--verification", "v.md"],
    { "/w/f.md": FEATURES, "/w/d.md": designOf(), "/w/v.md": VERIFICATION },
  );
  expect(result.findings).toEqual([]);
  expect(code).toBe(0);
});

test("空の verification は「渡していない」に丸めない（検査ごと飛ばさない）", () => {
  // 空に丸めると、verification.md を空で作った実行が「実測して問題なし」と同じ出力になる。
  expect(
    checkPredicateCoverage({
      featuresMarkdown: FEATURES,
      designMarkdown: designOf(),
      verificationMarkdown: "",
    }).findings.map((f) => f.code),
  ).toContain("verification-table-missing");
  // 渡していない場合は 6 節に入らない（陰性コントロール。空とは書き分ける）。
  expect(codesOf()).not.toContain("verification-table-missing");
  // CLI 側でも、空の値を未指定へ丸めず使い方の誤りとして落とす
  // （読める空ファイルを置いて、ENOENT ではなく空の値そのもので落ちることを見る）。
  expect(
    run(["--features", "f.md", "--design", "d.md", "--verification", " "], {
      "/w/f.md": FEATURES,
      "/w/d.md": designOf(),
      "/w/ ": "",
    }).code,
  ).toBe(2);
});

test("写しが 1 slug 落ちると落ちる（役割が「読み取りだけ」へ倒れる前に拾う）", () => {
  const codes = codesOf({
    design: designOf({
      targets: [
        "| orders | order | 41 | 投入する | FK 親 |",
        "| order_items | order | 80 | 投入する | orders の子 |",
        "| reports | report | 6 | 投入する | - |",
        "| users | user | 4 | 投入する | - |",
        "| roles | user | 3 | 投入する | - |",
      ],
    }),
  });
  expect(codes).toContain("copy-missing-slug");
});

test("写しに行ごと無いテーブルは写し漏れとして落ちる", () => {
  const codes = codesOf({
    design: designOf({
      targets: [
        "| orders | order, monthly-summary | 41 | 投入する | FK 親 |",
        "| order_items | order | 80 | 投入する | orders の子 |",
        "| reports | report | 6 | 投入する | - |",
        "| users | user | 4 | 投入する | - |",
      ],
    }),
  });
  expect(codes).toContain("copy-missing-table");
});

test("消費側が在るのに「読み取りだけ」は落ちる（引き方ではなく消費で決める）", () => {
  const codes = codesOf({
    design: designOf({
      targets: [
        "| orders | order, monthly-summary | 41 | 投入する | FK 親 |",
        "| order_items | order | 80 | 投入する | orders の子 |",
        "| reports | report | 6 | 投入する | - |",
        "| users | user | 4 | 投入する | - |",
        "| roles | user | 3 | 読み取りだけ | FROM の母集合として引くだけ |",
      ],
    }),
  });
  expect(codes).toContain("role-contradicts-consumers");
});

test("FK を満たすためだけに要る親表は「FK 親のみ」で通り、0 件だけ落ちる", () => {
  // features.md のどの表からも参照されないが、orders の FK を満たすために投入が要る親表。
  // 「投入する」だと消費側が居ないと言われ、「読み取りだけ」だと投入対象から外れる——どちらも事実と違う。
  const targetsWith = (customers) => [
    "| orders | order, monthly-summary | 41 | 投入する | customers の子 |",
    "| order_items | order | 80 | 投入する | orders の子 |",
    "| reports | report | 6 | 投入する | - |",
    "| users | user | 4 | 投入する | - |",
    "| roles | user | 3 | 投入する | - |",
    customers,
  ];
  expect(
    codesOf({
      design: designOf({ targets: targetsWith("| customers | - | 5 | FK 親のみ | orders の親 |") }),
    }),
  ).toEqual([]);
  expect(
    codesOf({
      design: designOf({ targets: targetsWith("| customers | - | 0 | FK 親のみ | orders の親 |") }),
    }),
  ).toContain("fk-parent-empty");
  expect(
    codesOf({
      design: designOf({ targets: targetsWith("| customers | - | 5 | 投入する | orders の親 |") }),
    }),
  ).toContain("role-without-consumer");
});

test("消費側が在るのに「FK 親のみ」は落ちる（直接読まれる表は投入する）", () => {
  const codes = codesOf({
    design: designOf({
      targets: [
        "| orders | order, monthly-summary | 41 | 投入する | FK 親 |",
        "| order_items | order | 80 | 投入する | orders の子 |",
        "| reports | report | 6 | 投入する | - |",
        "| users | user | 4 | 投入する | - |",
        "| roles | user | 3 | FK 親のみ | 直接は読まないつもりだった |",
      ],
    }),
  });
  expect(codes).toContain("fk-parent-has-consumer");
});

test("features.md の参照テーブルが空欄なら合格に倒さない", () => {
  const codes = codesOf({
    features: FEATURES.replace(
      "| user | ユーザー | order, report | users, roles |",
      "| user | ユーザー | order, report |  |",
    ),
  });
  expect(codes).toContain("features-reference-blank");
});

test("1 件の参照表は、扱いを決めていなければ落ちる（絞り込みの効きを観測できない）", () => {
  const codes = codesOf({
    design: designOf({
      targets: [
        "| orders | order, monthly-summary | 41 | 投入する | FK 親 |",
        "| order_items | order | 80 | 投入する | orders の子 |",
        "| reports | report | 6 | 投入する | - |",
        "| users | user | 4 | 投入する | - |",
        "| roles | user | 1 | 投入する | - |",
      ],
    }),
  });
  expect(codes).toContain("table-row-count-unusable");
});

test("0 件の側を持つ述語は「踏めない」判定と扱いを求める", () => {
  const codes = codesOf({
    design: designOf({
      predicates: [
        "| orders-status | orders | order | status = 'shipped' | 画面の入力値（変換なし） | 3 | 38 | 踏める | - | 読了 |",
        "| orders-month | orders | monthly-summary | 月境界 | 画面の入力値（変換なし） | 12 | 29 | 踏める | - | 読了 |",
        "| items-order | order_items | order | order_id = :id | 画面の入力値（変換なし） | 4 | 76 | 踏める | - | 読了 |",
        "| reports-owner | reports | report | owner_id = :me | 画面の入力値（変換なし） | 2 | 4 | 踏める | - | 読了 |",
        "| users-active | users | user | active = true | 画面の入力値（変換なし） | 3 | 1 | 踏める | - | 読了 |",
        "| roles-admin | roles | user | role = 'admin' | 画面の入力値（変換なし） | 3 | 0 | 踏める | - | 読了 |",
      ],
    }),
  });
  expect(codes).toContain("predicate-verdict-mismatch");
  expect(codes).toContain("predicate-disposition-missing");
});

test("「gaps に記録」を選んだ踏めない行は根拠を空欄にできない", () => {
  const codes = codesOf({
    design: designOf({
      predicates: [
        "| orders-status | orders | order | status = 'shipped' | 画面の入力値（変換なし） | 3 | 38 | 踏める | - | 読了 |",
        "| orders-month | orders | monthly-summary | 月境界 | 画面の入力値（変換なし） | 12 | 29 | 踏める | - | 読了 |",
        "| items-order | order_items | order | order_id = :id | 画面の入力値（変換なし） | 4 | 76 | 踏める | - | 読了 |",
        "| reports-owner | reports | report | owner_id = :me | 画面の入力値（変換なし） | 2 | 4 | 踏める | - | 読了 |",
        "| users-active | users | user | active = true | 画面の入力値（変換なし） | 3 | 1 | 踏める | - | 読了 |",
        "| roles-admin | roles | user | role = 'admin' | 画面の入力値（変換なし） | 3 | 0 | 踏めない | gaps に記録 |  |",
      ],
    }),
  });
  expect(codes).toContain("predicate-gaps-reason-missing");
  expect(codes).not.toContain("predicate-disposition-missing");
});

test("絞り込みがあるのに述語行が無い消費側は落ちる（数えていない分岐は 0 件と同じ見え方）", () => {
  const codes = codesOf({
    design: designOf({
      predicates: [
        "| orders-status | orders | order | status = 'shipped' | 画面の入力値（変換なし） | 3 | 38 | 踏める | - | 読了 |",
        "| orders-month | orders | monthly-summary | 月境界 | 画面の入力値（変換なし） | 12 | 29 | 踏める | - | 読了 |",
        "| items-order | order_items | order | order_id = :id | 画面の入力値（変換なし） | 4 | 76 | 踏める | - | 読了 |",
        "| reports-owner | reports | report | owner_id = :me | 画面の入力値（変換なし） | 2 | 4 | 踏める | - | 読了 |",
        "| users-active | users | user | active = true | 画面の入力値（変換なし） | 3 | 1 | 踏める | - | 読了 |",
      ],
    }),
  });
  expect(codes).toContain("predicate-not-enumerated");
});

test("1 行に複数の絞り込みが並ぶとき、述語 1 本で全部を満たしたことにしない", () => {
  // order × orders の絞り込みを status と owner_id の 2 本にする。述語は status しか無いので、
  // owner_id の分岐は数えられていない（1 本でも述語行があれば足りる、と数えると素通りする）。
  const codes = codesOf({
    design: designOf({
      params: [
        "| order | orders | status, owner_id | ordered_at DESC | 20 | 実測 |",
        "| order | order_items | order_id | id ASC | - | 実測 |",
        "| report | reports | owner_id | created_at DESC | 20 | 実測 |",
        "| user | users | active | id ASC | - | 実測 |",
        "| user | roles | role | id ASC | - | 実測 |",
        "| monthly-summary | orders | ordered_at | - | - | 実測 |",
      ],
    }),
  });
  expect(codes).toContain("predicate-filter-not-enumerated");
  expect(codes).not.toContain("predicate-not-enumerated");
});

test("陽性コントロール: 並んだ絞り込みそれぞれに述語行があれば通る", () => {
  const codes = codesOf({
    design: designOf({
      params: [
        "| order | orders | status, owner_id | ordered_at DESC | 20 | 実測 |",
        "| order | order_items | order_id | id ASC | - | 実測 |",
        "| report | reports | owner_id | created_at DESC | 20 | 実測 |",
        "| user | users | active | id ASC | - | 実測 |",
        "| user | roles | role | id ASC | - | 実測 |",
        "| monthly-summary | orders | ordered_at | - | - | 実測 |",
      ],
      predicates: [
        "| orders-status | orders | order | status = 'shipped' | 画面の入力値（変換なし） | 3 | 38 | 踏める | - | 読了 |",
        "| orders-owner | orders | order | owner_id = :me | 画面の入力値（変換なし） | 5 | 36 | 踏める | - | 読了 |",
        "| orders-month | orders | monthly-summary | ordered_at の月境界 | 画面の入力値（変換なし） | 12 | 29 | 踏める | - | 読了 |",
        "| items-order | order_items | order | order_id = :id | 画面の入力値（変換なし） | 4 | 76 | 踏める | - | 読了 |",
        "| reports-owner | reports | report | owner_id = :me | 画面の入力値（変換なし） | 2 | 4 | 踏める | - | 読了 |",
        "| users-active | users | user | active = true | 画面の入力値（変換なし） | 3 | 1 | 踏める | - | 読了 |",
        "| roles-admin | roles | user | role = 'admin' | 画面の入力値（変換なし） | 1 | 2 | 踏める | - | 読了 |",
      ],
    }),
  });
  expect(codes).toEqual([]);
});

test("絞り込みがあるのに slug / テーブルが空の行は黙って飛ばさない", () => {
  const codes = codesOf({
    design: designOf({
      params: [
        "|  | orders | status | ordered_at DESC | 20 | 実測 |",
        "| order | orders | status | ordered_at DESC | 20 | 実測 |",
        "| order | order_items | order_id | id ASC | - | 実測 |",
        "| report | reports | owner_id | created_at DESC | 20 | 実測 |",
        "| user | users | active | id ASC | - | 実測 |",
        "| user | roles | role | id ASC | - | 実測 |",
        "| monthly-summary | orders | ordered_at | - | - | 実測 |",
      ],
    }),
  });
  expect(codes).toContain("param-row-unkeyed");
});

test("1 行の述語が 2 つの列を兼ねていたら落ちる（列ごとに別の行が要る）", () => {
  const codes = codesOf({
    design: designOf({
      params: [
        "| order | orders | status, owner_id | ordered_at DESC | 20 | 実測 |",
        "| order | order_items | order_id | id ASC | - | 実測 |",
        "| report | reports | owner_id | created_at DESC | 20 | 実測 |",
        "| user | users | active | id ASC | - | 実測 |",
        "| user | roles | role | id ASC | - | 実測 |",
        "| monthly-summary | orders | ordered_at | - | - | 実測 |",
      ],
      predicates: [
        "| orders-combined | orders | order | status = 'shipped' AND owner_id = :me | 画面の入力値（変換なし） | 3 | 38 | 踏める | - | 読了 |",
        "| orders-month | orders | monthly-summary | ordered_at の月境界 | 画面の入力値（変換なし） | 12 | 29 | 踏める | - | 読了 |",
        "| items-order | order_items | order | order_id = :id | 画面の入力値（変換なし） | 4 | 76 | 踏める | - | 読了 |",
        "| reports-owner | reports | report | owner_id = :me | 画面の入力値（変換なし） | 2 | 4 | 踏める | - | 読了 |",
        "| users-active | users | user | active = true | 画面の入力値（変換なし） | 3 | 1 | 踏める | - | 読了 |",
        "| roles-admin | roles | user | role = 'admin' | 画面の入力値（変換なし） | 1 | 2 | 踏める | - | 読了 |",
      ],
    }),
  });
  expect(codes).toContain("predicate-filter-shares-row");
});

test("1 対 1 の割り当てが存在すれば通す（先着順の貪欲だと偽陽性になる並び）", () => {
  // status は 2 行（結合条件・単独）に現れ、owner_id は結合条件の行だけに現れる。
  // 先着順だと status が結合条件の行を取り、owner_id が余らず偽陽性になる。
  const codes = codesOf({
    design: designOf({
      params: [
        "| order | orders | status, owner_id | ordered_at DESC | 20 | 実測 |",
        "| order | order_items | order_id | id ASC | - | 実測 |",
        "| report | reports | owner_id | created_at DESC | 20 | 実測 |",
        "| user | users | active | id ASC | - | 実測 |",
        "| user | roles | role | id ASC | - | 実測 |",
        "| monthly-summary | orders | ordered_at | - | - | 実測 |",
      ],
      predicates: [
        "| orders-combined | orders | order | status = 'shipped' AND owner_id = :me | 画面の入力値（変換なし） | 3 | 38 | 踏める | - | 読了 |",
        "| orders-status | orders | order | status IN ('pending','canceled') | 画面の入力値（変換なし） | 5 | 36 | 踏める | - | 読了 |",
        "| orders-month | orders | monthly-summary | ordered_at の月境界 | 画面の入力値（変換なし） | 12 | 29 | 踏める | - | 読了 |",
        "| items-order | order_items | order | order_id = :id | 画面の入力値（変換なし） | 4 | 76 | 踏める | - | 読了 |",
        "| reports-owner | reports | report | owner_id = :me | 画面の入力値（変換なし） | 2 | 4 | 踏める | - | 読了 |",
        "| users-active | users | user | active = true | 画面の入力値（変換なし） | 3 | 1 | 踏める | - | 読了 |",
        "| roles-admin | roles | user | role = 'admin' | 画面の入力値（変換なし） | 1 | 2 | 踏める | - | 読了 |",
      ],
    }),
  });
  expect(codes).toEqual([]);
});

test("括弧つきの絞り込みからも列名を読む（読めなければ落とす）", () => {
  const paramsWith = (first) => [
    first,
    "| order | order_items | order_id | id ASC | - | 実測 |",
    "| report | reports | owner_id | created_at DESC | 20 | 実測 |",
    "| user | users | active | id ASC | - | 実測 |",
    "| user | roles | role | id ASC | - | 実測 |",
    "| monthly-summary | orders | ordered_at | - | - | 実測 |",
  ];
  // `(status = 'shipped')` は列名を読めるので、述語行があれば通る。
  expect(
    codesOf({
      design: designOf({
        params: paramsWith(
          "| order | orders | (status = 'shipped') | ordered_at DESC | 20 | 実測 |",
        ),
      }),
    }),
  ).toEqual([]);

  // 列名で始まらない条件は「読めない」として落とす（黙って飛ばさない）。
  expect(
    codesOf({
      design: designOf({
        params: paramsWith("| order | orders | = 'shipped' | ordered_at DESC | 20 | 実測 |"),
      }),
    }),
  ).toContain("predicate-filter-unreadable");
});

test("列名の突き合わせは識別子境界で行う（owner_id は id を満たさない）", () => {
  const codes = codesOf({
    design: designOf({
      params: [
        "| order | orders | id, owner_id | ordered_at DESC | 20 | 実測 |",
        "| order | order_items | order_id | id ASC | - | 実測 |",
        "| report | reports | owner_id | created_at DESC | 20 | 実測 |",
        "| user | users | active | id ASC | - | 実測 |",
        "| user | roles | role | id ASC | - | 実測 |",
        "| monthly-summary | orders | ordered_at | - | - | 実測 |",
      ],
      predicates: [
        "| orders-owner | orders | order | owner_id = :me | 画面の入力値（変換なし） | 3 | 38 | 踏める | - | 読了 |",
        "| orders-month | orders | monthly-summary | ordered_at の月境界 | 画面の入力値（変換なし） | 12 | 29 | 踏める | - | 読了 |",
        "| items-order | order_items | order | order_id = :id | 画面の入力値（変換なし） | 4 | 76 | 踏める | - | 読了 |",
        "| reports-owner | reports | report | owner_id = :me | 画面の入力値（変換なし） | 2 | 4 | 踏める | - | 読了 |",
        "| users-active | users | user | active = true | 画面の入力値（変換なし） | 3 | 1 | 踏める | - | 読了 |",
        "| roles-admin | roles | user | role = 'admin' | 画面の入力値（変換なし） | 1 | 2 | 踏める | - | 読了 |",
      ],
    }),
  });
  // `owner_id = :me` は部分文字列として id を含むが、列 id の分岐は数えられていない。
  expect(codes.filter((c) => c === "predicate-filter-not-enumerated")).toHaveLength(1);
});

test("真・偽の合計が表の件数を超える述語は落ちる（捏造した被覆を通さない）", () => {
  // 1 件の表に「真 1 / 偽 1」と書くと踏める判定になり、件数 0 / 1 の検査も扱いで黙らせられる。
  const codes = codesOf({
    design: designOf({
      targets: [
        "| orders | order, monthly-summary | 41 | 投入する | FK 親 |",
        "| order_items | order | 80 | 投入する | orders の子 |",
        "| reports | report | 6 | 投入する | - |",
        "| users | user | 4 | 投入する | - |",
        "| roles | user | 1 | 投入する | - |",
      ],
      predicates: [
        "| orders-status | orders | order | status = 'shipped' | 画面の入力値（変換なし） | 3 | 38 | 踏める | - | 読了 |",
        "| orders-month | orders | monthly-summary | ordered_at の月境界 | 画面の入力値（変換なし） | 12 | 29 | 踏める | - | 読了 |",
        "| items-order | order_items | order | order_id = :id | 画面の入力値（変換なし） | 4 | 76 | 踏める | - | 読了 |",
        "| reports-owner | reports | report | owner_id = :me | 画面の入力値（変換なし） | 2 | 4 | 踏める | - | 読了 |",
        "| users-active | users | user | active = true | 画面の入力値（変換なし） | 3 | 1 | 踏める | - | 読了 |",
        "| roles-admin | roles | user | role = 'admin' | 画面の入力値（変換なし） | 1 | 1 | 踏める | - | 読了 |",
      ],
    }),
  });
  expect(codes).toContain("predicate-partition-exceeds-table");
});

test("「gaps に記録」と決めた分岐は、投入後 0 件でも verification を落とさない", () => {
  const design = designOf({
    predicates: [
      "| orders-status | orders | order | status = 'shipped' | 画面の入力値（変換なし） | 3 | 38 | 踏める | - | 読了 |",
      "| orders-month | orders | monthly-summary | ordered_at の月境界 | 画面の入力値（変換なし） | 12 | 29 | 踏める | - | 読了 |",
      "| items-order | order_items | order | order_id = :id | 画面の入力値（変換なし） | 4 | 76 | 踏める | - | 読了 |",
      "| reports-owner | reports | report | owner_id = :me | 画面の入力値（変換なし） | 2 | 4 | 踏める | - | 読了 |",
      "| users-active | users | user | active = true | 画面の入力値（変換なし） | 3 | 1 | 踏める | - | 読了 |",
      "| roles-admin | roles | user | role = 'admin' | 画面の入力値（変換なし） | 3 | 0 | 踏めない | gaps に記録 | 現行 UI にこの分岐が無い |",
    ],
  });
  const verification = VERIFICATION.replace(
    "| roles-admin | 1 | 2 | 踏める | count(*) |",
    "| roles-admin | 3 | 0 | 踏めない | count(*) |",
  );
  expect(codesOf({ design, verification })).toEqual([]);

  // 扱いを決めていない（踏める想定の）分岐が 0 件なら従来どおり落ちる。
  const undecided = VERIFICATION.replace(
    "| users-active | 3 | 1 | 踏める | count(*) |",
    "| users-active | 3 | 0 | 踏めない | count(*) |",
  );
  expect(codesOf({ verification: undecided })).toContain("verification-branch-unreachable");
});

test("投入後も踏めない分岐と、設計値とのズレは verification の突き合わせで落ちる", () => {
  const codes = codesOf({
    verification: VERIFICATION.replace(
      "| roles-admin | 1 | 2 | 踏める | count(*) |",
      "| roles-admin | 0 | 3 | 踏めない | count(*) |",
    ),
  });
  expect(codes).toContain("verification-count-mismatch");
  expect(codes).toContain("verification-branch-unreachable");
});

test("述語 id が verification に無ければ落ちる", () => {
  const codes = codesOf({
    verification: VERIFICATION.replace("| roles-admin | 1 | 2 | 踏める | count(*) |\n", ""),
  });
  expect(codes).toContain("verification-predicate-missing");
});

test("表そのものが無ければ型崩れとして exit 2（合格にも 1 にも倒さない）", () => {
  const { code, result } = run(["--features", "f.md", "--design", "d.md"], {
    "/w/f.md": FEATURES,
    "/w/d.md": "# データ設計（design）\n",
  });
  expect(code).toBe(2);
  expect(result.structural).toBe(true);
  expect(result.findings.map((f) => f.code)).toContain("design-target-table-missing");
});

test("引数の誤りは exit 2", () => {
  expect(run(["--features", "f.md"], { "/w/f.md": FEATURES }).code).toBe(2);
  expect(run(["--features", "f.md", "--design", "d.md", "--nope", "x"], {}).code).toBe(2);
  expect(run(["--features", "f.md", "--design"], {}).code).toBe(2);
});

test("読めない入力は exit 2（存在しないことを合格に倒さない）", () => {
  expect(run(["--features", "f.md", "--design", "d.md"], { "/w/f.md": FEATURES }).code).toBe(2);
});

test("「消費側パラメータ」表が無ければ落ちる（絞り込みの数え漏らしが 0 件と同じ見え方になる）", () => {
  const withoutParams = designOf().replace(
    /## 消費側パラメータ\n\n\| 機能[\s\S]*?\n\n## 述語ごとの分岐被覆/,
    "## 述語ごとの分岐被覆",
  );
  // 表を確かに落とせていること（落とせていなければ、この検査は何も実証しない）。
  expect(withoutParams).not.toContain("## 消費側パラメータ");
  const { code, result } = run(["--features", "f.md", "--design", "d.md"], {
    "/w/f.md": FEATURES,
    "/w/d.md": withoutParams,
  });
  expect(code).toBe(1);
  expect(result.findings.map((f) => f.code)).toContain("design-param-table-missing");
});

test("verification の述語 id が重複していれば落ちる（後勝ちで実測を黙って捨てない）", () => {
  // 2 行目（後勝ちする側）は設計と一致させる——重複を弾かないと、食い違う 1 行目が
  // 突き合わせに使われずに落ち、0 件の分岐が 1 件も報告されないまま通る。
  const codes = codesOf({
    verification: VERIFICATION.replace(
      "| roles-admin | 1 | 2 | 踏める | count(*) |\n",
      "| roles-admin | 0 | 3 | 踏めない | count(*) |\n| roles-admin | 1 | 2 | 踏める | count(*) |\n",
    ),
  });
  expect(codes).toContain("verification-predicate-duplicated");
});

test("features.md の行がテーブルを挙げているのに slug が空なら落ちる", () => {
  const codes = codesOf({
    features: FEATURES.replace(
      "| report | レポート | reports | 未起票 |",
      "|  | レポート | reports | 未起票 |",
    ),
  });
  expect(codes).toContain("features-slug-missing");
});

test("消費側パラメータの絞り込みが空欄なら未調査として落ちる（`-` とは書き分ける）", () => {
  const paramsWith = (first) => [
    first,
    "| order | order_items | order_id | id ASC | - | 実測 |",
    "| report | reports | owner_id | created_at DESC | 20 | 実測 |",
    "| user | users | active | id ASC | - | 実測 |",
    "| user | roles | role | id ASC | - | 実測 |",
    "| monthly-summary | orders | ordered_at | - | - | 実測 |",
  ];
  expect(
    codesOf({
      design: designOf({
        params: paramsWith("| order | orders |  | ordered_at DESC | 20 | 実測 |"),
      }),
    }),
  ).toContain("param-filters-blank");

  // `-`（調べた結果ゼロ件）は従来どおり対象外。
  expect(
    codesOf({
      design: designOf({
        params: paramsWith("| order | orders | - | ordered_at DESC | 20 | 実測 |"),
      }),
    }),
  ).not.toContain("param-filters-blank");
});

// Issue #410: 区切り文字クラスに半角の閉じ括弧 `)` が無く、`(status)` が `status)` になっていた
// （開き括弧は先頭で剥がされるため、末尾だけが列名に残る）。剥がす記号と対称に持つ。
test.each([
  ["半角括弧", "(status)"],
  ["全角括弧", "（status）"],
  ["かぎ括弧", "「status」"],
  ["二重かぎ括弧", "『status』"],
  ["二重引用符", '"status"'],
  ["単一引用符", "'status'"],
  ["バッククォート", "`status`"],
])("囲んだ列名から閉じ側の記号が残らない: %s", (_label, filter) => {
  expect(filterColumn(filter)).toBe("status");
});

test("囲まれていない形・読めない形は従来どおり（対照）", () => {
  expect(filterColumn("status")).toBe("status");
  expect(filterColumn("status = :me")).toBe("status");
  expect(filterColumn("(owner_id = :me)")).toBe("owner_id");
  expect(filterColumn("()")).toBeNull();
  expect(filterColumn("")).toBeNull();
});

// Issue #498: データセットが決めた識別子の値（採番帯）が消費側の変換で別の値になると、
// 述語は設計どおり真でも消費側が引く行は 0 件になる。分岐被覆は設計者の値で数えるので「踏める」のまま残る。

/** 既定の識別子の値の範囲のうち、orders の行だけを差し替えた一覧。 */
function idRangesWith(ordersRows) {
  return [
    ...ordersRows,
    "| order_items | order_id | orders の帯と同じ | orders.id と同じ | order | - | 届く | - | 明細は親の id を文字列で受け取る |",
    "| reports | id | 900001〜900006 | 1〜99999 | report | - | 届く | - | 一覧は id を受け取らない |",
    "| users | id | 9001〜9004 | 1〜999 | user | int.Parse（32 ビット） | 届く | - | 共通ヘッダの利用者 |",
    "| roles | id | 91〜93 | 1〜9 | user | - | 届く | - | ロールは名前で引く |",
  ];
}

/** 既定の述語に、orders.id の述語を 1 行足した一覧。 */
function predicatesWithOrderId(row) {
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

const ORDERS_UNREACHED_GAPS =
  "| orders | id | 900000000001〜900000000041（12 桁） | 1〜99999999（8 桁） | order | Convert.ToInt32（超えると 0） | 届かない | gaps に記録 | 書き出しは 32 ビットを超える id で値を引かない |";
const ORDERS_REACHED_MONTHLY =
  "| orders | id | 900000000001〜900000000041（12 桁） | 1〜99999999（8 桁） | monthly-summary | 変換なし | 届く | - | バッチは id を文字列のまま使う |";

test("Issue #498 の形: 変換で届かないと記録した識別子の述語を「踏める」と数えると落ちる", () => {
  const codes = codesOf({
    design: designOf({
      idRanges: idRangesWith([ORDERS_UNREACHED_GAPS, ORDERS_REACHED_MONTHLY]),
      predicates: predicatesWithOrderId(
        "| orders-id | orders | order | id = '900000000001' | 設計者が書いた帯の値 | 1 | 40 | 踏める | - | 書き出しの明細 |",
      ),
    }),
  });
  expect(codes).toEqual(["predicate-counts-unconverted-value"]);
});

test("変換後の値で数え直して踏めない・gaps に記録にした述語は通る（陰性コントロール）", () => {
  const codes = codesOf({
    design: designOf({
      idRanges: idRangesWith([ORDERS_UNREACHED_GAPS, ORDERS_REACHED_MONTHLY]),
      predicates: predicatesWithOrderId(
        "| orders-id | orders | order | id = 0 | Convert.ToInt32(画面の id) の後の値 | 0 | 41 | 踏めない | gaps に記録 | 帯の値は 0 に変わる |",
      ),
    }),
  });
  expect(codes).toEqual([]);
});

test("届く値の行を足した（行を足す）なら、その列の述語が踏めるのは矛盾ではない", () => {
  const codes = codesOf({
    design: designOf({
      idRanges: idRangesWith([
        "| orders | id | 900000000001〜900000000041（12 桁） | 1〜99999999（8 桁） | order | Convert.ToInt32（超えると 0） | 届かない | 行を足す | 帯の外に 1 行（id 1）を足すと利用者が判断 |",
        ORDERS_REACHED_MONTHLY,
      ]),
      predicates: predicatesWithOrderId(
        "| orders-id | orders | order | id = 1 | Convert.ToInt32(画面の id) | 1 | 40 | 踏める | - | 帯の外の行 |",
      ),
    }),
  });
  expect(codes).toEqual([]);
});

test("届かない消費側と別の消費側の述語・別の列の述語は、届かない記録に巻き込まない", () => {
  const codes = codesOf({
    design: designOf({
      idRanges: idRangesWith([ORDERS_UNREACHED_GAPS, ORDERS_REACHED_MONTHLY]),
      predicates: [
        ...predicatesWithOrderId(
          "| orders-id-monthly | orders | monthly-summary | id = '900000000001' | バッチの入力（変換なし） | 1 | 40 | 踏める | - | バッチ |",
        ),
        // 列 `id` の記録は、識別子の境界で照合するので `order_no` 等の別の列に当たらない。
        "| orders-status-2 | orders | order | status_id = 2 | 画面の入力値（変換なし） | 2 | 39 | 踏める | - | 状態 |",
      ],
      params: [
        "| order | orders | status, status_id | ordered_at DESC | 20 | 実測 |",
        "| order | order_items | order_id | id ASC | - | 実測 |",
        "| report | reports | owner_id | created_at DESC | 20 | 実測 |",
        "| user | users | active | id ASC | - | 実測 |",
        "| user | roles | role | id ASC | - | 実測 |",
        "| monthly-summary | orders | ordered_at | - | - | 実測 |",
      ],
    }),
  });
  expect(codes).toEqual([]);
});

test("「値の出どころ」列が無い設計は、表が読めない（exit 2）ではなく不備（exit 1）として名指しする", () => {
  const design = designOf()
    .replace("| 述語（列・条件） | 値の出どころ |", "| 述語（列・条件） |")
    .replace("|---|---|---|---|---|---:|", "|---|---|---|---|---:|")
    .replaceAll(" | 画面の入力値（変換なし） |", " |");
  const { code, result } = run(["--features", "f.md", "--design", "d.md"], {
    "/w/f.md": FEATURES,
    "/w/d.md": design,
  });
  expect(code).toBe(1);
  expect(result.structural).toBeUndefined();
  expect(result.findings.map((f) => f.code)).toEqual(["predicate-origin-column-missing"]);
});

test.each([
  ["空欄", ""],
  ["-", "-"],
])("値の出どころが %s の述語は落ちる", (_label, origin) => {
  const codes = codesOf({
    design: designOf({
      predicates: predicatesWithOrderId(
        `| orders-id | orders | order | id = '900000000001' | ${origin} | 1 | 40 | 踏める | - | 詳細 |`,
      ),
      idRanges: idRangesWith([
        "| orders | id | 900000000001〜900000000041（12 桁） | 1〜99999999（8 桁） | order, monthly-summary | 変換なし | 届く | - | 読了 |",
      ]),
    }),
  });
  expect(codes).toEqual(["predicate-origin-missing"]);
});

test("「識別子の値の範囲」表が無い設計は落ちる（採番帯を確かめていないことが、通ることと同じ見え方になる）", () => {
  expect(codesOf({ design: designOf({ idRanges: null }) })).toEqual(["id-range-table-missing"]);
});

test("消費側 (slug, テーブル) ごとに行を要する——表ごと 1 行では変換する消費側が隠れる", () => {
  const codes = codesOf({
    design: designOf({
      idRanges: idRangesWith([
        "| orders | id | 900000000001〜900000000041（12 桁） | 1〜99999999（8 桁） | order | 変換なし | 届く | - | 読了 |",
      ]),
    }),
  });
  expect(codes).toEqual(["id-range-row-missing"]);
});

test("列 `-`（帯の値を持つ列が無い）と宣言した表には消費側ごとの行を求めない", () => {
  const codes = codesOf({
    design: designOf({
      idRanges: idRangesWith([
        "| orders | - | - | - | - | - | - | - | 識別子の列が無い（親の識別子だけの複合キー） |",
      ]),
    }),
  });
  expect(codes).toEqual([]);
});

test.each([
  [
    "届かないのに扱いが -",
    "| orders | id | 12 桁 | 8 桁 | order, monthly-summary | Convert.ToInt32 | 届かない | - | 読了 |",
    "id-range-disposition-missing",
  ],
  [
    "届かないのに扱いが語彙外（帯を変える）",
    "| orders | id | 12 桁 | 8 桁 | order, monthly-summary | Convert.ToInt32 | 届かない | 帯を変える | 読了 |",
    "id-range-disposition-missing",
  ],
  [
    "gaps に記録の根拠が空欄",
    "| orders | id | 12 桁 | 8 桁 | order, monthly-summary | Convert.ToInt32 | 届かない | gaps に記録 |  |",
    "id-range-reason-missing",
  ],
  [
    "行を足すの根拠が空欄",
    "| orders | id | 12 桁 | 8 桁 | order, monthly-summary | Convert.ToInt32 | 届かない | 行を足す |  |",
    "id-range-reason-missing",
  ],
  [
    "届くのに扱いがある",
    "| orders | id | 12 桁 | 8 桁 | order, monthly-summary | 変換なし | 届く | gaps に記録 | 読了 |",
    "id-range-disposition-vocabulary",
  ],
  [
    "届くかが空欄",
    "| orders | id | 12 桁 | 8 桁 | order, monthly-summary | 変換なし |  | - | 読了 |",
    "id-range-reach-vocabulary",
  ],
  [
    "受け取る型・変換が空欄",
    "| orders | id | 12 桁 | 8 桁 | order, monthly-summary |  | 届く | - | 読了 |",
    "id-range-cell-blank",
  ],
  [
    "実運用の値の範囲が空欄",
    "| orders | id | 12 桁 |  | order, monthly-summary | 変換なし | 届く | - | 読了 |",
    "id-range-cell-blank",
  ],
  [
    "列が空欄",
    "| orders |  | 12 桁 | 8 桁 | order, monthly-summary | 変換なし | 届く | - | 読了 |",
    "id-range-column-blank",
  ],
  [
    "届くの根拠が空欄（整数変換を届くと書くだけで通さない）",
    "| orders | id | 12 桁 | 8 桁 | order, monthly-summary | int.Parse | 届く | - |  |",
    "id-range-reason-missing",
  ],
  [
    "データセットの値の範囲が -",
    "| orders | id | - | 8 桁 | order, monthly-summary | 変換なし | 届く | - | 読了 |",
    "id-range-cell-blank",
  ],
  [
    "実運用の値の範囲が -",
    "| orders | id | 12 桁 | - | order, monthly-summary | 変換なし | 届く | - | 読了 |",
    "id-range-cell-blank",
  ],
  ["列 - の根拠が空欄", "| orders | - | - | - | - | - | - | - |  |", "id-range-reason-missing"],
])("識別子の値の範囲の不備: %s", (_label, row, expected) => {
  const codes = codesOf({ design: designOf({ idRanges: idRangesWith([row]) }) });
  expect(codes).toContain(expected);
});

test("識別子の値の範囲の消費側・テーブルは features.md と対象テーブル表に照らす", () => {
  expect(
    codesOf({
      design: designOf({
        idRanges: idRangesWith([
          "| orders | id | 12 桁 | 8 桁 | order, monthly-summary, report | 変換なし | 届く | - | 読了 |",
        ]),
      }),
    }),
  ).toEqual(["id-range-consumer-unknown"]);
  expect(
    codesOf({
      design: designOf({
        idRanges: [
          ...idRangesWith([
            "| orders | id | 12 桁 | 8 桁 | order, monthly-summary | 変換なし | 届く | - | 読了 |",
          ]),
          "| invoices | id | 12 桁 | 8 桁 | order | 変換なし | 届く | - | 読了 |",
        ],
      }),
    }),
  ).toEqual(["id-range-table-unknown"]);
  expect(
    codesOf({
      design: designOf({
        idRanges: idRangesWith(["| orders | id | 12 桁 | 8 桁 |  | 変換なし | 届く | - | 読了 |"]),
      }),
    }),
  ).toContain("id-range-consumer-blank");
});

test("列 `-` と実在の列の行を同じ表に併記すると落ちる（- の自己申告が消費側ごとの要求を黙って外す）", () => {
  const codes = codesOf({
    design: designOf({
      idRanges: idRangesWith([
        "| orders | id | 12 桁 | 8 桁 | order | 変換なし | 届く | - | 読了 |",
        "| orders | - | - | - | - | - | - | - | 採番に任せる |",
      ]),
    }),
  });
  expect(codes).toEqual(["id-range-dash-conflict"]);
});

test("同じ (テーブル, 列, slug) を 2 行に書くと落ちる（届く・届かないが 1 つに決まらない）", () => {
  const codes = codesOf({
    design: designOf({
      idRanges: idRangesWith([
        "| orders | id | 12 桁 | 8 桁 | order, monthly-summary | 変換なし | 届く | - | 読了 |",
        "| orders | id | 12 桁 | 8 桁 | order | Convert.ToInt32 | 届かない | 行を足す | 帯の外に 1 行 |",
      ]),
    }),
  });
  expect(codes).toEqual(["id-range-duplicated"]);
});

test("変換の列の `-`（変換なし）は範囲の列と違い受ける（陰性コントロール）", () => {
  const codes = codesOf({
    design: designOf({
      idRanges: idRangesWith([
        "| orders | id | 12 桁 | 8 桁 | order, monthly-summary | - | 届く | - | 文字列のまま渡す |",
      ]),
    }),
  });
  expect(codes).toEqual([]);
});
