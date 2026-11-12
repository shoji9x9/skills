// spec-parity verify の収束の判定（convergence-check.mjs）の回帰テスト（Issue #565）。
//
// 収束の条件は、スイート・横のはみ出し・操作中のエラー・デザインの点検の承認・人による確認の承認・判断待ちの 6 つで、
// どれもツールの出力か承認の記録だけで決める。起こりうる不具合は、どれか 1 つが欠けた・古い・読めないのに収束とすることである。
// そこで、収束する一式（verify-fixture.ts）から 1 か所だけを変えて条件を満たさなくした入力を 1 件ずつ置き、通る入力と同じ数だけ落とす入力を置く。
// 理由の分類（send-back・remeasure・approval）は、差し戻すかやり直すか待つかを決めるので、分類まで確かめる。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { main } from "../../../skills/spec-parity/scripts/convergence-check.mjs";
import { parseJsonAs } from "../../lib/parse-as.ts";
import {
  COMMIT,
  TREE,
  EDIT,
  Fs,
  LIST,
  NEW_DIR,
  SLUG_DIR,
  VERIFY,
  comparedOk,
  convergedFs,
  overflowRecords,
  report,
  strengthPlan,
  strengthReport,
  suiteMetadata,
  verifyMetadata,
} from "./verify-fixture.ts";

type Reason = { category: string; check: string; message: string };
type Out = {
  converged: boolean;
  send_back: boolean;
  reasons: Reason[];
  checks: Record<string, Record<string, unknown>>;
};

const ARGS = ["--slug-dir", SLUG_DIR, "--target", "stg"];

function run(fs: Fs, args: string[] = ARGS) {
  const { io, out } = fs.io();
  const code = main(args, io);
  return { code, ...out, result: code === 2 ? null : parseJsonAs<Out>(out.stdout) };
}

/** 理由を [category, check] の組にする。 */
const kinds = (r: ReturnType<typeof run>) =>
  (r.result?.reasons ?? []).map((x) => [x.category, x.check]);

const withVerify = (over: Record<string, unknown>) => {
  const fs = convergedFs();
  fs.put(VERIFY, verifyMetadata(over));
  return fs;
};

describe("収束する入力", () => {
  test("すべての記録がそろい、承認があれば exit 0 で、--write が converged: true を書く", () => {
    const fs = convergedFs();
    const r = run(fs, [...ARGS, "--write"]);
    expect(r.code).toBe(0);
    expect(r.result?.converged).toBe(true);
    const doc = fs.json<{ converged: boolean; design_review: unknown }>(VERIFY);
    expect(doc.converged).toBe(true);
    expect(doc.design_review).toBeTruthy();
  });

  test("--write が無ければ verify-metadata.json を書かない", () => {
    const fs = convergedFs();
    expect(run(fs).code).toBe(0);
    expect(fs.writes).toEqual([]);
  });

  test("デザインの指摘が 0 件でも、点検の記録があれば収束する", () => {
    const fs = withVerify({ design_review: { ...verifyMetadata().design_review, findings: [] } });
    expect(run(fs).code).toBe(0);
  });

  test("現行でスキップしたテストは、新側の結果に無くても比べない", () => {
    const fs = convergedFs();
    fs.put(
      `${SLUG_DIR}/suite-report.json`,
      report("current", [
        { file: "tests/orders/list.e2e.ts", title: "一覧を開く", status: "passed" },
        { file: "tests/orders/list.e2e.ts", title: "編集する", status: "passed" },
        { file: "tests/orders/list.e2e.ts", title: "未実装の機能", status: "skipped" },
      ]),
    );
    expect(run(fs).code).toBe(0);
  });

  test("承認済みの保留（settled）は収束を止めない", () => {
    const fs = withVerify({
      pending_decisions: [
        {
          id: "pd-1",
          blocks: ["design_review"],
          resolution: {
            answer: "受け入れる",
            answered_at: "2026-11-11T03:00:00Z",
            resumed: { at: "2026-11-11T04:00:00Z", evidence: ["verify-metadata.json"] },
          },
        },
      ],
    });
    expect(run(fs).code).toBe(0);
  });

  test("操作中のエラーを現側で記録しなかった機能は、未検証の一覧に理由があれば収束する", () => {
    const fs = convergedFs();
    fs.put(
      `${SLUG_DIR}/metadata.json`,
      suiteMetadata({ runtime_errors: { declared: false, reason: "init script を入れられない" } }),
    );
    fs.put(
      VERIFY,
      verifyMetadata({
        runtime_errors: undefined,
        unverified: [
          { item: "performance", reason: "確かめない" },
          { item: "runtime_errors", reason: "init script を入れられない" },
        ],
      }),
    );
    expect(run(fs).code).toBe(0);
  });
});

