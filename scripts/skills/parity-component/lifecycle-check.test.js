// 部品の一生の順番で不具合が出る実行パスの記録を検査する lifecycle-check.mjs の回帰テスト（Issue #477）。
//
// この検査が誤るのは、多くの場合「実行パスを警告なしに外した記録を完了と言う」側である。
// そのため、4 つの実行パスの振り分けの抜け・重複・語彙外と、検査の結果・実行パスに入った回数・
// 直した処理を外した確認の欠けが落ちることを厚く見る。
// 揃った記録が exit 0 になることと、対象でない部品が通ることも置く。

import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "skills/parity-component/scripts/lifecycle-check.mjs");
const { PATHS, checkLifecycle, main } = await import(script);

/** lifecycle を、順番の見本と重ならない見た目の対応表と一緒に build-metadata の形で渡す。 */
function check(
  lifecycle,
  stories = [
    {
      instance: "orders-search",
      state: "default",
      story: "components-button--orders-search-default",
    },
  ],
) {
  return checkLifecycle({ lifecycle, catalog: { stories } });
}

function pathRow(path, override = {}) {
  return {
    path,
    breaking_process: "Enter キーの結び付け",
    story: `components-button--lifecycle-${path}`,
    entry_attribute: `data-${path}-count`,
    entered: 1,
    check: "npx playwright test e2e/lifecycle/button.spec.ts",
    result: "pass",
    fix_removal_verified: true,
    ...override,
  };
}

function lifecycleOf(override = {}) {
  return {
    applies: true,
    reason: "initialized で命令的に結び effect の片付けで外す。既存の検査は同じ順でしか描かない",
    paths: [pathRow("strict-rebind"), pathRow("prop-change-after-init")],
    not_applicable_paths: [
      { path: "prop-identity", reason: "引数は初期化の後に別のオブジェクトにならない" },
      { path: "remount", reason: "付け直しで結び付けを持ち越す処理が無い" },
    ],
    ...override,
  };
}

const codes = (result) => result.findings.map((f) => f.code);

test("誤検知しないことの確認: 4 つの実行パスを 1 回ずつ振り分け、検査が通った記録は findings 0 件", () => {
  expect(check(lifecycleOf())).toEqual({ structural: false, applies: true, findings: [] });
});

test("対象でない部品は paths が空なら通し、paths があれば落とす", () => {
  const notApplicable = {
    applies: false,
    reason: "描画は引数だけで決まる",
    paths: [],
    not_applicable_paths: [],
  };
  expect(check(notApplicable).findings).toEqual([]);
  expect(codes(check({ ...notApplicable, paths: [pathRow("remount")] }))).toEqual([
    "lifecycle-paths-when-not-applicable",
  ]);
});

test("どちらにも振り分けていない実行パスは lifecycle-path-missing で落とす（空の paths も完了にしない）", () => {
  const dropped = lifecycleOf({ not_applicable_paths: [lifecycleOf().not_applicable_paths[0]] });
  expect(check(dropped).findings).toEqual([
    expect.objectContaining({ code: "lifecycle-path-missing", path: "remount" }),
  ]);
  const empty = lifecycleOf({ paths: [], not_applicable_paths: [] });
  expect(codes(check(empty))).toEqual([
    "lifecycle-no-paths",
    ...PATHS.map(() => "lifecycle-path-missing"),
  ]);
});

test("同じ実行パスの二重の振り分けと語彙外の実行パス名を落とす", () => {
  const dup = lifecycleOf({
    not_applicable_paths: [
      ...lifecycleOf().not_applicable_paths,
      { path: "strict-rebind", reason: "重複" },
    ],
  });
  expect(codes(check(dup))).toEqual(["lifecycle-path-duplicate"]);
  const unknown = lifecycleOf({ paths: [...lifecycleOf().paths, pathRow("hot-reload")] });
  expect(codes(check(unknown))).toEqual(["lifecycle-path-unknown"]);
});

