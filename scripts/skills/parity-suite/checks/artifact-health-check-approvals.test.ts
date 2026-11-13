// artifact-health-check.mjs --stage diff --target の、操作中のエラーの承認の照合（Issue #1007）。
//
// parity-diff の diff-metadata.json の runtime_errors.new_signatures[] の分類の欄は、compare --write と実行のたびの書き直しで変わる。
// そのため、利用者が承認していない許容と環境ノイズを欄に書くと、欄だけでは承認を経ずに収束できる。
// 同じファイルの追記専用の承認の記録（approvals）と照合し、同じ値の要素が無ければ落とす。
// parity-diff は承認を原因ごとに 1 回取り、新側のバージョンをまたいで持つので、tree は照合しない（spec-parity と違う）。

import { test, expect } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonAs } from "../../../lib/parse-as.ts";
import { makeProject, run, writeStage } from "./artifact-health-check-helpers.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const TEST = "e2e/parity/order-list/orders.spec.ts > 一覧を開く";

const allowance = (over: Record<string, unknown> = {}) => ({
  test: TEST,
  id: "sig-1",
  kind: "console-error",
  text: "新側だけのエラー",
  classification: "許容",
  reason: "現行の不具合を直した結果",
  approved_at: "2026-11-13T00:00:00Z",
  evidence: null,
  ...over,
});

const noise = (over: Record<string, unknown> = {}) =>
  allowance({
    id: "sig-2",
    classification: "環境ノイズ",
    reason: null,
    approved_at: null,
    evidence: "stg だけの CDN への通信で出る。local-dev では出ない",
    ...over,
  });

const allowanceLog = (over: Record<string, unknown> = {}) => ({
  kind: "runtime_errors",
  test: TEST,
  id: "sig-1",
  classification: "許容",
  approved_by: "owner",
  approved_at: "2026-11-13T00:00:00Z",
  reason: "現行の不具合を直した結果",
  ...over,
});

const noiseLog = (over: Record<string, unknown> = {}) => ({
  kind: "runtime_errors",
  test: TEST,
  id: "sig-2",
  classification: "環境ノイズ",
  approved_by: "owner",
  approved_at: "2026-11-13T00:00:00Z",
  evidence: "stg だけの CDN への通信で出る。local-dev では出ない",
  ...over,
});

/** 現側の metadata.json に runtime_errors を書かない（操作中のエラーを記録する前の成果物）ことを表す。 */
const NO_CURRENT = Symbol("no-current");

/**
 * 工程の節のほかは条件を満たす成果物に、操作中のエラーの比較の結果と承認の記録を置いて判定する。
 * 現側の metadata.json は、比較の結果を持つ実際の形（runtime_errors.declared: true）をデフォルトにする。
 * @param diffExtra diff-metadata.json に足す欄（runtime_errors・approvals）
 * @param currentRuntimeErrors 現側の metadata.json の runtime_errors（NO_CURRENT なら書かない）
 */
function judge(
  diffExtra: Record<string, unknown>,
  currentRuntimeErrors: unknown = { declared: true },
) {
  const { root, slugDir, metadataPath } = makeProject((m) => {
    if (currentRuntimeErrors !== NO_CURRENT)
      Object.assign(m, { runtime_errors: currentRuntimeErrors });
  });
  writeStage(slugDir, { dataset_version: 7, converged: true, ...diffExtra });
  const r = run(metadataPath, ["--target", "local-dev", "--stage", "diff"]);
  rmSync(root, { recursive: true, force: true });
  return r;
}

const compared = (sigs: unknown[]) => ({ judged: true, ok: true, new_signatures: sigs });
// 承認待ちの所見は [approval] で始まる（parity-diff はこの所見を parity-suite へ戻さない）
const APPROVAL_FINDING =
  /warn: \[approval\] 操作中のエラーの分類の承認が、承認の記録（approvals）に同じ値で積まれていない/;

