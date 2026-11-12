// spec-parity suite の強度の確認（strength-check.mjs）の回帰テスト（Issue #565）。
//
// 起こりうる不具合は「注入しても緑のままの故障を通す」「実行が止まっただけの故障を検出として数える」
// 「計画に挙げたのに実行していない故障を通す」「対照が赤いのに通す」の 4 つ。
// 結果の形は、e2e 0.23.0 の `.e2e/report.json` の実測（attempts[].error.code が ASSERTION_FAILED）に合わせる。

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { main } from "../../../skills/spec-parity/scripts/strength-check.mjs";
import { parseJsonAs } from "../../lib/parse-as.ts";
import { Fs } from "./verify-fixture.ts";

const PLAN = ".replace/parity/orders/strength-plan.json";
const REPORT = ".replace/parity/orders/strength-report.json";
const META = ".replace/parity/orders/metadata.json";
const FILE = "tests/orders/strength/faults.e2e.ts";

const CONTROL = `${FILE} › 対照: 注入しないと通る`;
const VALUE = `${FILE} › 故障: 応答の件数を変える`;
const HEADING = `${FILE} › 故障: 見出しの階層を変える`;

const plan = (over: Record<string, unknown> = {}) => ({
  version: "1",
  slug: "orders",
  controls: [CONTROL],
  faults: [
    { id: "f-value", class: "値・件数・並び", test: VALUE, observed: "行が 2 → 1 になった" },
    { id: "f-heading", class: "構造", test: HEADING, observed: "h1 が h2 に変わった" },
  ],
  ...over,
});

type Attempt = { status: string; error?: { code: string; message: string } };
const assertionFailed: Attempt = {
  status: "failed",
  error: { code: "ASSERTION_FAILED", message: "expect.toBeVisible failed" },
};

function result(title: string, status: string, attempts: Attempt[]) {
  return { file: FILE, titlePath: [title], targetId: "current", selected: true, status, attempts };
}

const report = (results: unknown[]) => ({
  schemaVersion: "report-1",
  run: { status: "failed", results },
});

const allGood = () => [
  result("対照: 注入しないと通る", "passed", [{ status: "passed" }]),
  result("故障: 応答の件数を変える", "failed", [assertionFailed]),
  result("故障: 見出しの階層を変える", "failed", [assertionFailed]),
];

function run(results: unknown[], planDoc: unknown = plan(), extra: string[] = []) {
  const fs = new Fs();
  fs.put(PLAN, planDoc);
  fs.put(REPORT, report(results));
  fs.put(META, { slug: "orders", strength: { validated: true } });
  const { io, out } = fs.io();
  const code = main(["--plan", PLAN, "--report", REPORT, ...extra], io);
  return { code, fs, out };
}

describe("strength-check の判定", () => {
  test("対照が通り、故障がすべて assertion で赤くなれば exit 0 で、--write が validated: true を書く", () => {
    const r = run(allGood(), plan(), ["--write", META]);
    expect(r.code).toBe(0);
    const doc = r.fs.json<{ strength: { validated: boolean; classes: string[] } }>(META);
    expect(doc.strength.validated).toBe(true);
    expect(doc.strength.classes).toEqual(["値・件数・並び", "構造"]);
  });

  test("注入しても緑のままの故障があれば exit 1 で、--write が validated: false を書く", () => {
    const results = allGood();
    results[2] = result("故障: 見出しの階層を変える", "passed", [{ status: "passed" }]);
    const r = run(results, plan(), ["--write", META]);
    expect(r.code).toBe(1);
    expect(r.fs.json<{ strength: { validated: boolean } }>(META).strength.validated).toBe(false);
    expect(r.out.stderr).toContain("f-heading が green");
  });

  test.each([
    ["timed-out", [{ status: "timed-out", error: { code: "TEST_TIMEOUT", message: "" } }]],
    ["操作の失敗", [{ status: "failed", error: { code: "LOCATOR_NOT_FOUND", message: "" } }]],
    ["エラーの無い失敗", [{ status: "failed" }]],
  ])("故障の結果が %s なら、検出として数えず exit 1", (_name, attempts) => {
    const results = allGood();
    results[1] = result("故障: 応答の件数を変える", attempts[0]?.status ?? "", attempts);
    expect(run(results).code).toBe(1);
  });

  test("注入が届かなかった印を含む assertion の失敗は、検出として数えない", () => {
    const results = allGood();
    results[1] = result("故障: 応答の件数を変える", "failed", [
      {
        status: "failed",
        error: { code: "ASSERTION_FAILED", message: "PARITY_INJECTION_NOT_APPLIED 行が変わらない" },
      },
    ]);
    expect(run(results).code).toBe(1);
  });

  test("リトライの最後の試行で判定する（最後が assertion の失敗なら赤）", () => {
    const results = allGood();
    results[1] = result("故障: 応答の件数を変える", "failed", [
      { status: "failed", error: { code: "LOCATOR_NOT_FOUND", message: "" } },
      assertionFailed,
    ]);
    expect(run(results).code).toBe(0);
  });

  test("計画に挙げた故障が結果に無ければ、未実行として exit 1", () => {
    expect(run(allGood().slice(0, 2)).code).toBe(1);
  });

  test("現行でない target の結果は数えない", () => {
    const results = allGood();
    results[2] = {
      ...result("故障: 見出しの階層を変える", "failed", [assertionFailed]),
      targetId: "new",
    };
    expect(run(results).code).toBe(1);
  });

  test.each([
    ["失敗", "failed"],
    ["実行していない", null],
  ])("対照が %s なら exit 1", (_name, status) => {
    const results = allGood().slice(1);
    if (status) results.push(result("対照: 注入しないと通る", status, [assertionFailed]));
    expect(run(results).code).toBe(1);
  });
});

