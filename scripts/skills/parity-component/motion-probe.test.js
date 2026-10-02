// 部品の動きの時系列を採る探針（motion-probe.mjs）の回帰テスト（Issue #456）。
//
// 探針はページ側で requestAnimationFrame ごとに採るので、実ブラウザ無しで確かめるために
// document / getComputedStyle / requestAnimationFrame / performance を偽物に差し替え、時計を 1 フレームずつ進める。
// 壊れる方向は「終わりを見ずに採り終える（途中で切った時系列が完了扱い）」と「止まらない」の両方にあるので、
// 落ち着いた後に終わること・動き続ける間は打ち切りとして記録されることを対で置く。
// 採った時系列が motion-compare.mjs でそのまま読めることも確かめる（書き手と読み手の形の一致）。

import { afterEach, beforeEach, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const { MAX_FRAME_RATE, VERSION, probeMotion, sampleLimit } = await import(
  join(repoRoot, "skills/parity-component/scripts/motion-probe.mjs")
);
const { summarizeTimeline } = await import(
  join(repoRoot, "skills/parity-component/scripts/motion-compare.mjs")
);

const FRAME = 16.7;
const saved = {};
const GLOBALS = [
  "document",
  "getComputedStyle",
  "requestAnimationFrame",
  "performance",
  "__parityMotionProbe",
];

/** 偽のページ環境。model(elapsedSinceTrigger) が要素の状態を返す（null なら要素が無い）。 */
function installEnv({ model, matches = 1, ancestorOpacity = 1, frame = FRAME }) {
  const env = { now: 1000, triggerAt: null, queue: [] };
  const parent = {
    nodeType: 1,
    parentElement: null,
    style: { display: "block", visibility: "visible", opacity: String(ancestorOpacity) },
  };
  const current = () => model(env.triggerAt === null ? -1 : env.now - env.triggerAt);
  const element = {
    nodeType: 1,
    parentElement: parent,
    get isConnected() {
      return current() !== null;
    },
    getBoundingClientRect() {
      const s = current();
      return { x: s.x, y: s.y, width: s.width, height: s.height };
    },
    get style() {
      const s = current();
      return {
        display: s.display ?? "block",
        visibility: "visible",
        opacity: String(s.opacity ?? 1),
      };
    },
  };
  globalThis.document = {
    querySelectorAll: () =>
      current() === null ? [] : Array.from({ length: matches }, () => element),
  };
  globalThis.getComputedStyle = (node) => node.style;
  globalThis.requestAnimationFrame = (cb) => env.queue.push(cb);
  Object.defineProperty(globalThis, "performance", {
    value: { now: () => env.now },
    configurable: true,
    writable: true,
  });
  const tick = () => {
    env.now += frame;
    const callbacks = env.queue;
    env.queue = [];
    for (const cb of callbacks) cb();
  };
  const page = {
    evaluate: async (fn, arg) => fn(arg),
    waitForFunction: async (fn) => {
      for (let i = 0; i < 100000; i += 1) {
        if (fn()) return true;
        tick();
      }
      throw new Error("fake page: waitForFunction never resolved");
    },
  };
  const trigger = async () => {
    env.triggerAt = env.now;
  };
  return { env, page, trigger };
}

beforeEach(() => {
  for (const name of GLOBALS) saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
});
afterEach(() => {
  for (const name of GLOBALS) {
    if (saved[name]) Object.defineProperty(globalThis, name, saved[name]);
    else delete globalThis[name];
  }
});

/** 操作から 20ms 後に出て、600ms かけて 40px 降りる。 */
const slideIn = (elapsed) => {
  if (elapsed < 20)
    return elapsed < 0 ? null : { x: 10, y: 0, width: 0, height: 0, display: "none" };
  const p = Math.min(1, (elapsed - 20) / 600);
  return { x: 10, y: 60 + 40 * p, width: 200, height: 40, opacity: 0.5 + 0.5 * p };
};

test("出る動きを採り、落ち着いた後に打ち切りでなく終わる", async () => {
  const { page, trigger } = installEnv({ model: slideIn });
  const timeline = await probeMotion(page, { selector: ".msg", trigger });
  expect(timeline).toMatchObject({ probe_version: VERSION, selector: ".msg", timed_out: false });
  expect(timeline.samples[0]).toMatchObject({ t: 0, present: false });
  expect(timeline.samples.at(-1)).toMatchObject({ present: true, y: 100, opacity: 1 });
  // 最後の変化から settleMs（500ms）経ったところで終わる。
  const lastT = timeline.samples.at(-1).t;
  expect(lastT).toBeGreaterThan(620 + 500 - FRAME);
  expect(lastT).toBeLessThan(620 + 500 + 3 * FRAME);
  const read = summarizeTimeline(timeline);
  expect(read.ok).toBe(true);
  expect(read.summary.duration_ms).toBeGreaterThan(600 - 2 * FRAME);
  expect(read.summary.duration_ms).toBeLessThan(600 + 2 * FRAME);
  expect(read.summary).toMatchObject({ present_start: false, present_end: true, changed: true });
});

test("不透明度は祖先まで掛け合わせた実効の値を採る", async () => {
  const { page, trigger } = installEnv({ model: slideIn, ancestorOpacity: 0.5 });
  const timeline = await probeMotion(page, { selector: ".msg", trigger });
  expect(timeline.samples.at(-1).opacity).toBe(0.5);
});

test("動かないまま上限に達したのは観測（timed_out: false）で、動き続けたのは打ち切り（timed_out: true）", async () => {
  const still = installEnv({ model: () => ({ x: 0, y: 0, width: 10, height: 10 }) });
  const stillTimeline = await probeMotion(still.page, {
    selector: ".msg",
    trigger: still.trigger,
    timeoutMs: 1000,
  });
  expect(stillTimeline.timed_out).toBe(false);
  expect(summarizeTimeline(stillTimeline).summary).toMatchObject({
    changed: false,
    duration_ms: 0,
  });

  const spinning = installEnv({
    model: (elapsed) => ({ x: elapsed, y: 0, width: 10, height: 10 }),
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
  const { page, trigger } = installEnv({
    model: () => ({ x: 0, y: 0, width: 10, height: 10 }),
    frame: 2,
  });
  const timeline = await probeMotion(page, {
    selector: ".msg",
    trigger,
    timeoutMs: 1000,
    settleMs: 100,
  });
  expect(timeline.samples).toHaveLength(sampleLimit(1000));
  expect(timeline.timed_out).toBe(true);
});

test("自動で閉じるまでが長い部品でも、timeoutMs の内なら上限に達せず採り切る", async () => {
  // 90 秒後に閉じ始める（60Hz で約 5400 フレーム後）。固定の上限 5000 件では打ち切りになっていた。
  const lateClose = (elapsed) =>
    elapsed < 90000
      ? { x: 0, y: 0, width: 200, height: 40, opacity: 1 }
      : { x: 0, y: 0, width: 200, height: 40, opacity: Math.max(0, 1 - (elapsed - 90000) / 500) };
  const { page, trigger } = installEnv({ model: lateClose });
  const timeline = await probeMotion(page, { selector: ".msg", trigger, timeoutMs: 100000 });
  expect(timeline.timed_out).toBe(false);
  expect(timeline.samples.length).toBeGreaterThan(5000);
  expect(sampleLimit(100000)).toBeGreaterThan((100000 * MAX_FRAME_RATE) / 1000);
});

test("セレクタが複数の要素に当たるなら採らずに失敗する", async () => {
  const { page, trigger } = installEnv({ model: slideIn, matches: 2 });
  // 操作の前は要素が無い（0 件）ので、当たり始めたところで失敗する。
  await expect(probeMotion(page, { selector: ".msg", trigger })).rejects.toThrow(
    /matched 2 elements/,
  );
});

test("前の探針が終わっていないページでは始めない", async () => {
  const { page } = installEnv({ model: slideIn });
  globalThis.__parityMotionProbe = { done: false };
  await expect(probeMotion(page, { selector: ".msg", trigger: async () => {} })).rejects.toThrow(
    /still running/,
  );
});

test("引数の誤り（セレクタ・操作・時間）は採る前に失敗する", async () => {
  const { page, trigger } = installEnv({ model: slideIn });
  await expect(probeMotion(page, { selector: " ", trigger })).rejects.toThrow(/selector/);
  await expect(probeMotion(page, { selector: ".msg" })).rejects.toThrow(/trigger/);
  await expect(probeMotion(page, { selector: ".msg", trigger, settleMs: 0 })).rejects.toThrow(
    /settleMs/,
  );
  await expect(
    probeMotion(page, { selector: ".msg", trigger, settleMs: 2000, timeoutMs: 1000 }),
  ).rejects.toThrow(/shorter/);
});

test("操作が失敗したらページ側の採取を止め、元の例外を投げ直す（同じページで採り直せる）", async () => {
  const { page, trigger } = installEnv({ model: slideIn });
  const failing = async () => {
    throw new Error("click failed");
  };
  await expect(probeMotion(page, { selector: ".msg", trigger: failing })).rejects.toThrow(
    "click failed",
  );
  expect(globalThis.__parityMotionProbe.done).toBe(true);
  // 止まっているので、そのまま採り直せる（still running で弾かれない）。
  const timeline = await probeMotion(page, { selector: ".msg", trigger });
  expect(timeline.timed_out).toBe(false);
});

test("採取が例外で落ちても探針を終わらせ、同じページで採り直せる（不正なセレクタ・ページ遷移）", async () => {
  const { page, trigger } = installEnv({ model: slideIn });
  const original = globalThis.document.querySelectorAll;
  globalThis.document.querySelectorAll = () => {
    throw new Error("'.msg[' is not a valid selector");
  };
  await expect(probeMotion(page, { selector: ".msg[", trigger })).rejects.toThrow(
    /sampler failed: .*not a valid selector/,
  );
  expect(globalThis.__parityMotionProbe.done).toBe(true);
  globalThis.document.querySelectorAll = original;
  const timeline = await probeMotion(page, { selector: ".msg", trigger });
  expect(timeline.timed_out).toBe(false);
  // 操作でページが遷移して状態が消えたら、上限まで待たずに理由付きで失敗する。
  const navigating = async () => {
    delete globalThis.__parityMotionProbe;
  };
  await expect(probeMotion(page, { selector: ".msg", trigger: navigating })).rejects.toThrow(
    /state disappeared/,
  );
});

test("最初の採取で失敗したら操作を起こさずに失敗する（操作の前から複数に当たる・不正なセレクタ）", async () => {
  const still = () => ({ x: 0, y: 0, width: 10, height: 10 });
  const { page } = installEnv({ model: still, matches: 2 });
  let triggered = 0;
  const trigger = async () => {
    triggered += 1;
  };
  await expect(probeMotion(page, { selector: ".msg", trigger })).rejects.toThrow(
    /matched 2 elements/,
  );
  globalThis.document.querySelectorAll = () => {
    throw new Error("'.msg[' is not a valid selector");
  };
  await expect(probeMotion(page, { selector: ".msg[", trigger })).rejects.toThrow(/sampler failed/);
  expect(triggered).toBe(0);
});