test("検査が落ちた・実行パスに入っていない・直した処理を外した確認が無い実行パスを落とす", () => {
  const withRow = (override) =>
    lifecycleOf({ paths: [pathRow("strict-rebind", override), pathRow("prop-change-after-init")] });
  expect(codes(check(withRow({ result: "fail" })))).toEqual(["lifecycle-path-failed"]);
  for (const entered of [0, null, "1", 0.5]) {
    expect(codes(check(withRow({ entered })))).toEqual(["lifecycle-path-not-entered"]);
  }
  expect(codes(check(withRow({ fix_removal_verified: false })))).toEqual([
    "lifecycle-fix-removal-unverified",
  ]);
  expect(check(withRow({ story: "<順番を強制する見本の識別子>" })).findings).toEqual([
    expect.objectContaining({ code: "lifecycle-path-incomplete", missing: ["story"] }),
  ]);
});

test("名指しできない実行パスの理由が無ければ落とす", () => {
  const na = lifecycleOf({
    not_applicable_paths: [
      { path: "prop-identity", reason: "<名指しできない理由>" },
      lifecycleOf().not_applicable_paths[1],
    ],
  });
  expect(codes(check(na))).toEqual(["lifecycle-na-reason-missing"]);
});

test("lifecycle が無い・applies が真偽値でない・reason が無いのは型崩れ", () => {
  expect(check(undefined).structural).toBe(true);
  expect(check(lifecycleOf({ applies: "<対象か>" })).structural).toBe(true);
  expect(check(lifecycleOf({ reason: "" })).structural).toBe(true);
  expect(check(lifecycleOf({ paths: null })).structural).toBe(true);
});

test("同梱テンプレートをそのまま渡しても合格にしない", () => {
  const template = JSON.parse(
    readFileSync(
      join(repoRoot, "skills/parity-component/assets/build-metadata-template.json"),
      "utf8",
    ),
  );
  expect(checkLifecycle(template).structural).toBe(true);
});

test("CLI: 揃った記録で exit 0、実行パスの抜けで exit 1、引数の誤りは exit 2", () => {
  const dir = makeTempDir("lifecycle-check-");
  const file = join(dir, "build-metadata.json");
  writeFileSync(file, JSON.stringify({ lifecycle: lifecycleOf(), catalog: { stories: [] } }));
  const ok = spawnSync(process.execPath, [script, "--build-metadata", file], { encoding: "utf8" });
  expect(ok.status).toBe(0);
  expect(JSON.parse(ok.stdout)).toMatchObject({ tool: "lifecycle-check", ok: true, applies: true });
  writeFileSync(
    file,
    JSON.stringify({
      lifecycle: lifecycleOf({ not_applicable_paths: [] }),
      catalog: { stories: [] },
    }),
  );
  expect(
    spawnSync(process.execPath, [script, "--build-metadata", file], { encoding: "utf8" }).status,
  ).toBe(1);
  let err = "";
  expect(main([], { write: () => {}, writeErr: (s) => (err += s) })).toBe(2);
  expect(err).toMatch(/必須/);
});

test("eval fixture の完了済みの記録（対象でない部品）は通る", () => {
  const metadata = JSON.parse(
    readFileSync(
      join(
        repoRoot,
        "evals/parity-component/fixtures/breaking-change-request/.replace/components/button/new/local-dev/build-metadata.json",
      ),
      "utf8",
    ),
  );
  expect(check(metadata.lifecycle)).toEqual({
    structural: false,
    applies: false,
    findings: [],
  });
});

test("順番の見本が catalog.stories にも載っていれば落とし、対応表が読めなければ型崩れ", () => {
  const overlap = check(lifecycleOf(), [
    {
      instance: "orders-search",
      state: "default",
      story: "components-button--lifecycle-strict-rebind",
    },
  ]);
  expect(overlap.findings).toEqual([
    expect.objectContaining({ code: "lifecycle-story-in-catalog", path: "strict-rebind" }),
  ]);
  expect(checkLifecycle({ lifecycle: lifecycleOf() }).structural).toBe(true);
});
