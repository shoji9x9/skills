// 部品の動きを現行とカタログで突き合わせる検査（motion-compare.mjs）の回帰テスト（Issue #456）。
//
// 見た目の照合は animations: "disabled" で止めて撮るので、動きの欠落（即時に出る・長さが違う）は
// どの照合にも記録されない。この検査の誤り方は「動きが無いのに一致と言う」と「揺れでいつまでも失敗する」の
// 2 つがある。そのため、揺れを含む同じ動きが通ることと、欠落・長さ違いが落ちることを対で置く。

import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "skills/parity-component/scripts/motion-compare.mjs");
const probeScript = join(repoRoot, "skills/parity-component/scripts/motion-probe.mjs");
const { CHANGE_EPSILON, FLOORS, compareMotions, summarizeTimeline, main } = await import(script);
const probe = await import(probeScript);

const FRAME = 16.7;

/**
 * 上から降りて出る動き（enter）か、上へ戻って消える動き（exit）の時系列を作る。
 * duration 0 は即時に出る・消える。jitter は操作から動きが始まるまでの遅れの揺れ。
 */
function timeline({
  kind = "enter",
  delay = 20,
  duration = 600,
  distance = 40,
  jitter = 0,
  settle = 500,
  probeVersion = "1",
} = {}) {
  const samples = [];
  const start = delay + jitter;
  const end = start + duration;
  for (let t = 0; t <= end + settle + FRAME; t += FRAME) {
    const p =
      duration === 0 ? (t >= start ? 1 : 0) : Math.min(1, Math.max(0, (t - start) / duration));
    const shown = kind === "enter" ? t >= start : duration === 0 ? t < start : t < end;
    const progress = kind === "enter" ? p : 1 - p;
    samples.push(
      shown
        ? {
            t: Math.round(t * 10) / 10,
            present: true,
            x: 10,
            y: Math.round((100 - distance * (1 - progress)) * 100) / 100,
            width: 200,
            height: 40,
            opacity: 1,
          }
        : { t: Math.round(t * 10) / 10, present: false },
    );
  }
  return {
    probe_version: probeVersion,
    selector: ".msg",
    settle_ms: settle,
    timed_out: false,
    samples,
  };
}

function metadataOf(override = {}) {
  return {
    slug: "feedback-message",
    capture: {
      operations: [
        {
          id: "close-after-open",
          description: "出た後に閉じる",
          steps: "閉じるボタンを押す",
          observe: ["open"],
        },
      ],
      tools: { motion_probe_version: "1" },
      motions: {
        source_scan: ["message.js:12 show('slide', {direction: 'up'}, 600)"],
        transitions: [
          {
            id: "enter",
            description: "上から降りて出る",
            trigger: "表示ボタンを押す",
            on_complete: ["close-after-open"],
          },
          { id: "exit", description: "上へ戻って消える", trigger: "閉じるボタンを押す" },
        ],
        none_reason: null,
        ...override.motions,
      },
    },
    instances: override.instances ?? [{ id: "orders" }, { id: "stock" }],
  };
}

function baselineOf(instance, overrides = {}) {
  return {
    instance,
    results: [
      {
        transition: "enter",
        runs: overrides.enter ?? [
          timeline({ kind: "enter" }),
          timeline({ kind: "enter", jitter: 6 }),
        ],
      },
      {
        transition: "exit",
        runs: overrides.exit ?? [
          timeline({ kind: "exit", duration: 500 }),
          timeline({ kind: "exit", duration: 500, jitter: 5 }),
        ],
      },
    ],
  };
}

function rowsOf(newTimelines = {}) {
  const rows = [];
  for (const instance of ["orders", "stock"]) {
    for (const transition of ["enter", "exit"]) {
      const fallback =
        transition === "enter"
          ? timeline({ kind: "enter", jitter: 9 })
          : timeline({ kind: "exit", duration: 500, jitter: 8 });
      rows.push({
        transition,
        instance,
        story: `feedback-message--${instance}-default`,
        timeline: newTimelines[`${transition}/${instance}`] ?? fallback,
        disposition: null,
      });
    }
  }
  return rows;
}