describe("strength-check の判定できない入力（exit 2）", () => {
  test.each([
    ["対照が空", plan({ controls: [] })],
    ["故障が空", plan({ faults: [] })],
    ["observed が無い", plan({ faults: [{ id: "f", class: "c", test: VALUE }] })],
    [
      "同じテストが対照と故障にある",
      plan({ faults: [{ id: "f", class: "c", test: CONTROL, observed: "o" }] }),
    ],
    [
      "故障の id が重複",
      plan({
        faults: [
          { id: "f", class: "c", test: VALUE, observed: "o" },
          { id: "f", class: "c", test: HEADING, observed: "o" },
        ],
      }),
    ],
    ["version が違う", plan({ version: "2" })],
  ])("計画の %s", (_name, p) => {
    expect(run(allGood(), p).code).toBe(2);
  });

  test("同じテストの結果が 2 つあれば exit 2", () => {
    expect(run([...allGood(), allGood()[1]]).code).toBe(2);
  });

  test("schemaVersion が違えば exit 2", () => {
    const fs = new Fs();
    fs.put(PLAN, plan());
    fs.put(REPORT, { schemaVersion: "report-0", run: { results: [] } });
    const { io } = fs.io();
    expect(main(["--plan", PLAN, "--report", REPORT], io)).toBe(2);
  });

  test("metadata.json の slug が違えば書かずに exit 2", () => {
    const fs = new Fs();
    fs.put(PLAN, plan());
    fs.put(REPORT, report(allGood()));
    fs.put(META, { slug: "other" });
    const { io } = fs.io();
    expect(main(["--plan", PLAN, "--report", REPORT, "--write", META], io)).toBe(2);
    expect(fs.writes).toEqual([]);
  });

  // コメントの項目（Issue #995）: verify の手順 1 は書かずに判定し直すので、--metadata で slug だけを照合する
  test("--metadata の slug が計画と違えば、書かずに exit 2（別の機能の計画をコピーした strength-plan.json を通さない）", () => {
    const fs = new Fs();
    fs.put(PLAN, plan({ slug: "invoices" }));
    fs.put(REPORT, report(allGood()));
    fs.put(META, { slug: "orders" });
    const { io, out } = fs.io();
    expect(main(["--plan", PLAN, "--report", REPORT, "--metadata", META], io)).toBe(2);
    expect(out.stderr).toContain("強度の計画の slug（invoices）と違う");
    expect(fs.writes).toEqual([]);
  });

  test("--metadata の slug が計画と同じなら、書かずに判定する", () => {
    const r = run(allGood(), plan(), ["--metadata", META]);
    expect(r.code).toBe(0);
  });

  test("--write と --metadata を一緒に渡せば exit 2", () => {
    expect(run(allGood(), plan(), ["--write", META, "--metadata", META]).code).toBe(2);
  });
});

