// motion-probe.test.ts が使うヘルパーと fixture。
import { assert } from "vitest";
import { summarizeTimeline } from "../../../skills/parity-component/scripts/motion-compare.mjs";

export const FRAME = 16.7;

/** 最後の標本を取り出す。無ければテストを失敗させる。 */
export function lastSample<Sample>(samples: readonly Sample[]): Sample {
  const last = samples.at(-1);
  assert.exists(last, "標本が無い");
  return last;
}

/** 時系列を motion-compare.mjs で読み、読めたときの要約を取り出す。読めなければテストを失敗させる。 */
export function summaryOf(timeline: unknown) {
  const read = summarizeTimeline(timeline);
  assert(read.ok, `時系列を読めない: ${read.ok ? "" : read.reason}`);
  return read.summary;
}

/** model が返す要素の状態。 */
type ElementState = {
  x: number;
  y: number;
  width: number;
  height: number;
  display?: string;
  opacity?: number;
};

/**
 * 偽物に差し替える大域変数の形。tsconfig は DOM の型を読まないので、テストが触る分だけをここで宣言する。
 * globalThis と同じオブジェクトを、この形として扱う（型だけの表明で、実行時は globalThis そのもの）。
 */
type FakeGlobals = {
  document: { querySelectorAll: () => unknown[] };
  getComputedStyle: (node: { style: unknown }) => unknown;
  requestAnimationFrame: (cb: () => void) => number;
  __parityMotionProbe?: { done: boolean };
  [name: string]: unknown;
};
// oxlint-disable-next-line typescript/consistent-type-assertions -- tsconfig は DOM の型を読まず、globalThis の型と偽物の形が重ならないので、unknown を挟む表明でしか同じオブジェクトをこの形として扱えない
export const fakeGlobal = globalThis as unknown as FakeGlobals;

/** 偽のページ環境の時計と、requestAnimationFrame が積んだコールバック。 */
type FakeEnv = { now: number; triggerAt: number | null; queue: (() => void)[] };

/** current() が返す状態を返す偽の要素。親要素の opacity は ancestorOpacity にする。 */
function fakeElement(current: () => ElementState | null, ancestorOpacity: number) {
  const parent = {
    nodeType: 1,
    parentElement: null,
    style: { display: "block", visibility: "visible", opacity: String(ancestorOpacity) },
  };
  // isConnected が真の間だけ読まれるので、要素の状態はある。
  const connected = (): ElementState => {
    const s = current();
    assert.exists(s, "要素が無い間に要素の状態を読んだ");
    return s;
  };
  return {
    nodeType: 1,
    parentElement: parent,
    get isConnected() {
      return current() !== null;
    },
    getBoundingClientRect() {
      const s = connected();
      return { x: s.x, y: s.y, width: s.width, height: s.height };
    },
    get style() {
      const s = connected();
      return {
        display: s.display ?? "block",
        visibility: "visible",
        opacity: String(s.opacity ?? 1),
      };
    },
  };
}

/** waitForFunction の判定を待つ間、1 回ごとに時計を frame 進めて積まれたコールバックを呼ぶ偽のページ。 */
function fakePage(env: FakeEnv, frame: number) {
  const tick = () => {
    env.now += frame;
    const callbacks = env.queue;
    env.queue = [];
    for (const cb of callbacks) cb();
  };
  return {
    evaluate: async <A, R>(fn: (arg: A) => R, arg: A) => fn(arg),
    waitForFunction: async (fn: () => unknown) => {
      for (let i = 0; i < 100000; i += 1) {
        if (fn()) return true;
        tick();
      }
      throw new Error("fake page: waitForFunction never resolved");
    },
  };
}

/** 偽のページ環境。model(elapsedSinceTrigger) が要素の状態を返す（null なら要素が無い）。 */
export function installEnv({
  model,
  matches = 1,
  ancestorOpacity = 1,
  frame = FRAME,
}: {
  model: (elapsed: number) => ElementState | null;
  matches?: number;
  ancestorOpacity?: number;
  frame?: number;
}) {
  const env: FakeEnv = { now: 1000, triggerAt: null, queue: [] };
  const current = () => model(env.triggerAt === null ? -1 : env.now - env.triggerAt);
  const element = fakeElement(current, ancestorOpacity);
  fakeGlobal.document = {
    querySelectorAll: () =>
      current() === null ? [] : Array.from({ length: matches }, () => element),
  };
  fakeGlobal.getComputedStyle = (node) => node.style;
  fakeGlobal.requestAnimationFrame = (cb) => env.queue.push(cb);
  Object.defineProperty(globalThis, "performance", {
    value: { now: () => env.now },
    configurable: true,
    writable: true,
  });
  const page = fakePage(env, frame);
  const trigger = async () => {
    env.triggerAt = env.now;
  };
  return { env, page, trigger };
}

/** 操作から 20ms 後に出て、600ms かけて 40px 降りる。 */
export const slideIn = (elapsed: number) => {
  if (elapsed < 20)
    return elapsed < 0 ? null : { x: 10, y: 0, width: 0, height: 0, display: "none" };
  const p = Math.min(1, (elapsed - 20) / 600);
  return { x: 10, y: 60 + 40 * p, width: 200, height: 40, opacity: 0.5 + 0.5 * p };
};