function run({ metadata = metadataOf(), motions, comparison, target = "preview" } = {}) {
  return compareMotions({
    metadata,
    motions: motions ?? { orders: baselineOf("orders"), stock: baselineOf("stock") },
    comparison:
      comparison === undefined
        ? { component: "feedback-message", target: "preview", rows: rowsOf() }
        : comparison,
    target,
  });
}

const codes = (result) => result.findings.map((f) => f.code);

test("誤検知しないことの確認: 揺れを含む同じ動きは全組み合わせで一致する", () => {
  const result = run();
  expect(result.findings).toEqual([]);
  expect(result.counts).toMatchObject({ cells: 4, matched: 4, mismatched: 0, uncompared: 0 });
});

test("新側が即時に出る（動きを持たない）なら長さと軌跡の食い違いで落とす", () => {
  const result = run({
    comparison: {
      component: "feedback-message",
      target: "preview",
      rows: rowsOf({ "enter/orders": timeline({ kind: "enter", duration: 0 }) }),
    },
  });
  expect(codes(result)).toEqual(["motion-mismatch"]);
  const measures = result.findings[0].differing.map((d) => d.measure);
  expect(measures).toContain("duration_ms");
  expect(measures).toContain("trajectory.dy");
});

test("長さだけが違う動き（600ms に対して 300ms）も落とす", () => {
  const result = run({
    comparison: {
      component: "feedback-message",
      target: "preview",
      rows: rowsOf({ "enter/stock": timeline({ kind: "enter", duration: 300 }) }),
    },
  });
  expect(codes(result)).toEqual(["motion-mismatch"]);
  expect(result.findings[0].differing.map((d) => d.measure)).toContain("duration_ms");
});

test("始まるまでの遅れの違いは下限（50ms）までは許し、それを超えると落とす", () => {
  const within = run({
    comparison: {
      component: "feedback-message",
      target: "preview",
      rows: rowsOf({ "enter/orders": timeline({ kind: "enter", jitter: 40 }) }),
    },
  });
  expect(within.findings).toEqual([]);
  const beyond = run({
    comparison: {
      component: "feedback-message",
      target: "preview",
      rows: rowsOf({ "enter/orders": timeline({ kind: "enter", delay: 400 }) }),
    },
  });
  expect(codes(beyond)).toEqual(["motion-mismatch"]);
  expect(beyond.findings[0].differing.map((d) => d.measure)).toContain("delay_ms");
});

test("許容差は現行の 2 回の揺れから広がる（揺れの 2 倍までは通す）", () => {
  const motions = {
    orders: baselineOf("orders", {
      enter: [timeline({ kind: "enter" }), timeline({ kind: "enter", jitter: 60 })],
    }),
    stock: baselineOf("stock"),
  };
  const comparison = (jitter) => ({
    component: "feedback-message",
    target: "preview",
    rows: rowsOf({ "enter/orders": timeline({ kind: "enter", jitter }) }),
  });
  // フレームの刻みで量子化されるので、揺れ 60ms は約 50ms と測られ、許容差は約 100ms になる。
  expect(run({ motions, comparison: comparison(80) }).findings).toEqual([]);
  expect(codes(run({ motions, comparison: comparison(200) }))).toEqual(["motion-mismatch"]);
});

test("出る動きが消える動きになっていれば、在るかの食い違いで落とす", () => {
  const result = run({
    comparison: {
      component: "feedback-message",
      target: "preview",
      rows: rowsOf({ "enter/orders": timeline({ kind: "exit", duration: 600 }) }),
    },
  });
  expect(codes(result)).toEqual(["motion-mismatch"]);
  const measures = result.findings[0].differing.map((d) => d.measure);
  expect(measures).toEqual(expect.arrayContaining(["present_start", "present_end"]));
});

test("置き場所が違っても（絶対座標のずれ）、基準の矩形からのずれで比べるので一致する", () => {
  const moved = timeline({ kind: "enter", jitter: 4 });
  for (const s of moved.samples) {
    if (s.present) {
      s.x += 300;
      s.y += 250;
    }
  }
  const result = run({
    comparison: {
      component: "feedback-message",
      target: "preview",
      rows: rowsOf({ "enter/orders": moved }),
    },
  });
  expect(result.findings).toEqual([]);
});