describe("スイート", () => {
  test.each([
    ["failed", "send-back"],
    ["timed-out", "send-back"],
    ["flaky", "send-back"],
    ["skipped", "send-back"],
  ])("新側の結果が %s なら %s", (status, category) => {
    const fs = convergedFs();
    fs.put(
      `${NEW_DIR}/suite-report.json`,
      report("new", [
        { file: "tests/orders/list.e2e.ts", title: "一覧を開く", status: "passed" },
        { file: "tests/orders/list.e2e.ts", title: "編集する", status },
      ]),
    );
    const r = run(fs);
    expect(r.code).toBe(1);
    expect(kinds(r)).toEqual([[category, "suite"]]);
    expect(r.result?.send_back).toBe(true);
  });

  test("現行の結果のテストがすべてスキップなら、比べるテストが 0 件なので exit 2", () => {
    const fs = convergedFs();
    fs.put(
      `${SLUG_DIR}/suite-report.json`,
      report("current", [
        { file: "tests/orders/list.e2e.ts", title: "一覧を開く", status: "skipped" },
        { file: "tests/orders/list.e2e.ts", title: "編集する", status: "skipped" },
      ]),
    );
    const r = run(fs);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("すべてスキップ");
  });

  test("新側の結果に無いテストは、やり直しとして exit 1", () => {
    const fs = convergedFs();
    fs.put(
      `${NEW_DIR}/suite-report.json`,
      report("new", [{ file: "tests/orders/list.e2e.ts", title: "一覧を開く", status: "passed" }]),
    );
    const r = run(fs);
    expect(r.code).toBe(1);
    expect(kinds(r)).toEqual([["remeasure", "suite"]]);
    expect(r.result?.reasons[0]?.message).toContain(EDIT);
  });

  test("新側の結果で選ばれなかったテストは、結果に無いものとして扱う", () => {
    const fs = convergedFs();
    fs.put(
      `${NEW_DIR}/suite-report.json`,
      report("new", [
        { file: "tests/orders/list.e2e.ts", title: "一覧を開く", status: "passed" },
        { file: "tests/orders/list.e2e.ts", title: "編集する", status: "skipped", selected: false },
      ]),
    );
    expect(kinds(run(fs))).toEqual([["remeasure", "suite"]]);
  });

  test("現行の結果に無いテストが新側にあれば、スイートが変わったのでやり直す", () => {
    const fs = convergedFs();
    fs.put(
      `${NEW_DIR}/suite-report.json`,
      report("new", [
        { file: "tests/orders/list.e2e.ts", title: "一覧を開く", status: "passed" },
        { file: "tests/orders/list.e2e.ts", title: "編集する", status: "passed" },
        { file: "tests/orders/list.e2e.ts", title: "追加した", status: "passed" },
      ]),
    );
    expect(kinds(run(fs))).toEqual([["remeasure", "suite"]]);
  });

  test("スイートを実行したバージョンが new.tree と違えば、古い記録としてやり直す", () => {
    const fs = withVerify({ suite: { tree: "old" } });
    expect(kinds(run(fs))).toEqual([["remeasure", "suite"]]);
  });

  test("スイートの記録に tree が無ければ（commit だけの古い記録）、commit が同じでももう一度測る", () => {
    const r = run(withVerify({ suite: { commit: COMMIT } }));
    expect(kinds(r)).toEqual([["remeasure", "suite"]]);
    expect(r.stdout).toContain("もう一度測る");
  });

  test.each([
    [
      "現行の結果が通っていない",
      "current",
      report("current", [{ file: "a.e2e.ts", title: "x", status: "failed" }]),
    ],
    ["現行の結果に選ばれたテストが 0 件", "current", report("current", [])],
    ["新側の結果に選ばれたテストが 0 件", "new", report("new", [])],
    ["schemaVersion が違う", "new", { schemaVersion: "report-2", run: { results: [] } }],
  ])("%s なら判定せずに exit 2", (_name, side, value) => {
    const fs = convergedFs();
    fs.put(
      side === "current" ? `${SLUG_DIR}/suite-report.json` : `${NEW_DIR}/suite-report.json`,
      value,
    );
    expect(run(fs).code).toBe(2);
  });
});