test("誤検知しないことの確認: 許容と環境ノイズの承認が approvals に同じ値で積まれていれば通す", () => {
  const r = judge({
    runtime_errors: compared([allowance(), noise()]),
    approvals: [allowanceLog(), noiseLog()],
  });
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
});

test("誤検知しないことの確認: 新側のバージョンが変わっても、承認は持ち越す（tree を照合しない）", () => {
  const r = judge({
    runtime_errors: compared([allowance()]),
    approvals: [allowanceLog({ tree: "0".repeat(40) })],
  });
  expect(r.status).toBe(0);
});

test.each([
  ["要対応", { classification: "要対応" }],
  ["分類の無い署名", { classification: null }],
  ["承認の前の許容（許容候補）", { approved_at: null }],
])("誤検知しないことの確認: %s は承認を照合しない（compare の ok が止める）", (_name, over) => {
  const r = judge({ runtime_errors: compared([allowance(over)]), approvals: [] });
  expect(r.stdout).not.toMatch(APPROVAL_FINDING);
  expect(r.status).toBe(0);
});

test.each([
  ["runtime_errors が無い（操作中のエラーを比べる前の成果物）", {}],
  [
    "runtime_errors.judged が false（declared: false）",
    { runtime_errors: { judged: false, reason: "現側で記録しなかった" } },
  ],
  [
    "runtime_errors.judged が雛形のプレースホルダのまま",
    { runtime_errors: { judged: "<true | false>", new_signatures: [allowance()] } },
  ],
])(
  "現側の metadata.json が runtime_errors を持たない成果物で、%s なら照合せず、理由を注記に残す",
  (_name, extra) => {
    const r = judge(extra, NO_CURRENT);
    expect(r.stdout).toMatch(/操作中のエラーの承認を照合しない/);
    expect(r.status).toBe(0);
  },
);

test.each([
  ["approvals をキーごと持たない（承認の記録を始める前の記録）", undefined],
  ["approvals が空", []],
  [
    "許容を環境ノイズに書き換えて、許容の承認しか無い（根拠も同じ値の要素）",
    [allowanceLog({ id: "sig-2", evidence: noise().evidence })],
  ],
  ["環境ノイズの承認の後に根拠を書き換えた", [noiseLog({ evidence: "書き換えた根拠" })]],
  ["承認した人（approved_by）の無い要素しか無い", [noiseLog({ approved_by: undefined })]],
  ["承認した人が雛形の値のままの要素しか無い", [noiseLog({ approved_by: "<承認した人>" })]],
  ["kind が runtime_errors でない要素しか無い", [noiseLog({ kind: "design_review" })]],
  ["別のテストの要素しか無い", [noiseLog({ test: "別のテスト" })]],
  ["承認の日時（approved_at）の無い要素しか無い", [noiseLog({ approved_at: undefined })]],
  ["承認の日時が雛形の値のままの要素しか無い", [noiseLog({ approved_at: "<承認した日時>" })]],
  ["classification の無い要素しか無い", [noiseLog({ classification: undefined })]],
  ["オブジェクトでない要素しか無い", [null, "noise", [noiseLog()]]],
])("環境ノイズが %s なら、承認待ちとして落とす（exit 2 にしない）", (_name, approvals) => {
  const r = judge({ runtime_errors: compared([noise()]), approvals });
  expect(r.stdout).toMatch(APPROVAL_FINDING);
  expect(r.stdout).toMatch(/環境ノイズ/);
  expect(r.status).toBe(1);
});

