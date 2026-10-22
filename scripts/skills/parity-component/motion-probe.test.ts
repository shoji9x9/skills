// 部品の動きの時系列を採るプローブ（motion-probe.mjs）の回帰テスト（Issue #456）。
//
// プローブはページ側で requestAnimationFrame ごとに採るので、実ブラウザ無しで確かめるために
// document / getComputedStyle / requestAnimationFrame / performance を偽物に差し替え、時計を 1 フレームずつ進める。
// 誤り方は「終わりを見ずに採り終える（途中で切った時系列が完了扱い）」と「止まらない」の 2 つがある。そのため、
// 落ち着いた後に終わること・動き続ける間は打ち切りとして記録されることを対で置く。
// 採った時系列が motion-compare.mjs でそのまま読めることも確かめる（書き手と読み手の形の一致）。

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  MAX_FRAME_RATE,
  VERSION,
  probeMotion,
  sampleLimit,
} from "../../../skills/parity-component/scripts/motion-probe.mjs";
import { summarizeTimeline } from "../../../skills/parity-component/scripts/motion-compare.mjs";
import { invalidInput } from "../../lib/testing/test-input.ts";
import {
  FRAME,
  lastSample,
  summaryOf,
  fakeGlobal,
  installEnv,
  slideIn,
} from "./motion-probe-helpers.ts";

const saved: Record<string, PropertyDescriptor | undefined> = {};
const GLOBALS = [
  "document",
  "getComputedStyle",
  "requestAnimationFrame",
  "performance",
  "__parityMotionProbe",
];

beforeEach(() => {
  for (const name of GLOBALS) saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
});
afterEach(() => {
  for (const name of GLOBALS) {
    if (saved[name]) Object.defineProperty(globalThis, name, saved[name]);
    else delete fakeGlobal[name];
  }
});

test("ページへ渡す式をソースのまま評価しても、モジュールの関数を呼んだときと同じ結果になる", async () => {
  // 偽のページは、ふだん installSampler をモジュールの関数のまま呼ぶ。ここでは Playwright と同じく式のソースを評価し、
  // ヘルパーが外側の名前を参照せず、関数の宣言のソースが関数式として評価できることを確かめる。
  // 採った値の正しさはほかのテストが確かめるので、ここでは 2 つの呼び方の結果が同じかだけを比べる。
  const run = async (evalScripts: boolean) => {
    delete fakeGlobal.__parityMotionProbe;
    const { page, trigger } = installEnv({ model: slideIn, evalScripts });
    return probeMotion(page, { selector: ".msg", trigger });
  };
  expect(await run(true)).toEqual(await run(false));
  // 読み取りが投げたときの処理（ヘルパーの failure を通る）も、2 つの呼び方で同じ結果になる。
  const runFailing = async (evalScripts: boolean) => {
    delete fakeGlobal.__parityMotionProbe;
    const { page, trigger } = installEnv({ model: slideIn, evalScripts });
    fakeGlobal.document.querySelectorAll = () => {
      throw new Error("'.msg[' is not a valid selector");
    };
    return probeMotion(page, { selector: ".msg[", trigger }).then(
      (timeline) => ({ resolved: timeline }),
      (error: unknown) => ({ rejected: String(error) }),
    );
  };
  expect(await runFailing(true)).toEqual(await runFailing(false));
});