describe("横のはみ出し", () => {
  test("測定の記録ではみ出しがあれば、verify-metadata.json の ok を信じずに差し戻す", () => {
    const fs = convergedFs();
    const rec = overflowRecords();
    rec.records = rec.records.map((x, i) => (i === 0 ? { ...x, scroll_width: 500 } : x));
    fs.put(`${NEW_DIR}/overflow.json`, rec);
    fs.put(VERIFY, verifyMetadata({ overflow: { ok: true } }));
    const r = run(fs);
    expect(r.code).toBe(1);
    expect(kinds(r)).toEqual([["send-back", "overflow"]]);
  });

  test("測定の記録が無ければ、やり直しとして exit 1", () => {
    const fs = convergedFs();
    fs.remove(`${NEW_DIR}/overflow.json`);
    expect(kinds(run(fs))).toEqual([["remeasure", "overflow"]]);
  });

  test("宣言した幅の測定が欠ければ、やり直しとして exit 1", () => {
    const fs = convergedFs();
    const rec = overflowRecords();
    fs.put(`${NEW_DIR}/overflow.json`, { ...rec, records: rec.records.slice(0, 1) });
    expect(kinds(run(fs))).toEqual([["remeasure", "overflow"]]);
  });

  test("測ったバージョン（PARITY_COMMIT で渡した値）が new.tree と違えば、古い記録としてやり直す", () => {
    const fs = convergedFs();
    fs.put(`${NEW_DIR}/overflow.json`, overflowRecords({ commit: "old" }));
    expect(kinds(run(fs))).toEqual([["remeasure", "overflow"]]);
  });

  test("new.commit の値で測った記録（new.tree を渡す前の記録）は、古い記録としてやり直す", () => {
    const fs = convergedFs();
    fs.put(`${NEW_DIR}/overflow.json`, overflowRecords({ commit: COMMIT }));
    expect(kinds(run(fs))).toEqual([["remeasure", "overflow"]]);
  });
});

describe("操作中のエラー", () => {
  const sig = (over: Record<string, unknown>) => ({
    test: LIST,
    id: "x",
    kind: "console-error",
    text: "新側だけのエラー",
    ...over,
  });

  test.each([
    ["要対応", "send-back", { classification: "要対応" }],
    ["分類が無い", "approval", {}],
    ["許容で承認の日時が無い", "approval", { classification: "許容", reason: "既知" }],
    ["環境ノイズで根拠が無い", "approval", { classification: "環境ノイズ" }],
  ])("現行に無かったエラーが %s なら %s（保存された ok は信じない）", (_name, category, cls) => {
    const fs = withVerify({
      runtime_errors: { ...comparedOk(), ok: true, new_signatures: [sig(cls)] },
    });
    const r = run(fs);
    expect(r.code).toBe(1);
    expect(kinds(r)).toEqual([[category, "runtime_errors"]]);
  });

  test("承認した許容と、根拠のある環境ノイズは収束を止めない", () => {
    const fs = withVerify({
      runtime_errors: {
        ...comparedOk(),
        new_signatures: [
          sig({ classification: "許容", reason: "既知", approved_at: "2026-11-11T00:00:00Z" }),
          sig({ id: "y", classification: "環境ノイズ", evidence: "stg だけの CDN" }),
        ],
      },
    });
    expect(run(fs).code).toBe(0);
  });

  test.each([
    ["missing_tests", "remeasure"],
    ["failed_tests", "send-back"],
    ["extra_tests", "remeasure"],
    ["skipped_tests", "remeasure"],
  ])("compare の %s が空でなければ %s", (key, category) => {
    const fs = withVerify({ runtime_errors: { ...comparedOk(), [key]: [EDIT] } });
    expect(kinds(run(fs))).toEqual([[category, "runtime_errors"]]);
  });

  test("比較の結果が無ければ、やり直しとして exit 1", () => {
    const fs = withVerify({ runtime_errors: undefined });
    expect(kinds(run(fs))).toEqual([["remeasure", "runtime_errors"]]);
  });

  test("runtime-errors.mjs のバージョンが違う結果は、判定せずに exit 2", () => {
    const fs = withVerify({ runtime_errors: { ...comparedOk(), version: "0" } });
    expect(run(fs).code).toBe(2);
  });

  test("現側で記録しなかった機能で、未検証の一覧に runtime_errors が無ければ exit 1", () => {
    const fs = convergedFs();
    fs.put(
      `${SLUG_DIR}/metadata.json`,
      suiteMetadata({ runtime_errors: { declared: false, reason: "理由" } }),
    );
    expect(kinds(run(fs))).toEqual([["remeasure", "unverified"]]);
  });
});