test("現行の時系列が 1 回分しかないと揺れを測れないので比べない", () => {
  const motions = {
    orders: baselineOf("orders", { enter: [timeline({ kind: "enter" })] }),
    stock: baselineOf("stock"),
  };
  const result = run({ motions });
  expect(codes(result)).toEqual(["motion-noise-missing"]);
  expect(result.counts.uncompared).toBe(1);
});

test("打ち切られた・要素が一度も在らなかった・t が戻る時系列は比較に使わない", () => {
  const timedOut = { ...timeline({ kind: "enter" }), timed_out: true };
  expect(summarizeTimeline(timedOut).ok).toBe(false);
  const never = timeline({ kind: "enter" });
  never.samples = never.samples.map((s) => ({ t: s.t, present: false }));
  expect(summarizeTimeline(never)).toMatchObject({
    ok: false,
    reason: expect.stringMatching(/一度も/),
  });
  const backwards = timeline({ kind: "enter" });
  backwards.samples[3].t = 0;
  expect(summarizeTimeline(backwards).ok).toBe(false);
  const missingFlag = timeline({ kind: "enter" });
  delete missingFlag.timed_out;
  expect(summarizeTimeline(missingFlag).ok).toBe(false);

  const result = run({
    comparison: {
      component: "feedback-message",
      target: "preview",
      rows: rowsOf({ "enter/orders": timedOut }),
    },
  });
  expect(codes(result)).toEqual(["motion-timeline-invalid"]);
  expect(result.findings[0].side).toBe("new");
});

test("現行の 2 回で動く／動かないが割れたら基準にしない", () => {
  const still = timeline({ kind: "enter" });
  still.samples = still.samples.map((s) => ({ ...s, ...still.samples.at(-1), t: s.t }));
  const motions = {
    orders: baselineOf("orders", { enter: [timeline({ kind: "enter" }), still] }),
    stock: baselineOf("stock"),
  };
  expect(codes(run({ motions }))).toEqual(["motion-baseline-unstable"]);
});

test("突き合わせ表が無ければ全組み合わせを未突合、行の無い組み合わせは motion-uncompared", () => {
  const missing = run({ comparison: null });
  expect(codes(missing)).toEqual(["comparison-missing"]);
  expect(missing.counts.uncompared).toBe(4);
  const partial = run({
    comparison: { component: "feedback-message", target: "preview", rows: rowsOf().slice(1) },
  });
  expect(codes(partial)).toEqual(["motion-uncompared"]);
});

test("現行の時系列が無い組み合わせは、宣言が無ければ motion-baseline-missing", () => {
  const result = run({ motions: { orders: baselineOf("orders"), stock: null } });
  expect(codes(result).filter((c) => c === "motion-baseline-missing")).toHaveLength(2);
});

test("理由付きで到達できないと宣言した遷移は母集合から外れ、理由が無ければ外さない", () => {
  const declared = (reason) =>
    metadataOf({
      instances: [
        { id: "orders" },
        { id: "stock", unreachable_motions: [{ transition: "exit", reason }] },
      ],
    });
  const rows = rowsOf().filter((r) => !(r.instance === "stock" && r.transition === "exit"));
  const comparison = { component: "feedback-message", target: "preview", rows };
  const stock = { instance: "stock", results: baselineOf("stock").results.slice(0, 1) };
  const ok = run({
    metadata: declared("この画面では閉じるボタンを出さない"),
    motions: { orders: baselineOf("orders"), stock },
    comparison,
  });
  expect(ok.findings).toEqual([]);
  expect(ok.counts).toMatchObject({ cells: 3, not_compared: 1 });
  const ng = run({
    metadata: declared("<到達できない理由>"),
    motions: { orders: baselineOf("orders"), stock },
    comparison,
  });
  expect(codes(ng)).toEqual(
    expect.arrayContaining([
      "unreachable-declaration-invalid",
      "motion-baseline-missing",
      "motion-uncompared",
    ]),
  );
});

