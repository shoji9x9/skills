// parity-diff の保留棚卸しチェッカ（pending-triage-check.mjs）の回帰テスト（Issue #347）。
//
// 形の検証を「棚卸しの対象範囲」と同じ範囲でだけ終了コードへ入れる契約を固定する。
// 別機能に帰属すると読めている要素の形の不備で落ちると、対象 0 件の機能が
// 無関係な要素のせいで閉じられない（その要素は別機能の棚卸しが落とすので見逃しにはならない）。
// 逆に、対象を決められない要素（slug 欠落・item が読めない・オブジェクトでない）は
// 帰属不明として全機能の対象なので、従来どおり落ちることを陽性コントロールで固定する。
//
// あわせて `error:` 行が壊れている場所で分かれること（設定ファイルの登録簿か、成果物の棚卸し記録か）を
// 固定する——`error:` だけを読む自動化が直す場所を取り違えるため。
//
// 状態空間（帰属 × 不備の種類）。各セルに 1 ケースずつ置く:
//
// | 帰属 \ 不備            | added_by / added_at 欠落 | item が読めない | 文言の重複 |
// |------------------------|--------------------------|-----------------|------------|
// | この機能（slug 一致）  | exit 1（登録簿）         | exit 1          | exit 1     |
// | cross-cutting          | exit 1（登録簿）         | —               | —          |
// | 別機能（slug 相違）    | exit 0（warn のみ）      | exit 0          | exit 0     |
// | 帰属不明（slug 欠落）  | exit 1（登録簿）         | exit 1          | —          |
// | 要素が文字列でも object でもない | —               | exit 1          | —          |
//
// 変異による検出能力の実証（このファイルを書いた時点で 4 通り実施し、いずれも赤くなることを実測した）:
//   1. countTriage の `if (inScope(issue, slug))` を `if (true)` に → 2 件 fail
//      （別機能に帰属する要素の added_at 欠落 / item が読めない要素。緩和経路が効いていることを測れている）
//   2. 同じ行を `if (false)` に → 5 件 fail
//      （この機能 / cross-cutting / slug 欠落 / item が読めない要素の陽性コントロール / 非オブジェクト。対象内の検出が効いている）
//   3. 重複文言の `items.some(... inScope ...)` を `true` に → 1 件 fail（重複は別の分岐なので 1・2 では赤くならない）
//   4. main の `counted.record_problems.length > 0` の error 行を消す → 1 件 fail（記録側と登録簿側の分離）

import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-diff/scripts/pending-triage-check.mjs");

const SLUG = "my-feature";

/**
 * pending の要素と棚卸し記録を書いてスクリプトを 1 回走らせる。
 * @param {{pending: unknown[], entries?: unknown[], keep?: string[], may_change?: string[]}} input
 */
function run(input) {
  const work = mkdtempSync(join(tmpdir(), "pending-triage-"));
  const registries = join(work, "registries.json");
  const metadata = join(work, "diff-metadata.json");
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
    JSON.stringify({ slug: SLUG, intentional_diffs_pending: { entries: input.entries ?? [] } }),
  );
  const result = spawnSync(
    process.execPath,
    [script, "--registries", registries, "--metadata", metadata],
    {
      encoding: "utf8",
    },
  );
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
  // 壊れているのは成果物ではない（直す場所を取り違えさせない）。
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

  // 陽性コントロール: その機能の棚卸しでは同じ要素で落ちる（黙って捨てていない）。
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
  const parsed = JSON.parse(stdout);
  expect(parsed.in_scope).toBe(0);
  expect(parsed.untriaged).toBe(0);
  expect(parsed.registry_problems).toEqual([]);
  expect(parsed.record_problems).toEqual([]);
  expect(parsed.out_of_scope_problems).toEqual([]);
});