describe("デザインの点検と人による確認", () => {
  const review = (over: Record<string, unknown>) => ({
    ...verifyMetadata().design_review,
    ...over,
  });
  const finding = (over: Record<string, unknown>) => ({ id: "dr-1", rule: "r", ...over });

  test.each([
    ["直す", "send-back", finding({ decision: "fix" })],
    ["受け入れるが承認が無い", "approval", finding({ decision: "accept" })],
    [
      "受け入れるが理由が無い",
      "approval",
      finding({ decision: "accept", approval: { approved_by: "o", approved_at: "t" } }),
    ],
    ["分けていない", "approval", finding({})],
  ])("指摘を %s なら %s", (_name, category, f) => {
    const fs = withVerify({ design_review: review({ findings: [f] }) });
    expect(kinds(run(fs))).toEqual([[category, "design_review"]]);
  });

  test("点検の記録が無ければ、やり直しとして exit 1", () => {
    const fs = withVerify({ design_review: { findings: [] } });
    expect(kinds(run(fs))).toEqual([["remeasure", "design_review"]]);
  });

  test("点検したバージョンが new.tree と違えば、古い記録としてやり直す", () => {
    const fs = withVerify({ design_review: review({ tree: "old" }) });
    expect(kinds(run(fs))).toEqual([["remeasure", "design_review"]]);
  });

  test("点検の記録に tree が無ければ（commit だけの古い記録）、もう一度測る", () => {
    const old: Record<string, unknown> = review({ commit: COMMIT });
    delete old.tree;
    expect(kinds(run(withVerify({ design_review: old })))).toEqual([
      ["remeasure", "design_review"],
    ]);
  });

  test.each([
    ["source が語彙の外", review({ source: "model" })],
    ["点検したページが空", review({ pages_reviewed: [] })],
    [
      "指摘の id が重複",
      review({ findings: [finding({ decision: "fix" }), finding({ decision: "fix" })] }),
    ],
  ])("点検の記録の %s なら exit 2", (_name, dr) => {
    expect(run(withVerify({ design_review: dr })).code).toBe(2);
  });

  const human = (approval: unknown, over: Record<string, unknown> = {}) => ({
    tree: TREE,
    screens: [{ page: "/orders" }],
    approval,
    ...over,
  });

  test.each([
    [
      "却下",
      "send-back",
      { verdict: "rejected", approved_by: "o", approved_at: "t", notes: "表が詰まる" },
    ],
    ["承認の記録が無い", "approval", null],
    ["承認した人が無い", "approval", { verdict: "approved", approved_at: "t" }],
  ])("人による確認が %s なら %s", (_name, category, approval) => {
    const fs = withVerify({ human_review: human(approval) });
    expect(kinds(run(fs))).toEqual([[category, "human_review"]]);
  });

  test("人に見せた画面の記録が無ければ、やり直しとして exit 1", () => {
    const fs = withVerify({
      human_review: human(
        { verdict: "approved", approved_by: "o", approved_at: "t" },
        { screens: [] },
      ),
    });
    expect(kinds(run(fs))).toEqual([["remeasure", "human_review"]]);
  });

  test("承認した画面のバージョンが new.tree と違えば、古い記録としてやり直す", () => {
    const fs = withVerify({
      human_review: human(
        { verdict: "approved", approved_by: "o", approved_at: "t" },
        { tree: "old" },
      ),
    });
    expect(kinds(run(fs))).toEqual([["remeasure", "human_review"]]);
  });

  test("承認した画面の記録に tree が無ければ（commit だけの古い記録）、もう一度測る", () => {
    const { tree: _t, ...old } = human(
      { verdict: "approved", approved_by: "o", approved_at: "t" },
      { commit: COMMIT },
    );
    expect(kinds(run(withVerify({ human_review: old })))).toEqual([["remeasure", "human_review"]]);
  });
});

