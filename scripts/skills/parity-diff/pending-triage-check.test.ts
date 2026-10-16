// parity-diff の保留棚卸しチェッカ（pending-triage-check.mjs）の回帰テスト（Issue #347）。
//
// 形の検証の結果を、「棚卸しの対象範囲」と同じ範囲でだけ終了コードへ入れる取り決めを固定する。
// 別機能に帰属すると読めている要素の形の不備で落ちると、対象 0 件の機能が
// 無関係な要素のせいで閉じられない（その要素は別機能の棚卸しが落とすので見逃しにはならない）。
// 逆に、対象を決められない要素（slug 欠落・item が読めない・オブジェクトでない）は
// 帰属不明として全機能の対象である。そのため従来どおり落ちることを、検出できることの確認として固定する。
//
// あわせて、`error:` 行が不備のある場所で分かれること（設定ファイルの登録簿か、成果物の棚卸し記録か）を
// 固定する。`error:` だけを読む自動化が、直す場所を取り違えるためである。
//
// 状態空間（帰属 × 不備の種類）は次のとおり。各セルに 1 ケースずつ置く。
//
// | 帰属 \ 不備            | added_by / added_at 欠落 | item が読めない | 文言の重複 |
// |------------------------|--------------------------|-----------------|------------|
// | この機能（slug 一致）  | exit 1（登録簿）         | exit 1          | exit 1     |
// | cross-cutting          | exit 1（登録簿）         | —               | —          |
// | 別機能（slug 相違）    | exit 0（warn のみ）      | exit 0          | exit 0     |
// | 帰属不明（slug 欠落）  | exit 1（登録簿）         | exit 1          | —          |
// | 要素が文字列でも object でもない | —               | exit 1          | —          |
//
// 帰属の名前空間（added_by × slug の名前空間。レビュー指摘。PR #397）も確かめる。
// 機能 slug を書けないスキルは cross-cutting しか書けない。部品 slug を書かれると、inScope がどの機能でも偽になり、
// いつまでも棚卸しされない。扱いは次のとおり。
//
// | added_by         | slug            | 扱い                                          |
// |------------------|-----------------|-----------------------------------------------|
// | parity-component | 部品 slug       | 帰属不明として扱う（全機能の対象。未棚卸しで exit 1）|
// | parity-component | cross-cutting   | 従来どおり対象（正しい形。棚卸し済みなら exit 0）|
// | replace-strategy | 機能 slug     | 帰属不明として扱う（採番より前の工程なので機能 slug を書けない）|
// | replace-strategy | cross-cutting   | 従来どおり対象（正しい形。棚卸し済みなら exit 0）|
// | parity-suite 等  | 別機能の slug   | 帰属不明にしない（従来どおり対象外。exit 0）           |
// | 欠落 / unknown / 未知の名前 | 任意の slug | 帰属不明として扱う（名前空間を確認できない）   |
// | 欠落 / unknown / 未知の名前 | cross-cutting | 帰属不明にしない（書き手に依らず全機能の対象）   |
// | parity-suite 等  | 実在しない slug | 帰属不明として扱う（担当機能が現れない）       |
// | （インベントリ未提示） | 任意の slug | 緩和を適用しない（判定できないので全件を対象にする） |
//
// 次の変異で、検出できることを確かめた（このファイルを書いた時点で 4 通り実施し、いずれも赤くなることを実測した）。
//   1. countTriage の `if (inScope(issue, slug))` を `if (true)` に → 2 件 fail。
//      別機能に帰属する要素の added_at 欠落と、item が読めない要素。緩和する処理が機能していることを測れている。
//   2. 同じ行を `if (false)` に → 5 件 fail。
//      この機能・cross-cutting・slug 欠落・item が読めない要素の確認・非オブジェクト。対象内の検出が機能している。
//   3. 重複文言の `items.some(... inScope ...)` を `true` に → 1 件 fail（重複は別の分岐なので 1・2 では赤くならない）。
//   4. main の `counted.record_problems.length > 0` の error 行を消す → 1 件 fail（記録側と登録簿側の分離）。
//   5. normalizePending の `CROSS_CUTTING_ONLY_WRITERS.has(...)` を `false` に（分岐を殺す）→ 2 件 fail。
//      部品 slug の 2 ケース。名前空間の検出が機能している。
//   6. 同じ位置を `true` に（全スキルへ広げる）→ 5 件 fail。
//      別機能に帰属する要素を帰属不明として扱ってしまうケース群。その範囲が広すぎないことを測れている。
//   7. normalizePending の `namespaceVerified` を `true` に（slug を常に信用する＝修正前の挙動）→ 5 件 fail。
//   8. 同じ位置を `false` に（帰属を一切信用しない）→ 8 件 fail（#347 の緩和が機能していることを測れている）。
//   9. normalizePending の `slugInInventory` を `true` に（実在を検証しない＝修正前）→ 2 件 fail。
//  10. 同じ位置を `false` に（常に不在扱い）→ 7 件 fail。
//  11. CROSS_CUTTING_ONLY_WRITERS から `replace-strategy` を外す（Issue #419 の修正前）→ 1 件 fail。
//      「replace-strategy が機能 slug を書いた…」が「名前空間を確認できない」の診断に戻る。
//      帰属不明として扱う点は同じなので、差は診断の表現だけである。
//  12. `replace-strategy` を FEATURE_SLUG_WRITERS へ入れる（分類を間違える）→ 1 件 fail。
//      同じテストが in_scope 0 件で落ちる。採番前の推測 slug を信用して対象外として扱う退行を測れている。
//      cross-cutting のケースは 11 ・12 のいずれでも赤くならない（cross-cutting は書き手に依らず信用されるため）。
//      したがって許可値を増やす修正が変えるのは、機能 slug を書いたときの**診断の表現**であって、正しい形の扱いではない