// serial group のメンバーは results[].attempts が空で、試行の記録は run.serialGroups[].attempts[].members[] にある。
// 形は e2e 0.23.0 の実物（fixtures/e2e-serial-reports.json）から取る。
type Member = { testId: string; status: string; error?: { code: string; message: string } };
type Group = { id: string; attempts: { members: Member[] }[] };
type Report = { schemaVersion: string; run: { serialGroups: Group[]; results: unknown[] } };
const SERIAL = parseJsonAs<{ serial: Report; retry: Report }>(
  readFileSync(new URL("fixtures/e2e-serial-reports.json", import.meta.url), "utf8"),
);
const S_FILE = "tests/serialprobe/serial.e2e.ts";
const S_CONTROL = `${S_FILE} › 直列 › 対照: 注入しないと通る`;
const S_FAULT = `${S_FILE} › 直列 › 故障: 見出しの階層を変える`;
const S_AFTER = `${S_FILE} › 直列 › 後続: 前が赤いとどうなるか`;
const R_FILE = "tests/serialprobe/serial2.e2e.ts";
const R_NOT_APPLIED = `${R_FILE} › 直列2 › 故障: 注入が届かない`;
const R_RED = `${R_FILE} › 直列3 › 故障: 赤`;

const fault = (id: string, t: string) => ({ id, class: "構造", test: t, observed: "h1 が無い" });

function runReport(doc: unknown, planDoc: unknown) {
  const fs = new Fs();
  fs.put(PLAN, planDoc);
  fs.put(REPORT, doc);
  const { io, out } = fs.io();
  return { code: main(["--plan", PLAN, "--report", REPORT], io), out };
}

const clone = (r: Report): Report => parseJsonAs<Report>(JSON.stringify(r));

describe("strength-check の serial group（e2e の実物）", () => {
  test("serial のメンバーが assertion で赤くなれば、group の記録から検出として数えて exit 0", () => {
    const r = runReport(
      SERIAL.serial,
      plan({ controls: [S_CONTROL], faults: [fault("f", S_FAULT)] }),
    );
    expect(r.code).toBe(0);
  });

  test("前のメンバーの失敗で飛ばされた故障は、検出として数えず exit 1", () => {
    const r = runReport(
      SERIAL.serial,
      plan({ controls: [S_CONTROL], faults: [fault("f", S_FAULT), fault("g", S_AFTER)] }),
    );
    expect(r.code).toBe(1);
    expect(r.out.stderr).toContain("g が stopped");
  });

  test("リトライした serial のメンバーで、注入が届かない故障は not-applied、assertion の故障は red", () => {
    const r = runReport(
      SERIAL.retry,
      plan({ controls: [S_CONTROL], faults: [fault("n", R_NOT_APPLIED), fault("r", R_RED)] }),
    );
    expect(r.out.stdout).toContain('"verdict": "not-applied"');
    expect(r.out.stdout).toContain('"verdict": "red"');
    expect(r.out.stderr).toContain("n が not-applied");
    expect(r.out.stderr).not.toContain("r が");
  });

  test("最後の試行のメンバーの記録で判定する（最後が操作の失敗なら赤にしない）", () => {
    const doc = clone(SERIAL.serial);
    const group = doc.run.serialGroups[0];
    const first = group?.attempts[0];
    if (!group || !first) throw new Error("fixture に serial group が無い");
    group.attempts.push({
      members: first.members.map((m) =>
        m.error ? { ...m, error: { code: "LOCATOR_NOT_FOUND", message: "" } } : m,
      ),
    });
    const r = runReport(doc, plan({ controls: [S_CONTROL], faults: [fault("f", S_FAULT)] }));
    expect(r.code).toBe(1);
    expect(r.out.stderr).toContain("f が stopped");
  });

  test("最後の試行がメンバーに届かなければ、そのメンバーを実行した前の試行の記録で判定する", () => {
    const doc = clone(SERIAL.serial);
    const group = doc.run.serialGroups[0];
    if (!group) throw new Error("fixture に serial group が無い");
    group.attempts.push({ members: [] });
    const r = runReport(doc, plan({ controls: [S_CONTROL], faults: [fault("f", S_FAULT)] }));
    expect(r.code).toBe(0);
  });

  test.each([
    [
      "serialGroupId が serialGroups に無い",
      (d: Report) => {
        d.run.serialGroups = [];
      },
    ],
    [
      "serialGroups が配列でない",
      (d: Report) => {
        Reflect.set(d.run, "serialGroups", {});
      },
    ],
    [
      "serialGroups の id が重複",
      (d: Report) => {
        const g = d.run.serialGroups[0];
        if (g) d.run.serialGroups.push(g);
      },
    ],
  ])("%s なら exit 2", (_name, edit) => {
    const doc = clone(SERIAL.serial);
    edit(doc);
    const r = runReport(doc, plan({ controls: [S_CONTROL], faults: [fault("f", S_FAULT)] }));
    expect(r.code).toBe(2);
  });
});