describe("未検証の一覧と判断待ち", () => {
  test("未検証の一覧に performance が無ければ exit 1", () => {
    const fs = withVerify({ unverified: [] });
    expect(kinds(run(fs))).toEqual([["remeasure", "unverified"]]);
  });

  test("未検証の項目に理由が無ければ exit 2", () => {
    expect(run(withVerify({ unverified: [{ item: "performance" }] })).code).toBe(2);
  });

  test.each([
    ["回答が無い（open）", { id: "pd-1", blocks: ["x"], resolution: null }],
    [
      "回答はあるが工程を終えていない（decided）",
      { id: "pd-1", blocks: ["x"], resolution: { answer: "a", answered_at: "t" } },
    ],
    [
      "実施の記録の証拠が空の文字列だけ（decided）",
      {
        id: "pd-1",
        blocks: ["x"],
        resolution: { answer: "a", answered_at: "t", resumed: { at: "t", evidence: [""] } },
      },
    ],
  ])("保留が %s なら承認待ちとして exit 1", (_name, p) => {
    const fs = withVerify({ pending_decisions: [p] });
    expect(kinds(run(fs))).toEqual([["approval", "pending_decisions"]]);
  });

  test("回答があり blocks が空の保留は settled として扱う", () => {
    const fs = withVerify({
      pending_decisions: [
        { id: "pd-1", blocks: [], resolution: { answer: "a", answered_at: "t" } },
      ],
    });
    expect(run(fs).code).toBe(0);
  });

  test("pending_decisions が無ければ exit 2（保留が無いことと記録が無いことを区別する）", () => {
    expect(run(withVerify({ pending_decisions: undefined })).code).toBe(2);
  });
});

const withUnmeasured = (unmeasured: unknown) => {
  const fs = convergedFs();
  fs.put(`${SLUG_DIR}/metadata.json`, suiteMetadata({ unmeasured }));
  return fs;
};

const entry = (over: Record<string, unknown> = {}) => ({
  item: "PATCH /api/orders/:id の要求単位",
  reason: "失敗時に巻き戻す範囲を観測できなかった",
  endpoint: "PATCH /api/orders/:id",
  disposition: "blocking",
  approved_by: null,
  approved_at: null,
  ...over,
});

const accepted = (over: Record<string, unknown> = {}) =>
  entry({
    disposition: "accepted",
    approved_by: "owner",
    approved_at: "2026-11-11T03:00:00Z",
    ...over,
  });

const declared = (...entries: unknown[]) => ({ declared: true, entries, reason: null });

describe("未測定の宣言（metadata.json の unmeasured）", () => {
  test.each([
    ["キーごと無い（宣言の導入前の成果物）", undefined],
    ["declared: false と理由", { declared: false, entries: [], reason: "API を持たない機能" }],
    ["declared: true で entries が空", declared()],
    [
      "declared: false なら entries の blocking を読まない",
      { declared: false, entries: [entry()], reason: "API を持たない機能" },
    ],
    ["承認の記録がある accepted だけ", declared(accepted())],
  ])("%s なら収束する", (_name, unmeasured) => {
    const fs = unmeasured === undefined ? convergedFs() : withUnmeasured(unmeasured);
    const r = run(fs);
    expect(r.code).toBe(0);
    expect(r.result?.converged).toBe(true);
  });

  test("キーごと無いときは、判定しなかったことと理由を checks に残す", () => {
    const r = run(convergedFs());
    const checks = r.result?.checks ?? {};
    expect(checks.unmeasured?.judged).toBe(false);
    expect(String(checks.unmeasured?.reason)).toContain("キーごと持たない");
  });

  test("blocking が 1 件でも残れば、やり直しとして exit 1 になり、1 件目と件数を checks に残す", () => {
    const r = run(withUnmeasured(declared(accepted({ item: "別の口" }), entry())));
    expect(r.code).toBe(1);
    expect(kinds(r)).toEqual([["remeasure", "unmeasured"]]);
    const checks = r.result?.checks ?? {};
    expect(checks.unmeasured).toMatchObject({ judged: true, entries: 2, blocking: 1 });
  });

  test("--write は、blocking があるとき converged: false を書く", () => {
    const fs = withUnmeasured(declared(entry()));
    expect(run(fs, [...ARGS, "--write"]).code).toBe(1);
    expect(fs.json<{ converged: boolean }>(VERIFY).converged).toBe(false);
  });

  test.each([
    ["disposition が語彙の外", entry({ disposition: "later" })],
    ["disposition が無い", entry({ disposition: undefined })],
    ["disposition が文字列でない", entry({ disposition: true })],
    ["item が空", accepted({ item: "  " })],
    ["item が文字列でない", accepted({ item: 3 })],
    ["reason が空", accepted({ reason: "" })],
  ])("%s の宣言は blocking として数え、やり直しにする", (_name, e) => {
    const r = run(withUnmeasured(declared(e)));
    expect(r.code).toBe(1);
    expect(kinds(r)).toEqual([["remeasure", "unmeasured"]]);
  });

  test("item が重複した宣言は、先勝ちにせず blocking として数える", () => {
    const r = run(withUnmeasured(declared(accepted(), accepted())));
    expect(r.code).toBe(1);
    expect(kinds(r)).toEqual([["remeasure", "unmeasured"]]);
  });

  test.each([
    ["approved_by が null", accepted({ approved_by: null })],
    ["approved_at が空", accepted({ approved_at: "" })],
    ["承認の日時が雛形の値のまま", accepted({ approved_at: "<承認日時（ISO 8601）>" })],
  ])("accepted でも %s なら、承認待ちとして exit 1", (_name, e) => {
    const r = run(withUnmeasured(declared(e)));
    expect(r.code).toBe(1);
    expect(kinds(r)).toEqual([["approval", "unmeasured"]]);
  });

  test.each([
    ["unmeasured が配列", []],
    ["unmeasured が文字列", "none"],
    ["unmeasured が null", null],
    ["declared が無い", { entries: [] }],
    ["declared が文字列", { declared: "true", entries: [] }],
    ["declared: false に reason が無い", { declared: false, entries: [] }],
    ["declared: false の reason が空白", { declared: false, reason: "  " }],
    ["entries が無い", { declared: true }],
    ["entries が配列でない", { declared: true, entries: {} }],
    ["entries の要素がオブジェクトでない", declared("x")],
    ["entries の要素が null", declared(null)],
  ])("%s なら判定できず exit 2", (_name, unmeasured) => {
    const r = run(withUnmeasured(unmeasured));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unmeasured");
  });

  test("同梱の雛形の unmeasured をそのまま使っても収束を止めない（宣言する未測定が無い状態）", () => {
    const template = parseJsonAs<{ unmeasured: unknown }>(readFileSync(METADATA_TEMPLATE, "utf8"));
    const r = run(withUnmeasured(template.unmeasured));
    expect(r.code).toBe(0);
  });
});

