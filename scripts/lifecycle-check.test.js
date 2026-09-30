// 部品の一生の順番で壊れる経路の記録を検査する lifecycle-check.mjs の回帰テスト（Issue #477）。
//
// 壊れる方向は「経路を黙って落とした記録を完了と言う」側に偏るので、4 経路の振り分けの漏れ・重複・語彙外と、
// 検査の結果・経路に入った回数・直した処理を外した確認の欠けが落ちることを厚く見る。
// 陽性コントロール（揃った記録が exit 0）と、対象でない部品が通ることも置く。

import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "./lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-component/scripts/lifecycle-check.mjs");
const { PATHS, checkLifecycle, main } = await import(script);

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

test("陽性コントロール: 4 経路を 1 回ずつ振り分け、検査が通った記録は findings 0 件", () => {
  expect(checkLifecycle(lifecycleOf())).toEqual({ structural: false, applies: true, findings: [] });
});

test("対象でない部品は paths が空なら通し、paths があれば落とす", () => {
  const notApplicable = {
    applies: false,
    reason: "描画は引数だけで決まる",
    paths: [],
    not_applicable_paths: [],
  };
  expect(checkLifecycle(notApplicable).findings).toEqual([]);
  expect(codes(checkLifecycle({ ...notApplicable, paths: [pathRow("remount")] }))).toEqual([
    "lifecycle-paths-when-not-applicable",
  ]);
});

test("どちらにも振り分けていない経路は lifecycle-path-missing で落とす（空の paths も完了にしない）", () => {
  const dropped = lifecycleOf({ not_applicable_paths: [lifecycleOf().not_applicable_paths[0]] });
  expect(checkLifecycle(dropped).findings).toEqual([
    expect.objectContaining({ code: "lifecycle-path-missing", path: "remount" }),
  ]);
  const empty = lifecycleOf({ paths: [], not_applicable_paths: [] });
  expect(codes(checkLifecycle(empty))).toEqual([
    "lifecycle-no-paths",
    ...PATHS.map(() => "lifecycle-path-missing"),
  ]);
});

test("同じ経路の二重の振り分けと語彙外の経路名を落とす", () => {
  const dup = lifecycleOf({
    not_applicable_paths: [
      ...lifecycleOf().not_applicable_paths,
      { path: "strict-rebind", reason: "重複" },
    ],
  });
  expect(codes(checkLifecycle(dup))).toEqual(["lifecycle-path-duplicate"]);
  const unknown = lifecycleOf({ paths: [...lifecycleOf().paths, pathRow("hot-reload")] });
  expect(codes(checkLifecycle(unknown))).toEqual(["lifecycle-path-unknown"]);
});

test("検査が落ちた・経路に入っていない・直した処理を外した確認が無い経路を落とす", () => {
  const withRow = (override) =>
    lifecycleOf({ paths: [pathRow("strict-rebind", override), pathRow("prop-change-after-init")] });
  expect(codes(checkLifecycle(withRow({ result: "fail" })))).toEqual(["lifecycle-path-failed"]);
  for (const entered of [0, null, "1", 0.5]) {
    expect(codes(checkLifecycle(withRow({ entered })))).toEqual(["lifecycle-path-not-entered"]);
  }
  expect(codes(checkLifecycle(withRow({ fix_removal_verified: false })))).toEqual([
    "lifecycle-fix-removal-unverified",
  ]);
  expect(checkLifecycle(withRow({ story: "<順番を強制する見本の識別子>" })).findings).toEqual([
    expect.objectContaining({ code: "lifecycle-path-incomplete", missing: ["story"] }),
  ]);
});

test("名指しできない経路の理由が無ければ落とす", () => {
  const na = lifecycleOf({
    not_applicable_paths: [
      { path: "prop-identity", reason: "<名指しできない理由>" },
      lifecycleOf().not_applicable_paths[1],
    ],
  });
  expect(codes(checkLifecycle(na))).toEqual(["lifecycle-na-reason-missing"]);
});

test("lifecycle が無い・applies が真偽値でない・reason が無いのは型崩れ", () => {
  expect(checkLifecycle(undefined).structural).toBe(true);
  expect(checkLifecycle(lifecycleOf({ applies: "<対象か>" })).structural).toBe(true);
  expect(checkLifecycle(lifecycleOf({ reason: "" })).structural).toBe(true);
  expect(checkLifecycle(lifecycleOf({ paths: null })).structural).toBe(true);
});

test("同梱テンプレートをそのまま渡しても合格にしない", () => {
  const template = JSON.parse(
    readFileSync(
      join(repoRoot, "skills/parity-component/assets/build-metadata-template.json"),
      "utf8",
    ),
  );
  expect(checkLifecycle(template.lifecycle).structural).toBe(true);
});

test("CLI: 揃った記録で exit 0、経路の漏れで exit 1、引数の誤りは exit 2", () => {
  const dir = makeTempDir("lifecycle-check-");
  const file = join(dir, "build-metadata.json");
  writeFileSync(file, JSON.stringify({ lifecycle: lifecycleOf() }));
  const ok = spawnSync(process.execPath, [script, "--build-metadata", file], { encoding: "utf8" });
  expect(ok.status).toBe(0);
  expect(JSON.parse(ok.stdout)).toMatchObject({ tool: "lifecycle-check", ok: true, applies: true });
  writeFileSync(file, JSON.stringify({ lifecycle: lifecycleOf({ not_applicable_paths: [] }) }));
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
  expect(checkLifecycle(metadata.lifecycle)).toEqual({
    structural: false,
    applies: false,
    findings: [],
  });
});