test("動きの列挙が無い・空（理由なし）・理由と遷移の併記・ソースの記録なしは型崩れ", () => {
  const noMotions = metadataOf();
  delete noMotions.capture.motions;
  expect(run({ metadata: noMotions }).structural).toBe(true);
  expect(run({ metadata: metadataOf({ motions: { transitions: [] } }) }).structural).toBe(true);
  expect(
    run({ metadata: metadataOf({ motions: { transitions: [], none_reason: "<理由>" } }) })
      .structural,
  ).toBe(true);
  expect(
    run({ metadata: metadataOf({ motions: { none_reason: "静的な表示だけ" } }) }).structural,
  ).toBe(true);
  expect(run({ metadata: metadataOf({ motions: { source_scan: undefined } }) }).structural).toBe(
    true,
  );
});

test("動きを持たない部品は理由を宣言すれば判定しないで通す", () => {
  const result = run({
    metadata: metadataOf({
      motions: { transitions: [], none_reason: "transition / animation の宣言も JS の動きも無い" },
    }),
  });
  expect(result).toMatchObject({ structural: false, judged: false, findings: [] });
});

test("on_complete が列挙に無い操作を指す・trigger が無い遷移は型崩れ", () => {
  const unknownOp = metadataOf();
  unknownOp.capture.motions.transitions[0].on_complete = ["focus-after-open"];
  expect(run({ metadata: unknownOp }).structural).toBe(true);
  const noTrigger = metadataOf();
  noTrigger.capture.motions.transitions[1].trigger = "<動きを起こす手順>";
  expect(run({ metadata: noTrigger }).structural).toBe(true);
});

test("プローブの版が記録と違う時系列は比べない（採取スキーマが違う）", () => {
  const result = run({
    comparison: {
      component: "feedback-message",
      target: "preview",
      rows: rowsOf({ "exit/stock": timeline({ kind: "exit", duration: 500, probeVersion: "0" }) }),
    },
  });
  expect(codes(result)).toEqual(["motion-probe-version-mismatch"]);
  const noVersion = metadataOf();
  delete noVersion.capture.tools.motion_probe_version;
  expect(run({ metadata: noVersion }).structural).toBe(true);
});

test("比べないことを選ぶには承認が要る（プレースホルダは承認ではない）", () => {
  const accepted = (override) => {
    const rows = rowsOf();
    rows[0] = {
      transition: "enter",
      instance: "orders",
      disposition: "accepted",
      reason: "新側では動きを付けないことを決めた",
      approved_by: "owner",
      approved_at: "2026-09-29T10:00:00Z",
      ...override,
    };
    return { component: "feedback-message", target: "preview", rows };
  };
  const ok = run({ comparison: accepted({}) });
  expect(ok.findings).toEqual([]);
  expect(ok.counts.accepted).toBe(1);
  for (const override of [
    { reason: "<理由>" },
    { approved_by: "" },
    { approved_at: "2026-02-30" },
  ]) {
    expect(codes(run({ comparison: accepted(override) }))).toEqual([
      "motion-acceptance-unapproved",
    ]);
  }
});

test("母集合に無い行・重複行・見本の識別子の無い行・別 target / 別部品の表を通さない", () => {
  const extra = {
    component: "feedback-message",
    target: "preview",
    rows: [...rowsOf(), { ...rowsOf()[0], instance: "cart" }],
  };
  expect(codes(run({ comparison: extra }))).toEqual(["motion-unbaselined"]);
  const dup = {
    component: "feedback-message",
    target: "preview",
    rows: [...rowsOf(), rowsOf()[0]],
  };
  expect(codes(run({ comparison: dup }))).toEqual(["motion-duplicate-row"]);
  const noStory = rowsOf();
  noStory[0].story = "<見本の識別子>";
  expect(
    codes(run({ comparison: { component: "feedback-message", target: "preview", rows: noStory } })),
  ).toEqual(["motion-story-missing"]);
  expect(codes(run({ target: "staging" }))).toEqual(["comparison-target-mismatch"]);
  expect(
    codes(run({ comparison: { component: "button", target: "preview", rows: rowsOf() } })),
  ).toEqual(["comparison-component-mismatch"]);
});

test("全組み合わせが到達できない宣言なら合格にしない", () => {
  const all = ["enter", "exit"].map((transition) => ({ transition, reason: "出ない" }));
  const result = run({
    metadata: metadataOf({
      instances: [
        { id: "orders", unreachable_motions: all },
        { id: "stock", unreachable_motions: all },
      ],
    }),
    motions: { orders: null, stock: null },
    comparison: { component: "feedback-message", target: "preview", rows: [] },
  });
  expect(codes(result)).toEqual(["motion-nothing-compared"]);
});