describe("前提の欠落（exit 2）", () => {
  test.each([
    ["style_policy が reproduce", { style_policy: "reproduce" }],
    ["mode が api-resource", { mode: "api-resource" }],
    ["runner が playwright", { suite: { runner: "playwright", current_green: true } }],
    ["現行が green でない", { suite: { runner: "e2e", current_green: false } }],
    ["強度を確かめていない", { strength: { validated: false } }],
    ["slug がディレクトリと違う", { slug: "other" }],
    ["runtime_errors が無い", { runtime_errors: undefined }],
    ["declared: false に理由が無い", { runtime_errors: { declared: false } }],
  ])("metadata.json の %s", (_name, over) => {
    const fs = convergedFs();
    fs.put(`${SLUG_DIR}/metadata.json`, suiteMetadata(over));
    expect(run(fs).code).toBe(2);
  });

  test.each([
    ["metadata.json", `${SLUG_DIR}/metadata.json`],
    ["strength-plan.json", `${SLUG_DIR}/strength-plan.json`],
    ["strength-report.json", `${SLUG_DIR}/strength-report.json`],
    ["replace-metadata.json", `${NEW_DIR}/replace-metadata.json`],
    ["verify-metadata.json", VERIFY],
    ["現行の結果", `${SLUG_DIR}/suite-report.json`],
    ["新側の結果", `${NEW_DIR}/suite-report.json`],
  ])("%s が無い", (_name, path) => {
    const fs = convergedFs();
    fs.remove(path);
    expect(run(fs).code).toBe(2);
  });

  test("strength.validated が true でも、強度の結果で故障が緑のままなら、判定し直して exit 2", () => {
    const fs = convergedFs();
    fs.put(`${SLUG_DIR}/strength-report.json`, strengthReport("passed"));
    const r = run(fs);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("強度の確認が通らない");
  });

  test("強度の計画の slug が機能と違えば exit 2", () => {
    const fs = convergedFs();
    fs.put(`${SLUG_DIR}/strength-plan.json`, { ...strengthPlan(), slug: "other" });
    expect(run(fs).code).toBe(2);
  });

  // 記録を識別する鍵ごとに、別の値・欠落・型の誤りを置く。どれも一致しないものとして止まる
  const green = () => ({
    slug: "orders",
    suite: { new_green: true },
    new: { target: "stg", commit: COMMIT, tree: TREE, dirty: false },
  });
  test.each([
    [
      "slug が別の値",
      (g: ReturnType<typeof green>) => ({ ...g, slug: "invoices" }),
      "replace-metadata.json の slug（",
    ],
    [
      "slug が無い",
      ({ slug: _s, ...g }: ReturnType<typeof green>) => g,
      "replace-metadata.json の slug（",
    ],
    [
      "slug が文字列でない",
      (g: ReturnType<typeof green>) => ({ ...g, slug: 1 }),
      "replace-metadata.json の slug（",
    ],
    [
      "new.target が別の値",
      (g: ReturnType<typeof green>) => ({ ...g, new: { ...g.new, target: "prod" } }),
      "replace-metadata.json の new.target（",
    ],
    [
      "new.target が無い",
      (g: ReturnType<typeof green>) => ({
        ...g,
        new: { commit: COMMIT, tree: TREE, dirty: false },
      }),
      "replace-metadata.json の new.target（",
    ],
    [
      "new.target が文字列でない",
      (g: ReturnType<typeof green>) => ({ ...g, new: { ...g.new, target: null } }),
      "replace-metadata.json の new.target（",
    ],
    [
      "new.tree が別の値",
      (g: ReturnType<typeof green>) => ({ ...g, new: { ...g.new, tree: "old" } }),
      "replace-metadata.json の new.tree（",
    ],
    [
      "new.tree が無い（new.commit は同じ古い記録）",
      (g: ReturnType<typeof green>) => ({
        ...g,
        new: { target: "stg", commit: COMMIT, dirty: false },
      }),
      "もう一度 parity-replace で green を記録し直す",
    ],
    [
      "new.tree が文字列でない",
      (g: ReturnType<typeof green>) => ({ ...g, new: { ...g.new, tree: 1 } }),
      "replace-metadata.json の new.tree（",
    ],
    [
      "new.dirty が true",
      (g: ReturnType<typeof green>) => ({ ...g, new: { ...g.new, dirty: true } }),
      "new.dirty が false でない",
    ],
    [
      "new.dirty が無い",
      (g: ReturnType<typeof green>) => ({
        ...g,
        new: { target: "stg", commit: COMMIT, tree: TREE },
      }),
      "new.dirty が false でない",
    ],
    [
      "new.dirty が真偽値でない",
      (g: ReturnType<typeof green>) => ({ ...g, new: { ...g.new, dirty: "false" } }),
      "new.dirty が false でない",
    ],
  ])(
    "parity-replace が green にした記録の %s なら、前提の欠落として exit 2",
    (_name, edit, message) => {
      const fs = convergedFs();
      fs.put(`${NEW_DIR}/replace-metadata.json`, edit(green()));
      const r = run(fs);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain(message);
    },
  );

  test("別の機能の記録が dirty: true でも、dirty より先に鍵の違いを示す", () => {
    const fs = convergedFs();
    fs.put(`${NEW_DIR}/replace-metadata.json`, {
      ...green(),
      slug: "invoices",
      new: { ...green().new, dirty: true },
    });
    const r = run(fs);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("replace-metadata.json の slug（");
    expect(r.stderr).not.toContain("new.dirty");
  });

  test("すべての記録の tree が none でも、verify-metadata.json の new.tree が none なら前提の欠落として exit 2", () => {
    // none どうしの比較は常に一致するので、この検査が無いと、どの記録も同じバージョンとして通って収束する
    const fs = withVerify({
      new: { commit: "none", tree: "none", dirty: false },
      suite: { tree: "none", report: `${NEW_DIR}/suite-report.json` },
      design_review: { ...verifyMetadata().design_review, tree: "none" },
      human_review: { ...verifyMetadata().human_review, tree: "none" },
    });
    fs.put(`${NEW_DIR}/overflow.json`, overflowRecords({ commit: "none" }));
    fs.put(`${NEW_DIR}/replace-metadata.json`, {
      ...green(),
      new: { target: "stg", commit: "none", tree: "none", dirty: false },
    });
    const r = run(fs);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("new.tree が none");
  });

  test("記録を commit して new.commit が進んでも、new.tree が同じなら収束する", () => {
    // 記録と新側を同じリポジトリに置く構成。記録の commit で HEAD は進むが、.replace/ を除いたツリーは変わらない
    const fs = withVerify({ new: { commit: "f".repeat(40), tree: TREE, dirty: false } });
    const r = run(fs);
    expect(r.code).toBe(0);
  });

  test("new.commit が同じでも、new.tree が green の記録と違えば前提の欠落として exit 2", () => {
    const fs = withVerify({ new: { commit: COMMIT, tree: "f".repeat(40), dirty: false } });
    const r = run(fs);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("replace-metadata.json の new.tree（");
  });

  test("parity-replace の新側の green が無ければ exit 2", () => {
    const fs = convergedFs();
    fs.put(`${NEW_DIR}/replace-metadata.json`, { suite: { new_green: false } });
    expect(run(fs).code).toBe(2);
  });

  test("verify-metadata.json の target が違えば exit 2", () => {
    expect(run(withVerify({ target: "prod" })).code).toBe(2);
  });

  test("new.tree が無ければ exit 2", () => {
    expect(run(withVerify({ new: {} })).code).toBe(2);
  });

  test("verify-metadata.json に new.commit だけがあり new.tree が無い古い記録は、もう一度測るとして exit 2", () => {
    const r = run(withVerify({ new: { commit: COMMIT, dirty: false } }));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("verify-metadata.json の new.tree が無い");
    expect(r.stderr).toContain("もう一度測る");
  });

  // verify の側の作業ツリーの状態。replace-metadata.json の new.dirty と同じく、false のときだけ通す
  test.each([
    ["true", { commit: COMMIT, tree: TREE, dirty: true }],
    ["無い", { commit: COMMIT, tree: TREE }],
    ["文字列", { commit: COMMIT, tree: TREE, dirty: "false" }],
    ["null", { commit: COMMIT, tree: TREE, dirty: null }],
  ])("verify-metadata.json の new.dirty が %s なら、前提の欠落として exit 2", (_name, head) => {
    const r = run(withVerify({ new: head }));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("verify-metadata.json の new.dirty が false でない");
  });

  test("verify-metadata.json の new.dirty が true でも、green の記録の鍵の違いを先に示す", () => {
    // 鍵の違いは commit しても直らないので、commit を促す dirty の理由より先に示す
    const fs = withVerify({ new: { commit: COMMIT, tree: TREE, dirty: true } });
    fs.put(`${NEW_DIR}/replace-metadata.json`, { ...green(), slug: "invoices" });
    const r = run(fs);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("replace-metadata.json の slug（");
    expect(r.stderr).not.toContain("verify-metadata.json の new.dirty");
  });

  test("verify-metadata.json の new.dirty の理由は、commit してやり直すだけでは止まることを示す", () => {
    const r = run(withVerify({ new: { commit: COMMIT, tree: TREE, dirty: true } }));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("pathspec");
    expect(r.stderr).toContain("parity-replace で green を記録し直して");
  });

  test("verify-metadata.json の new.dirty が false なら、dirty では止まらず収束する", () => {
    const r = run(withVerify({ new: { commit: COMMIT, tree: TREE, dirty: false } }));
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain("new.dirty");
  });

  test("--target の形が誤っていれば exit 2", () => {
    expect(run(convergedFs(), ["--slug-dir", SLUG_DIR, "--target", "../x"]).code).toBe(2);
  });

  test("判定できないとき --write は、前の converged: true を false に書き換える", () => {
    const fs = convergedFs();
    fs.put(VERIFY, verifyMetadata({ converged: true }));
    fs.remove(`${NEW_DIR}/suite-report.json`);
    expect(run(fs, [...ARGS, "--write"]).code).toBe(2);
    expect(fs.json<{ converged: boolean }>(VERIFY).converged).toBe(false);
  });
});