test.each([
  ["approvals をキーごと持たない（承認の記録を始める前の記録）", undefined, {}],
  ["承認の後に理由を書き換えた", [allowanceLog()], { reason: "書き換えた理由" }],
  ["承認の後に日時を書き換えた", [allowanceLog()], { approved_at: "2026-11-14T00:00:00Z" }],
  [
    "環境ノイズを許容に書き換えて、環境ノイズの承認しか無い（理由と日時も同じ値の要素）",
    [noiseLog({ id: "sig-1", reason: allowance().reason })],
    {},
  ],
  ["別の署名の要素しか無い", [allowanceLog({ id: "sig-9" })], {}],
])("許容が %s なら、承認待ちとして落とす", (_name, approvals, over) => {
  const r = judge({ runtime_errors: compared([allowance(over)]), approvals });
  expect(r.stdout).toMatch(APPROVAL_FINDING);
  expect(r.status).toBe(1);
});

test.each([
  ["classification の無い要素", allowanceLog({ classification: undefined })],
  ["classification: 許容 の要素", allowanceLog()],
])("誤検知しないことの確認: 許容は %s を承認として数える", (_name, log) => {
  const r = judge({ runtime_errors: compared([allowance()]), approvals: [log] });
  expect(r.status).toBe(0);
});

test("誤検知しないことの確認: オブジェクトでない署名は承認を照合しない（compare の ok が止める）", () => {
  const r = judge({ runtime_errors: compared(["読めない署名", null]), approvals: [] });
  expect(r.stdout).not.toMatch(APPROVAL_FINDING);
  expect(r.status).toBe(0);
});

test("署名に id が無ければ、同じ欄の無い承認とも一致させない", () => {
  const r = judge({
    runtime_errors: compared([allowance({ id: undefined })]),
    approvals: [allowanceLog({ id: undefined })],
  });
  expect(r.stdout).toMatch(APPROVAL_FINDING);
  expect(r.status).toBe(1);
});

test("前の diff-metadata.json の approvals を書き戻し忘れた記録を、承認待ちとして落とす", () => {
  // 雛形から作り直すと approvals は空の配列になり、前の実行で積んだ承認が消える。分類の欄は compare が持ち越す
  const r = judge({ runtime_errors: compared([allowance(), noise()]), approvals: [] });
  expect(r.stdout.match(new RegExp(APPROVAL_FINDING.source, "g"))?.length).toBe(2);
  expect(r.status).toBe(1);
});

test.each([
  ["approvals が配列でない", { runtime_errors: compared([]), approvals: {} }],
  ["runtime_errors がオブジェクトでない", { runtime_errors: [] }],
  ["new_signatures が配列でない", { runtime_errors: { judged: true, new_signatures: {} } }],
])("%s なら型の誤りとして exit 2", (_name, extra) => {
  expect(judge(extra).status).toBe(2);
});

test("--target を渡さなければ工程の節ごと判定しない（承認も照合しない）", () => {
  const { root, slugDir, metadataPath } = makeProject();
  writeStage(slugDir, {
    dataset_version: 7,
    runtime_errors: compared([noise()]),
    approvals: [],
  });
  const r = run(metadataPath, ["--stage", "diff"]);
  rmSync(root, { recursive: true, force: true });
  expect(r.stdout).not.toMatch(APPROVAL_FINDING);
  expect(r.status).toBe(0);
});

// 同梱の metadata-template.json の runtime_errors（利用者が始める形）をそのまま使う
const TEMPLATE_RUNTIME_ERRORS = parseJsonAs<{ runtime_errors: unknown }>(
  readFileSync(join(repoRoot, "skills/parity-suite/assets/metadata-template.json"), "utf8"),
).runtime_errors;
const EXEMPT = { declared: false, reason: "現側で記録しなかった" };
const NOT_JUDGED = { runtime_errors: { judged: false, reason: "現側で記録しなかった" } };
const TAGGED =
  /warn: \[runtime-errors\] diff-metadata\.json の runtime_errors（judged: .*）が、現側の metadata\.json の宣言（.*）と合わない/;