// 次のテストは、偽のページが installSampler をモジュールの関数のまま呼ぶ形と、Playwright と同じく
// ページへ渡す式のソースを評価する形の 2 通りで実行する。ページ側の関数が helpers を通さずに互いを呼んでも、
// モジュールの関数の側はモジュールのスコープで名前が解決されて通る。ソースを評価する側は名前を解決できずに失敗するので、
// 取り決めが守られていることはこちらの側で確かめる。
describe.each([
  ["モジュールの関数", false],
  ["ページへ渡すソース", true],
])("%s", (_label, evalScripts) => {
  const env = (options: Omit<Parameters<typeof installEnv>[0], "evalScripts">) =>
    installEnv({ ...options, evalScripts });

  test("出る動きを採り、落ち着いた後に打ち切りでなく終わる", async () => {
    const { page, trigger } = env({ model: slideIn });
    const timeline = await probeMotion(page, { selector: ".msg", trigger });
    expect(timeline).toMatchObject({ probe_version: VERSION, selector: ".msg", timed_out: false });
    expect(timeline.samples[0]).toMatchObject({ t: 0, present: false });
    expect(timeline.samples.at(-1)).toMatchObject({ present: true, y: 100, opacity: 1 });
    // 最後の変化から settleMs（500ms）経ったところで終わる。
    const lastT = lastSample(timeline.samples).t;
    expect(lastT).toBeGreaterThan(620 + 500 - FRAME);
    expect(lastT).toBeLessThan(620 + 500 + 3 * FRAME);
    const read = summarizeTimeline(timeline);
    expect(read.ok).toBe(true);
    const summary = summaryOf(timeline);
    expect(summary.duration_ms).toBeGreaterThan(600 - 2 * FRAME);
    expect(summary.duration_ms).toBeLessThan(600 + 2 * FRAME);
    expect(summary).toMatchObject({ present_start: false, present_end: true, changed: true });
  });

  test("不透明度は祖先まで掛け合わせた実効の値を採る", async () => {
    const { page, trigger } = env({ model: slideIn, ancestorOpacity: 0.5 });
    const timeline = await probeMotion(page, { selector: ".msg", trigger });
    expect(lastSample(timeline.samples)).toMatchObject({ opacity: 0.5 });
  });

  test("動かないまま上限に達したのは観測（timed_out: false）で、動き続けたのは打ち切り（timed_out: true）", async () => {
    const still = env({ model: () => ({ x: 0, y: 0, width: 10, height: 10 }) });
    const stillTimeline = await probeMotion(still.page, {
      selector: ".msg",
      trigger: still.trigger,
      timeoutMs: 1000,
    });
    expect(stillTimeline.timed_out).toBe(false);
    expect(summaryOf(stillTimeline)).toMatchObject({
      changed: false,
      duration_ms: 0,
    });

    const spinning = env({
      model: (elapsed: number) => ({ x: elapsed, y: 0, width: 10, height: 10 }),
    });
    const spinningTimeline = await probeMotion(spinning.page, {
      selector: ".msg",
      trigger: spinning.trigger,
      timeoutMs: 1000,
    });
    expect(spinningTimeline.timed_out).toBe(true);
    expect(summarizeTimeline(spinningTimeline).ok).toBe(false);
  });

  test("想定より速く描く環境でフレーム数の上限に達したら打ち切りとして記録する", async () => {
    // 500Hz で描く（想定の最大フレームレートより速い）。上限は timeoutMs から導いた件数。
    const { page, trigger } = env({
      model: () => ({ x: 0, y: 0, width: 10, height: 10 }),
      frame: 2,
    });
    const timeline = await probeMotion(page, {
      selector: ".msg",
      trigger,
      timeoutMs: 1000,
      settleMs: 100,
    });
    // 上限は想定の最大フレームレート 240Hz で 1000ms を採り切れる件数（1000 × 240 / 1000 + 1 = 241）。
    // 500Hz で 1000ms 採れば 500 件になるので、それより先に上限で止まっている。
    expect(timeline.samples).toHaveLength(241);
    expect(timeline.timed_out).toBe(true);
  });

  test("自動で閉じるまでが長い部品でも、timeoutMs の内なら上限に達せず採り切る", async () => {
    // 90 秒後に閉じ始める（60Hz で約 5400 フレーム後）。固定の上限 5000 件では打ち切りになっていた。
    const lateClose = (elapsed: number) =>
      elapsed < 90000
        ? { x: 0, y: 0, width: 200, height: 40, opacity: 1 }
        : { x: 0, y: 0, width: 200, height: 40, opacity: Math.max(0, 1 - (elapsed - 90000) / 500) };
    const { page, trigger } = env({ model: lateClose });
    const timeline = await probeMotion(page, { selector: ".msg", trigger, timeoutMs: 100000 });
    expect(timeline.timed_out).toBe(false);
    expect(timeline.samples.length).toBeGreaterThan(5000);
    expect(sampleLimit(100000)).toBeGreaterThan((100000 * MAX_FRAME_RATE) / 1000);
  });

  test("セレクタが複数の要素に当たるなら採らずに失敗する", async () => {
    const { page, trigger } = env({ model: slideIn, matches: 2 });
    // 操作の前は要素が無い（0 件）ので、当たり始めたところで失敗する。
    await expect(probeMotion(page, { selector: ".msg", trigger })).rejects.toThrow(
      /matched 2 elements/,
    );
  });

  test("前のプローブが終わっていないページでは始めない", async () => {
    const { page } = env({ model: slideIn });
    fakeGlobal.__parityMotionProbe = { done: false };
    await expect(probeMotion(page, { selector: ".msg", trigger: async () => {} })).rejects.toThrow(
      /still running/,
    );
  });

  test("引数の誤り（セレクタ・操作・時間）は採る前に失敗する", async () => {
    const { page, trigger } = env({ model: slideIn });
    await expect(probeMotion(page, { selector: " ", trigger })).rejects.toThrow(/selector/);
    await expect(probeMotion(page, invalidInput({ selector: ".msg" }))).rejects.toThrow(/trigger/);
    await expect(probeMotion(page, { selector: ".msg", trigger, settleMs: 0 })).rejects.toThrow(
      /settleMs/,
    );
    await expect(
      probeMotion(page, { selector: ".msg", trigger, settleMs: 2000, timeoutMs: 1000 }),
    ).rejects.toThrow(/shorter/);
  });

  test("操作が失敗したらページ側の採取を止め、元の例外を投げ直す（同じページで採り直せる）", async () => {
    const { page, trigger } = env({ model: slideIn });
    const failing = async () => {
      throw new Error("click failed");
    };
    await expect(probeMotion(page, { selector: ".msg", trigger: failing })).rejects.toThrow(
      "click failed",
    );
    // 止まっているので、そのまま採り直せる（still running で弾かれない）。
    const timeline = await probeMotion(page, { selector: ".msg", trigger });
    expect(timeline.timed_out).toBe(false);
  });

  test("採取が例外で落ちてもプローブを終わらせ、同じページで採り直せる（不正なセレクタ・ページ遷移）", async () => {
    const { page, trigger } = env({ model: slideIn });
    const original = fakeGlobal.document.querySelectorAll;
    fakeGlobal.document.querySelectorAll = () => {
      throw new Error("'.msg[' is not a valid selector");
    };
    await expect(probeMotion(page, { selector: ".msg[", trigger })).rejects.toThrow(
      /sampler failed: .*not a valid selector/,
    );
    fakeGlobal.document.querySelectorAll = original;
    const timeline = await probeMotion(page, { selector: ".msg", trigger });
    expect(timeline.timed_out).toBe(false);
    // 操作でページが遷移して状態が消えたら、上限まで待たずに理由付きで失敗する。
    const navigating = async () => {
      delete fakeGlobal.__parityMotionProbe;
    };
    await expect(probeMotion(page, { selector: ".msg", trigger: navigating })).rejects.toThrow(
      /state disappeared/,
    );
  });

  test("最初の採取で失敗したら操作を起こさずに失敗する（操作の前から複数に当たる・不正なセレクタ）", async () => {
    const still = () => ({ x: 0, y: 0, width: 10, height: 10 });
    const { page } = env({ model: still, matches: 2 });
    let triggered = 0;
    const trigger = async () => {
      triggered += 1;
    };
    await expect(probeMotion(page, { selector: ".msg", trigger })).rejects.toThrow(
      /matched 2 elements/,
    );
    fakeGlobal.document.querySelectorAll = () => {
      throw new Error("'.msg[' is not a valid selector");
    };
    await expect(probeMotion(page, { selector: ".msg[", trigger })).rejects.toThrow(
      /sampler failed/,
    );
    expect(triggered).toBe(0);
  });
});