import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { parseJsonAs } from "../../lib/parse-as.ts";

/** pending-triage-check.mjs が stdout に出す要約のうち、テストが読む欄。 */
type TriageSummary = {
  in_scope: number;
  untriaged: number;
  unattributed: number;
  registry_problems: string[];
  record_problems: string[];
  out_of_scope_problems: string[];
};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "skills/parity-diff/scripts/pending-triage-check.mjs");

const SLUG = "my-feature";

/**
 * pending の要素と棚卸し記録を書いてスクリプトを 1 回実行する。
 * @param {{pending: unknown[], entries?: unknown[], record?: unknown, keep?: unknown[], may_change?: unknown[], slugs?: string[], features?: false}} input
 */
function run(input: {
  pending: unknown[];
  entries?: unknown[];
  /** 棚卸しの記録（intentional_diffs_pending）全体。渡すと entries より優先する。 */
  record?: unknown;
  keep?: unknown[];
  may_change?: unknown[];
  slugs?: string[];
  features?: false;
}) {
  const work = makeTempDir("pending-triage-");
  const registries = join(work, "registries.json");
  const metadata = join(work, "diff-metadata.json");
  const features = join(work, "features.md");
  writeFileSync(
    features,
    [
      "| slug | \u6a5f\u80fd\u540d |",
      "|---|---|",
      ...(input.slugs ?? [SLUG, "other-feature"]).map((s) => `| ${s} | x |`),
      "",
    ].join("\n"),
  );
  writeFileSync(
    registries,
    JSON.stringify({
      intentional_diffs: {
        keep: input.keep ?? [],
        may_change: input.may_change ?? [],
        pending: input.pending,
      },
    }),
  );
  writeFileSync(
    metadata,
    JSON.stringify({
      slug: SLUG,
      intentional_diffs_pending: input.record ?? { entries: input.entries ?? [] },
    }),
  );
  const args = [script, "--registries", registries, "--metadata", metadata];
  if (input.features !== false) args.push("--features", features);
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

/** 別機能に帰属する 1 件だけが pending に残り、この機能の対象は 0 件。 */
const otherFeature = { item: "別機能の保留", slug: "other-feature", added_by: "parity-suite" };

test("別機能に帰属すると読めている要素の added_at 欠落では、この機能の棚卸しは落ちない", () => {
  const { status, stderr } = run({ pending: [otherFeature] });
  expect(status).toBe(0);
  // 見えなくはしない（warn と件数の note は出る）。
  expect(stderr).toContain("warn: intentional_diffs.pending[0]: added_at が無い");
  expect(stderr).toContain("別機能に帰属する pending の形の不備 1 件");
  expect(stderr).not.toContain("error:");
});

test("同じ不備でもこの機能に帰属していれば落ち、error は登録簿側として報告される", () => {
  const { status, stderr } = run({
    pending: [{ ...otherFeature, item: "この機能の保留", slug: SLUG }],
    entries: [
      { item: "この機能の保留", slug: SLUG, disposition: "carried_over", reason: "測定待ち" },
    ],
  });
  expect(status).toBe(1);
  expect(stderr).toContain("error: 設定ファイルの登録簿の不整合（intentional_diffs.pending");
  // 不備があるのは成果物ではない（直す場所を取り違えさせない）。
  expect(stderr).not.toContain("error: 棚卸し記録の不整合");
});

test("cross-cutting の要素の形の不備は対象なので落ちる", () => {
  const { status, stderr } = run({
    pending: [{ item: "横断の保留", slug: "cross-cutting", added_at: "2026-09-01" }],
    entries: [
      {
        item: "横断の保留",
        slug: "cross-cutting",
        disposition: "carried_over",
        reason: "依存待ち",
      },
    ],
  });
  expect(status).toBe(1);
  expect(stderr).toContain("warn: intentional_diffs.pending[0]: added_by が無い");
  expect(stderr).toContain("error: 設定ファイルの登録簿の不整合");
});

test("slug が無い要素は帰属不明として全機能の対象になり、形の不備でも落ちる", () => {
  const { status, stderr } = run({
    pending: [{ item: "帰属不明の保留", added_by: "parity-replace" }],
    entries: [
      { item: "帰属不明の保留", slug: null, disposition: "carried_over", reason: "確認待ち" },
    ],
  });
  expect(status).toBe(1);
  expect(stderr).toContain("slug が無い");
  expect(stderr).toContain("error: 設定ファイルの登録簿の不整合");
});

test("item が読めない要素は、別機能に帰属していればこの機能を止めない（その機能の棚卸しが落とす）", () => {
  const broken = {
    summary: "キー名を間違えた追記",
    slug: "other-feature",
    added_by: "parity-replace",
    added_at: "2026-09-01",
  };
  const outOfScope = run({ pending: [broken] });
  expect(outOfScope.status).toBe(0);
  expect(outOfScope.stderr).toContain(
    "warn: intentional_diffs.pending[0]: item が空／文字列でない",
  );

  // 検出できることの確認: その機能の棚卸しでは同じ要素で落ちる（警告なしに捨てていない）。
  const owner = run({ pending: [{ ...broken, slug: SLUG }] });
  expect(owner.status).toBe(1);
  expect(owner.stderr).toContain("error: 設定ファイルの登録簿の不整合");
});

test("文字列でもオブジェクトでもない要素は帰属を決められないので落ちる", () => {
  const { status, stderr } = run({ pending: [42] });
  expect(status).toBe(1);
  expect(stderr).toContain("文字列でもオブジェクトでもない");
  expect(stderr).toContain("error: 設定ファイルの登録簿の不整合");
});

test("同じ文言の重複は、全て別機能なら報告だけ・1 件でも対象に入れば落ちる", () => {
  const dup = { item: "同じ文言", added_by: "parity-suite", added_at: "2026-09-01" };
  const outOfScope = run({
    pending: [
      { ...dup, slug: "other-feature" },
      { ...dup, slug: "other-feature" },
    ],
  });
  expect(outOfScope.status).toBe(0);
  expect(outOfScope.stderr).toContain("warn: intentional_diffs.pending に同じ文言が 2 件ある");

  const inScope = run({
    pending: [
      { ...dup, slug: "other-feature" },
      { ...dup, slug: SLUG },
    ],
    entries: [{ item: "同じ文言", slug: SLUG, disposition: "carried_over", reason: "確認待ち" }],
  });
  expect(inScope.status).toBe(1);
  expect(inScope.stderr).toContain("error: 設定ファイルの登録簿の不整合");
});

test("棚卸し記録側の不備は記録側の error として報告される（登録簿側は出さない）", () => {
  const { status, stderr } = run({
    pending: [],
    entries: [{ item: "", slug: SLUG, disposition: "carried_over", reason: "確認待ち" }],
  });
  expect(status).toBe(1);
  expect(stderr).toContain("error: 棚卸し記録の不整合（intentional_diffs_pending.entries");
  expect(stderr).not.toContain("error: 設定ファイルの登録簿の不整合");
});

test("対象なのに記録が無ければ未棚卸しとして落ちる（範囲を狭めても未棚卸しは残る）", () => {
  const { status, stderr } = run({
    pending: [
      { item: "この機能の保留", slug: SLUG, added_by: "parity-suite", added_at: "2026-09-01" },
    ],
  });
  expect(status).toBe(1);
  expect(stderr).toContain("error: 未棚卸し 1 件");
});

test("対象 0 件で不備も無ければ、ゼロ件の記録とともに合格する", () => {
  const { status, stderr, stdout } = run({
    pending: [{ ...otherFeature, added_at: "2026-09-01" }],
  });
  expect(status).toBe(0);
  expect(stderr).not.toContain("error:");
  expect(stderr).not.toContain("warn:");
  const parsed = parseJsonAs<TriageSummary>(stdout);
  expect(parsed.in_scope).toBe(0);
  expect(parsed.untriaged).toBe(0);
  // 他のスキルが別機能の slug を書いた要素は、この検査で帰属不明として扱われない。
  expect(parsed.unattributed).toBe(0);
  expect(parsed.registry_problems).toEqual([]);
  expect(parsed.record_problems).toEqual([]);
  expect(parsed.out_of_scope_problems).toEqual([]);
});

// 機能 slug を書けないスキル（parity-component）の帰属（レビュー指摘。PR #397）。
// 部品 slug は機能 slug と別の名前空間なので、そのままではどの機能の inScope にも入らず永久に棚卸しされない。

test("parity-component が部品 slug を書いた要素は帰属不明として全機能の対象になる", () => {
  const { status, stderr, stdout } = run({
    pending: [
      {
        item: "部品の保留",
        slug: "button-primary",
        added_by: "parity-component",
        added_at: "2026-09-01",
      },
    ],
  });
  // 形の 4 キーは揃っているので、落ちる理由は「対象に入れた結果の未棚卸し」と名前空間の取り違えだけ。
  expect(status).toBe(1);
  expect(stderr).toContain("added_by が parity-component なのに slug が cross-cutting でない");
  expect(stderr).toContain("error: 未棚卸し 1 件");
  expect(stderr).toContain("error: 設定ファイルの登録簿の不整合");
  const parsed = parseJsonAs<TriageSummary>(stdout);
  expect(parsed.in_scope).toBe(1);
  expect(parsed.untriaged).toBe(1);
  expect(parsed.out_of_scope_problems).toEqual([]);
});

test("部品 slug の要素は、帰属不明として棚卸しすれば閉じられる", () => {
  const { status, stderr } = run({
    pending: [
      {
        item: "部品の保留",
        slug: "button-primary",
        added_by: "parity-component",
        added_at: "2026-09-01",
      },
    ],
    entries: [
      { item: "部品の保留", slug: null, disposition: "carried_over", reason: "意匠確認待ち" },
    ],
  });
  // 棚卸しは済むが、名前空間の取り違えは登録簿の不備として残る（直すまで閉じない）。
  expect(status).toBe(1);
  expect(stderr).not.toContain("error: 未棚卸し");
  expect(stderr).toContain("error: 設定ファイルの登録簿の不整合");
});

test("parity-component が cross-cutting で書いた要素は従来どおり通る（誤検知しないことの確認）", () => {
  const { status, stderr } = run({
    pending: [
      {
        item: "部品の保留",
        slug: "cross-cutting",
        added_by: "parity-component",
        added_at: "2026-09-01",
      },
    ],
    entries: [
      {
        item: "部品の保留",
        slug: "cross-cutting",
        disposition: "carried_over",
        reason: "意匠確認待ち",
      },
    ],
  });
  expect(status).toBe(0);
  expect(stderr).not.toContain("error:");
  expect(stderr).not.toContain("warn:");
});

// replace-strategy の帰属（Issue #419）。意図的差異レジストリを作る工程（setup の手順 8）は
// 機能 slug の採番（同 手順 9）より前なので、機能 slug を書けない。
// 許可値に無いままだと「未知のスキル名」として帰属不明と判定されてしまい、機能に帰属する保留が閉じられない。

test("replace-strategy が cross-cutting で書いた要素は従来どおり通る（誤検知しないことの確認）", () => {
  const { status, stderr } = run({
    pending: [
      {
        item: "新 DB の NULL の並び順は測定後に決める",
        slug: "cross-cutting",
        added_by: "replace-strategy",
        added_at: "2026-09-01",
      },
    ],
    entries: [
      {
        item: "新 DB の NULL の並び順は測定後に決める",
        slug: "cross-cutting",
        disposition: "carried_over",
        reason: "フェーズ B の一致検証待ち",
      },
    ],
  });
  expect(status).toBe(0);
  expect(stderr).not.toContain("error:");
  expect(stderr).not.toContain("warn:");
});

test("replace-strategy が機能 slug を書いた要素は帰属不明として全機能の対象になる", () => {
  const { status, stderr, stdout } = run({
    pending: [
      {
        item: "採番前に機能 slug を推測で書いた保留",
        slug: "other-feature",
        added_by: "replace-strategy",
        added_at: "2026-09-01",
      },
    ],
  });
  expect(status).toBe(1);
  expect(stderr).toContain("added_by が replace-strategy なのに slug が cross-cutting でない");
  expect(stderr).toContain("error: 未棚卸し 1 件");
  const parsed = parseJsonAs<TriageSummary>(stdout);
  expect(parsed.in_scope).toBe(1);
  expect(parsed.out_of_scope_problems).toEqual([]);
});

// 書き手が読めない要素の帰属（レビュー指摘。PR #397 の 2 巡目）。
// added_by が読めないと slug がどの名前空間のものか確認できず、「別機能に帰属すると読めている」条件を満たさない。
// 信用したまま対象外にすると、形の不備が全機能で warn になり、空の棚卸し記録で exit 0 のまま閉じられる。

test.each([
  ["added_by が無い", { item: "由来不明の保留", slug: "button-primary" }],
  [
    "added_by が unknown",
    { item: "由来不明の保留", slug: "button-primary", added_by: "unknown", added_at: "unknown" },
  ],
  [
    "added_by が未知のスキル名",
    {
      item: "由来不明の保留",
      slug: "button-primary",
      added_by: "some-tool",
      added_at: "2026-09-01",
    },
  ],
])("%s の要素は slug を信用せず帰属不明として全機能の対象にする", (_name, entry) => {
  const { status, stderr, stdout } = run({ pending: [entry] });
  expect(status).toBe(1);
  expect(stderr).toContain("slug の名前空間を確認できない");
  expect(stderr).toContain("error: 未棚卸し 1 件");
  const parsed = parseJsonAs<TriageSummary>(stdout);
  expect(parsed.in_scope).toBe(1);
  expect(parsed.out_of_scope_problems).toEqual([]);
});

// 機能インベントリとの照合（レビュー指摘。PR #397 の 3 巡目）。
// 書き手が正規でも、slug が実在しなければその「担当機能」は現れず、永久に棚卸しされない。

test("実在しない slug は、書き手が正規でも帰属不明として全機能の対象になる", () => {
  const { status, stderr, stdout } = run({
    pending: [
      {
        item: "綴り違いの保留",
        slug: "typo-feature",
        added_by: "parity-suite",
        added_at: "2026-09-01",
      },
    ],
  });
  expect(status).toBe(1);
  expect(stderr).toContain("slug が機能インベントリに無い");
  expect(stderr).toContain("error: 未棚卸し 1 件");
  const parsed = parseJsonAs<TriageSummary>(stdout);
  expect(parsed.in_scope).toBe(1);
  expect(parsed.out_of_scope_problems).toEqual([]);
});

test("--features を渡さないと別機能への緩和を適用しない（渡されないときは緩和しない側で判定する）", () => {
  const { status, stderr, stdout } = run({
    pending: [{ ...otherFeature, added_at: "2026-09-01" }],
    features: false,
  });
  // 同じ入力でも --features 付きなら対象 0 件・exit 0（下の、検出できることの確認）。
  expect(status).toBe(1);
  expect(stderr).toContain("--features を渡していないので");
  expect(parseJsonAs<TriageSummary>(stdout).in_scope).toBe(1);

  const withInventory = run({ pending: [{ ...otherFeature, added_at: "2026-09-01" }] });
  expect(withInventory.status).toBe(0);
  expect(parseJsonAs<TriageSummary>(withInventory.stdout).in_scope).toBe(0);
});

test("slug 表の無い features.md は読めないものとして exit 2 で落ちる", () => {
  const work = makeTempDir("pending-triage-features-");
  const registries = join(work, "registries.json");
  const metadata = join(work, "diff-metadata.json");
  const features = join(work, "features.md");
  writeFileSync(
    registries,
    JSON.stringify({ intentional_diffs: { keep: [], may_change: [], pending: [] } }),
  );
  writeFileSync(
    metadata,
    JSON.stringify({ slug: SLUG, intentional_diffs_pending: { entries: [] } }),
  );
  writeFileSync(features, "# 機能インベントリ\n\n表はまだ無い。\n");
  const result = spawnSync(
    process.execPath,
    [script, "--registries", registries, "--metadata", metadata, "--features", features],
    { encoding: "utf8" },
  );
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("slug 列の表が無い");
});

test("対象 slug 自体がインベントリに無ければ、比較の基準が無いので落ちる", () => {
  const { status, stderr } = run({ pending: [], slugs: ["other-feature"] });
  expect(status).toBe(2);
  expect(stderr).toContain("対象 slug が機能インベントリに無い");
});

test("書き手が読めない要素は cross-cutting なら従来どおり対象（誤検知しないことの確認）", () => {
  const { status, stderr } = run({
    pending: [
      { item: "横断の保留", slug: "cross-cutting", added_by: "unknown", added_at: "unknown" },
    ],
    entries: [
      {
        item: "横断の保留",
        slug: "cross-cutting",
        disposition: "carried_over",
        reason: "確認待ち",
      },
    ],
  });
  // cross-cutting は書き手に依らず全機能の対象なので、名前空間の確認は要らない。
  expect(status).toBe(0);
  expect(stderr).not.toContain("slug の名前空間を確認できない");
});

// --- 照合キー（match）を持つ移動先（Issue #496）---
// keep / may_change の要素は { item, match } のオブジェクトでも書ける。移した記録は item で突き合わせる。

const promotedItem = "見出しの border-style が現行 none・新側 solid。幅は両側 0px";

test("match を持つオブジェクトとして may_change へ移した要素は、移したと認める", () => {
  const r = run({
    pending: [],
    may_change: [{ item: promotedItem, match: { element: "heading", property: "border-*-style" } }],
    entries: [{ item: promotedItem, slug: SLUG, disposition: "may_change" }],
  });
  expect(r.stderr).not.toContain("に見つからない");
  expect(r.status).toBe(0);
});

test("移動先に無ければ落ちる（検出されることの確認: 移動先の突き合わせが動いていること）", () => {
  const r = run({
    pending: [],
    may_change: [],
    entries: [{ item: promotedItem, slug: SLUG, disposition: "may_change" }],
  });
  expect(r.stderr).toContain("may_change に見つからない");
  expect(r.status).not.toBe(0);
});

// --- 棚卸しの記録の検査（references/convergence.md「記録」が挙げる失敗の条件）---
// 記録の不備は、どれも記録側の error 行と exit 1 になる。warn 行の文言で、どの不備として扱ったかを区別する。

const mine = {
  item: "この機能の保留",
  slug: SLUG,
  added_by: "parity-suite",
  added_at: "2026-09-01",
};
const carried = { item: mine.item, slug: SLUG, disposition: "carried_over", reason: "測定待ち" };

test.each([
  ["要素がオブジェクトでない", [mine], [carried, 5], /entries\[1\]: オブジェクトでない/],
  [
    "同じ item を二重に記録した",
    [mine],
    [carried, carried],
    /entries\[1\]: 同じ item が二重に記録されている/,
  ],
  ["slug が文字列でない", [mine], [{ ...carried, slug: 5 }], /entries\[0\]: slug が文字列でない/],
  [
    "記録した帰属が pending の帰属と違う",
    [mine],
    [{ ...carried, slug: "cross-cutting" }],
    /記録した帰属（cross-cutting）が設定ファイルの pending の帰属（my-feature）と違う/,
  ],
  [
    "別の機能の slug で記録した",
    [],
    [{ item: "別機能の保留", slug: "other-feature", disposition: "keep" }],
    /対象外の slug（other-feature）を棚卸しに記録している/,
  ],
  [
    "処置が語彙の外",
    [mine],
    [{ ...carried, disposition: "done" }],
    /disposition が .* のいずれでもない/,
  ],
  ["持ち越しの理由が空", [mine], [{ ...carried, reason: " " }], /持ち越しの理由が空/],
  ["持ち越した要素が pending に無い", [], [carried], /持ち越しと記録されているが pending に無い/],
  [
    "移した後の文言が空",
    [],
    [{ item: mine.item, slug: SLUG, disposition: "keep", promoted_as: "" }],
    /promoted_as が空文字列/,
  ],
  [
    "移したと記録したのに pending に残っている",
    [mine],
    [{ item: mine.item, slug: SLUG, disposition: "keep" }],
    /keep へ移したと記録されているが pending に残っている/,
  ],
])("記録の不備（%s）は記録側の error で exit 1", (_name, pending, entries, warn) => {
  const { status, stderr } = run({ pending, entries, keep: [mine.item] });

  expect(status).toBe(1);
  expect(stderr).toMatch(warn);
  expect(stderr).toContain("error: 棚卸し記録の不整合（intentional_diffs_pending.entries");
});

test("宣言した件数が数え直した件数と違えば落ちる（記録の件数を信用しない）", () => {
  const { status, stderr } = run({
    pending: [mine],
    record: { attributed: 3, carried_over: 1, entries: [carried] },
  });

  expect(status).toBe(1);
  expect(stderr).toContain(
    "intentional_diffs_pending.attributed: 宣言 3 と数え直した 1 が一致しない",
  );
  expect(stderr).not.toContain("carried_over: 宣言");
});

test("持ち越し・文言を変えて移した確定・帰属不明の記録を数え直し、件数を note に出して合格する", () => {
  const legacy = "旧形式の文字列の保留";
  const { status, stdout, stderr } = run({
    // ただの文字列は旧形式で、帰属不明として全機能の対象になる。
    pending: [mine, legacy],
    keep: ["移した後の文言"],
    entries: [
      carried,
      { item: legacy, slug: null, disposition: "carried_over", reason: "依存先の実装待ち" },
      { item: "移す前の文言", slug: SLUG, disposition: "keep", promoted_as: "移した後の文言" },
    ],
  });

  expect(status).toBe(0);
  expect(parseJsonAs<TriageSummary & Record<string, number>>(stdout)).toMatchObject({
    attributed: 2,
    unattributed: 1,
    resolved: 1,
    carried_over: 2,
    in_scope: 2,
    untriaged: 0,
  });
  expect(stderr).toContain(
    "note: 棚卸しの記録 3 件（この機能 2 / 横断 0 / 帰属不明 1）、確定 1 件、持ち越し 2 件",
  );
});

test("帰属不明の文字列の要素も、棚卸ししなければ未棚卸しとして落ちる", () => {
  const { status, stderr } = run({ pending: ["旧形式の文字列の保留"] });

  expect(status).toBe(1);
  expect(stderr).toContain("（帰属不明）— 旧形式の文字列の保留");
  expect(stderr).toContain("error: 未棚卸し 1 件");
});

test.each([
  ["空の文字列", "", /pending\[0\]: 空の要素/],
  ["slug が数", { ...mine, slug: 5 }, /pending\[0\]: slug が空／文字列でない/],
])("pending の要素の %s は帰属不明として登録簿側の error で落ちる", (_name, entry, warn) => {
  const { status, stderr } = run({ pending: [entry] });

  expect(status).toBe(1);
  expect(stderr).toMatch(warn);
  expect(stderr).toContain("error: 設定ファイルの登録簿の不整合");
});

test("区切り行の無い slug 表は機能インベントリとして読まない（対象 slug が見つからず exit 2）", () => {
  const work = makeTempDir("pending-triage-features-");
  const { registries, metadata } = writeInputs(work, {});
  const features = join(work, "features.md");
  writeFileSync(features, `| slug | 機能名 |\n| ${SLUG} | x |\n`);

  const r = runArgs(["--registries", registries, "--metadata", metadata, "--features", features]);

  expect(r.status).toBe(2);
  expect(r.stderr).toContain(`対象 slug が機能インベントリに無い（${SLUG}）`);
});

/** 設定ファイルと成果物を、渡した内容（文字列ならそのまま）で書く。 */
function writeInputs(work: string, input: { registries?: unknown; metadata?: unknown }) {
  const registries = join(work, "registries.json");
  const metadata = join(work, "diff-metadata.json");
  const text = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
  writeFileSync(
    registries,
    text(input.registries ?? { intentional_diffs: { keep: [], may_change: [], pending: [] } }),
  );
  writeFileSync(
    metadata,
    text(input.metadata ?? { slug: SLUG, intentional_diffs_pending: { entries: [] } }),
  );
  return { registries, metadata };
}

function runArgs(args: string[]) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// 成果物と設定ファイルの型の誤り・使い方の誤りは、未棚卸し（exit 1）とまとめず exit 2 にする。
test.each([
  ["registries.json が JSON でない", { registries: "{" }, "registries.json を読めない"],
  ["registries.json が配列", { registries: [] }, "registries.json がオブジェクトでない"],
  ["intentional_diffs が無い", { registries: {} }, "intentional_diffs が無い／オブジェクトでない"],
  [
    "pending が配列でない",
    { registries: { intentional_diffs: { pending: {} } } },
    "intentional_diffs.pending が無い／配列でない",
  ],
  ["diff-metadata.json が JSON でない", { metadata: "{" }, "diff-metadata.json を読めない"],
  ["diff-metadata.json が配列", { metadata: [] }, "diff-metadata.json がオブジェクトでない"],
  ["slug が無い", { metadata: { intentional_diffs_pending: { entries: [] } } }, "slug が無い"],
  [
    "棚卸しの記録がオブジェクトでない",
    { metadata: { slug: SLUG, intentional_diffs_pending: [] } },
    "intentional_diffs_pending がオブジェクトでない",
  ],
  [
    "entries が無い",
    { metadata: { slug: SLUG, intentional_diffs_pending: {} } },
    "intentional_diffs_pending.entries が配列でない",
  ],
])("%s なら exit 2", (_name, input, message) => {
  const { registries, metadata } = writeInputs(makeTempDir("pending-triage-input-"), input);

  const r = runArgs(["--registries", registries, "--metadata", metadata]);

  expect(r.status).toBe(2);
  expect(r.stderr).toContain(message);
});

test("棚卸しの記録がキーごと無ければ未実施として exit 1（旧成果物として合格にしない）", () => {
  const { registries, metadata } = writeInputs(makeTempDir("pending-triage-input-"), {
    metadata: { slug: SLUG },
  });

  const r = runArgs(["--registries", registries, "--metadata", metadata]);

  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout)).toMatchObject({ recorded: false, in_scope: null, untriaged: null });
  expect(r.stderr).toContain("intentional_diffs_pending が無い（棚卸し未実施）");
});

test.each([
  ["引数が無い", [], "usage:"],
  ["--metadata が無い", ["--registries", "r.json"], "usage:"],
  ["値が無い", ["--registries"], "usage:"],
  [
    "同じフラグを 2 回",
    ["--registries", "a.json", "--registries", "b.json"],
    "が複数回指定されている",
  ],
  ["知らない引数", ["--foo"], "unknown argument: --foo"],
])("CLI の使い方の誤り（%s）は exit 2", (_name, args, message) => {
  const r = runArgs(args);

  expect(r.status).toBe(2);
  expect(r.stderr).toContain(message);
});

test("features.md が読めなければ exit 2", () => {
  const work = makeTempDir("pending-triage-input-");
  const { registries, metadata } = writeInputs(work, {});

  const r = runArgs([
    "--registries",
    registries,
    "--metadata",
    metadata,
    "--features",
    join(work, "missing.md"),
  ]);

  expect(r.status).toBe(2);
  expect(r.stderr).toContain("features.md を読めない");
});