// 現側の宣言（runtimeErrorsDeclaration）× diff-metadata.json の比較の記録。照合するか、注記で通すか、[runtime-errors] の所見にするか
test.each([
  ["declared: true で比較の結果が無い", { declared: true }, {}],
  ["declared: true で judged: false", { declared: true }, NOT_JUDGED],
  ["declared: false と理由の組で runtime_errors が無い", EXEMPT, {}],
  [
    "declared: false と理由の組で judged: false に理由が無い",
    EXEMPT,
    { runtime_errors: { judged: false } },
  ],
  [
    "declared: false と理由の組で judged: false の理由が雛形の値のまま",
    EXEMPT,
    { runtime_errors: { judged: false, reason: "<理由>" } },
  ],
  [
    "declared: false と理由の組で judged が雛形の値のまま",
    EXEMPT,
    { runtime_errors: { judged: "<true | false>", reason: "現側で記録しなかった" } },
  ],
  [
    "declared: false と理由の組で judged が文字列の false",
    EXEMPT,
    { runtime_errors: { judged: "false", reason: "現側で記録しなかった" } },
  ],
  ["declared: false と理由の組なのに比較の結果がある", EXEMPT, { runtime_errors: compared([]) }],
  ["雛形の値のままで比較の結果が無い", TEMPLATE_RUNTIME_ERRORS, {}],
  [
    "雛形の値のままなのに比較の結果がある",
    TEMPLATE_RUNTIME_ERRORS,
    { runtime_errors: compared([]) },
  ],
  ["declared が真偽値でない", { declared: "yes" }, {}],
  ["declared: false に理由が無い", { declared: false }, NOT_JUDGED],
  ["declared: false の理由が雛形の値のまま", { declared: false, reason: "<理由>" }, NOT_JUDGED],
  ["runtime_errors がオブジェクトでない", "declared", {}],
])(
  "現側の metadata.json の %s なら、記録が宣言と合わないとして [runtime-errors] の所見にする",
  (_name, current, extra) => {
    const r = judge(extra, current);
    expect(r.stdout).toMatch(TAGGED);
    expect(r.stdout).not.toMatch(/操作中のエラーの承認を照合しない/);
    expect(r.status).toBe(1);
  },
);

test("誤検知しないことの確認: 現側の metadata.json が declared: false と理由の組で、diff-metadata.json が judged: false と理由なら通す", () => {
  const r = judge(NOT_JUDGED, EXEMPT);
  expect(r.stdout).toMatch(
    /runtime_errors\.declared: false のため、操作中のエラーの承認を照合しない/,
  );
  expect(r.status).toBe(0);
});

test("所見に、現側の宣言の値を残す（どの不備かを読めるようにする）", () => {
  const r = judge({}, { declared: false, reason: "<理由>" });
  expect(r.stdout).toContain('declared: false・reason: "<理由>"');
});

test.each([
  [
    "現側の metadata.json が runtime_errors を持たないのに、比較の結果がある",
    NO_CURRENT,
    { runtime_errors: compared([]) },
  ],
  [
    "mode が api-resource（雛形が runtime_errors を省く）",
    TEMPLATE_RUNTIME_ERRORS,
    { mode: "api-resource" },
  ],
  ["mode が batch（雛形が runtime_errors を省く）", { declared: false }, { mode: "batch" }],
])("誤検知しないことの確認: %s なら、照合せずに注記で通す", (_name, current, extra) => {
  const r = judge(extra, current);
  expect(r.stdout).toMatch(/操作中のエラーの承認を照合しない/);
  expect(r.status).toBe(0);
});

test.each([
  ["declared: true", { declared: true }, "runtime-errors.mjs compare --write を通し直す"],
  ["declared: false と理由の組", EXEMPT, "judged: false と reason を書く"],
  ["宣言の不備", { declared: false }, "parity-suite で基準を採り直す"],
])("[runtime-errors] の所見に、現側の宣言が %s のときの直し方を添える", (_name, current, fix) => {
  expect(judge({}, current).stdout).toContain(fix);
});