const METADATA_TEMPLATE = join(
  import.meta.dirname,
  "../../../skills/spec-parity/assets/metadata-template.json",
);

const TEMPLATE = join(
  import.meta.dirname,
  "../../../skills/spec-parity/assets/verify-metadata-template.json",
);

describe("同梱の雛形をそのまま使った記録", () => {
  test("verify-metadata の雛形の値のままでは収束しない（new.tree が雛形の値なので exit 2）", () => {
    const fs = convergedFs();
    fs.put(VERIFY, readFileSync(TEMPLATE, "utf8"));
    expect(run(fs).code).toBe(2);
  });

  test("new.tree を埋めても、new.dirty が雛形の値のままなら exit 2", () => {
    const fs = convergedFs();
    const doc = parseJsonAs<{ new: Record<string, unknown> }>(readFileSync(TEMPLATE, "utf8"));
    fs.put(VERIFY, {
      ...doc,
      slug: "orders",
      target: "stg",
      new: { ...doc.new, commit: COMMIT, tree: TREE },
    });
    const r = run(fs);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("verify-metadata.json の new.dirty が false でない");
  });

  test("new.tree と new.dirty だけを埋め、ほかを雛形の値のまま残すと、承認とやり直しを理由に exit 1", () => {
    const fs = convergedFs();
    const doc = parseJsonAs<Record<string, unknown>>(readFileSync(TEMPLATE, "utf8"));
    fs.put(VERIFY, {
      ...doc,
      slug: "orders",
      target: "stg",
      new: { commit: COMMIT, tree: TREE, dirty: false },
      suite: { tree: TREE },
    });
    const r = run(fs);
    expect(r.code).toBe(1);
    const checks = new Set(kinds(r).map(([, check]) => check));
    expect(checks).toEqual(new Set(["runtime_errors", "design_review", "human_review"]));
  });
});