test("変化の判定の閾値はプローブと同じ値（片側だけ変えると、採った変化と比べる変化が食い違う）", () => {
  expect(CHANGE_EPSILON).toEqual(probe.CHANGE_EPSILON);
  expect(FLOORS.delay_ms).toBeGreaterThan(0);
});

test("同梱テンプレートをそのまま渡しても合格にしない", () => {
  const asset = (name) =>
    JSON.parse(readFileSync(join(repoRoot, "skills/parity-component/assets", name), "utf8"));
  const metadata = asset("metadata-template.json");
  const id = metadata.instances[0].id;
  const result = compareMotions({
    metadata,
    motions: { [id]: { ...asset("motions-template.json"), instance: id } },
    comparison: asset("motion-comparison-template.json"),
    target: "preview",
  });
  expect(result.structural).toBe(true);
});

test("CLI: 揃った採取物と突き合わせ表で exit 0、行を欠くと exit 1、引数の誤りは exit 2", () => {
  const dir = makeTempDir("motion-compare-");
  writeFileSync(join(dir, "metadata.json"), JSON.stringify(metadataOf()));
  for (const id of ["orders", "stock"]) {
    mkdirSync(join(dir, "baseline", id), { recursive: true });
    writeFileSync(join(dir, "baseline", id, "motions.json"), JSON.stringify(baselineOf(id)));
  }
  const comparisonPath = join(dir, "motion-comparison.json");
  const args = ["--baseline", dir, "--comparison", comparisonPath, "--target", "preview"];
  writeFileSync(
    comparisonPath,
    JSON.stringify({ component: "feedback-message", target: "preview", rows: rowsOf() }),
  );
  const ok = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  expect(ok.status).toBe(0);
  expect(JSON.parse(ok.stdout)).toMatchObject({ tool: "motion-compare", ok: true });
  writeFileSync(
    comparisonPath,
    JSON.stringify({ component: "feedback-message", target: "preview", rows: rowsOf().slice(1) }),
  );
  expect(spawnSync(process.execPath, [script, ...args], { encoding: "utf8" }).status).toBe(1);
  let err = "";
  expect(
    main(["--baseline", dir, "--target", " "], { write: () => {}, writeErr: (s) => (err += s) }),
  ).toBe(2);
  expect(err).toMatch(/必須/);
});

test("eval fixture の button は動きの無い部品として宣言済みで、build の前提（型崩れにならない）を通る", async () => {
  const { readdirSync, existsSync } = await import("node:fs");
  const root = join(repoRoot, "evals/parity-component/fixtures");
  const dirs = readdirSync(root)
    .map((name) => join(root, name, ".replace/components/button"))
    .filter((dir) => existsSync(join(dir, "metadata.json")));
  // 検出できることの確認: 対象 0 件を合格にしない。
  expect(dirs.length).toBeGreaterThan(0);
  for (const dir of dirs) {
    const metadata = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8"));
    const result = compareMotions({ metadata, motions: {}, comparison: null, target: "preview" });
    expect({ dir, structural: result.structural, judged: result.judged }).toEqual({
      dir,
      structural: false,
      judged: false,
    });
  }
});

test("現行の 2 回の揺れが上限を超えたら許容差を広げず基準にしない（600ms と即時の組で欠落を通さない）", () => {
  const motions = {
    orders: baselineOf("orders", {
      enter: [timeline({ kind: "enter" }), timeline({ kind: "enter", duration: 0 })],
    }),
    stock: baselineOf("stock"),
  };
  const result = run({
    motions,
    comparison: {
      component: "feedback-message",
      target: "preview",
      rows: rowsOf({ "enter/orders": timeline({ kind: "enter", duration: 0 }) }),
    },
  });
  expect(codes(result)).toEqual(["motion-baseline-unstable"]);
  expect(result.counts.matched).toBe(3);
});

test("現行が一度も動かなかった時系列は、ソースの宣言の有無に関わらず基準にしない", () => {
  const still = timeline({ kind: "enter" });
  const end = still.samples.at(-1);
  still.samples = still.samples.map((s) => ({ ...end, t: s.t }));
  const motions = {
    orders: baselineOf("orders", { enter: [still, structuredClone(still)] }),
    stock: baselineOf("stock"),
  };
  const staticRows = rowsOf({ "enter/orders": structuredClone(still) });
  const comparison = { component: "feedback-message", target: "preview", rows: staticRows };
  // ソースに宣言がある動き。
  const declared = metadataOf();
  declared.capture.motions.transitions[0].declared = "show('slide', {direction: 'up'}, 600)";
  expect(codes(run({ metadata: declared, motions, comparison }))).toEqual([
    "motion-baseline-static",
  ]);
  // 実機でだけ見つかった動き（declared なし）。新側も静止でも「動きなし」同士で一致させない。
  expect(codes(run({ metadata: metadataOf(), motions, comparison }))).toEqual([
    "motion-baseline-static",
  ]);
});

test("等間隔の比較点の間に収まる短い動き（一瞬の点滅）も軌跡の比較で落とす", () => {
  const pulse = (t) => {
    const tl = timeline({ kind: "enter", duration: 1000 });
    const origin = tl.samples.findIndex((s) => s.present) - 1;
    const t0 = tl.samples[origin].t;
    for (const s of tl.samples) {
      // 最初の変化から約 234ms の 1 フレームだけ不透明度が落ちる。等間隔の比較点（約 51ms 刻み）の
      // 203.7ms と 254.7ms は、どちらもこのフレームを補間の端に使わない。
      if (t && s.present && s.t - t0 > 225 && s.t - t0 < 240) s.opacity = 0.2;
    }
    return tl;
  };
  const motions = {
    orders: baselineOf("orders", { enter: [pulse(true), pulse(true)] }),
    stock: baselineOf("stock"),
  };
  // 誤検知しないことの確認: 同じ点滅を持つ新側は一致する。
  const same = {
    component: "feedback-message",
    target: "preview",
    rows: rowsOf({ "enter/orders": pulse(true) }),
  };
  expect(run({ motions, comparison: same }).findings).toEqual([]);
  const without = {
    component: "feedback-message",
    target: "preview",
    rows: rowsOf({ "enter/orders": pulse(false) }),
  };
  const result = run({ motions, comparison: without });
  expect(codes(result)).toEqual(["motion-mismatch"]);
  expect(result.findings[0].differing.map((d) => d.measure)).toEqual(["trajectory.opacity"]);
});

test("揺れの上限は時間と軌跡のそれぞれで適用される（遅れだけ・移動量だけが割れた現行も基準にしない）", () => {
  const withNoise = (second) => ({
    orders: baselineOf("orders", { enter: [timeline({ kind: "enter" }), second] }),
    stock: baselineOf("stock"),
  });
  // 遅れだけが 300ms 割れた（軌跡は最初の変化から揃えるので同じ）。
  expect(codes(run({ motions: withNoise(timeline({ kind: "enter", jitter: 300 })) }))).toEqual([
    "motion-baseline-unstable",
  ]);
  // 移動量だけが 40px と 80px で割れた（遅れ・長さは同じ）。
  expect(codes(run({ motions: withNoise(timeline({ kind: "enter", distance: 80 })) }))).toEqual([
    "motion-baseline-unstable",
  ]);
});

test("現行の 2 回の割れは、突き合わせ表が無い（capture の前提判定）・行が比較まで届かないときも報告する", () => {
  const motions = {
    orders: baselineOf("orders", {
      enter: [timeline({ kind: "enter" }), timeline({ kind: "enter", duration: 0 })],
    }),
    stock: baselineOf("stock"),
  };
  expect(codes(run({ motions, comparison: null }))).toEqual([
    "motion-baseline-unstable",
    "comparison-missing",
  ]);
  const rows = rowsOf();
  rows[0] = {
    transition: "enter",
    instance: "orders",
    disposition: "accepted",
    reason: "新側では動きを付けないことを決めた",
    approved_by: "owner",
    approved_at: "2026-09-29T10:00:00Z",
  };
  expect(
    codes(run({ motions, comparison: { component: "feedback-message", target: "preview", rows } })),
  ).toEqual(["motion-baseline-unstable"]);
});
