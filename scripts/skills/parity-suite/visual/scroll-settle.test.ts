// 全画面を撮る前に末尾までスクロールする処理（parity-suite 同梱の scroll-settle.mjs）のテスト（Issue #1155）。
// 期待値は parity-suite の references/baseline.md「全画面を撮る前に末尾までスクロールする」の取り決め（上限・始めの位置に戻す・
// content-visibility: auto の上書き・記録の形）から決める。
// 後半は、実際の Chrome（headless）でページを開いて確かめる。Chrome は CI の ubuntu-latest のランナーにあるものを使う。
// 見つからなければ、確かめられないので失敗にする。

import { afterAll, assert, beforeAll, describe, expect, test } from "vitest";
import { chromium, type Browser, type Page } from "@playwright/test";
import { isArray } from "../../../lib/is-array.ts";
import { findChrome } from "../../../../skills/browser-test/scripts/feature-check.mjs";
import {
  DEFAULT_LIMITS,
  VERSION,
  assertPageVersion,
  incompleteSettle,
  limitsFromRecord,
  readLimits,
  settleByScrolling,
} from "../../../../skills/parity-suite/scripts/scroll-settle.mjs";
import {
  PAGE_VERSION,
  scrollThroughInPage,
} from "../../../../skills/parity-suite/scripts/page/scroll-settle.page.mjs";

const RECORD_LIMITS = { step_timeout_ms: 500, total_timeout_ms: 4_000, max_steps: 10 };

describe("readLimits", () => {
  test("省いたキーはデフォルトにする", () => {
    expect(readLimits()).toEqual(DEFAULT_LIMITS);
    expect(readLimits({ stepTimeoutMs: 100 })).toEqual({ ...DEFAULT_LIMITS, stepTimeoutMs: 100 });
  });

  test.each([
    ["0", { maxSteps: 0 }, /limits\.maxSteps must be a positive integer/],
    ["負の数", { stepTimeoutMs: -1 }, /limits\.stepTimeoutMs/],
    ["小数", { totalTimeoutMs: 1.5 }, /limits\.totalTimeoutMs/],
    ["null", { maxSteps: null }, /limits\.maxSteps/],
    ["文字列", { maxSteps: "3" }, /limits\.maxSteps/],
    ["知らないキー", { step_timeout_ms: 1 }, /unknown limits: step_timeout_ms/],
    ["配列", [], /limits must be an object/],
    ["null の上限", null, /limits must be an object/],
  ])("%s は受け付けない", (_label, limits, message) => {
    expect(() => readLimits(limits)).toThrow(message);
  });
});

describe("limitsFromRecord", () => {
  test("現側の記録の上限を読む", () => {
    expect(limitsFromRecord({ version: VERSION, limits: RECORD_LIMITS })).toEqual({
      stepTimeoutMs: 500,
      totalTimeoutMs: 4_000,
      maxSteps: 10,
    });
  });

  test.each([
    ["記録がオブジェクトでない", [], /record must be an object/],
    ["バージョンが違う", { version: "0", limits: RECORD_LIMITS }, /written by version "0"/],
    ["バージョンが無い", { limits: RECORD_LIMITS }, /written by version undefined/],
    ["limits が無い", { version: VERSION }, /record\.limits must be an object/],
    [
      "キーが欠けている",
      { version: VERSION, limits: { step_timeout_ms: 1, total_timeout_ms: 1 } },
      /missing: max_steps/,
    ],
    [
      "知らないキーがある",
      { version: VERSION, limits: { ...RECORD_LIMITS, extra: 1 } },
      /unknown: extra/,
    ],
    [
      "値が null（デフォルトにしない）",
      { version: VERSION, limits: { ...RECORD_LIMITS, max_steps: null } },
      /limits\.maxSteps/,
    ],
  ])("%s なら失敗する", (_label, record, message) => {
    expect(() => limitsFromRecord(record)).toThrow(message);
  });
});

describe("incompleteSettle", () => {
  test("末尾まで届き、打ち切った画像も無ければ null を返す", () => {
    expect(incompleteSettle({ stopped: null, timed_out_images: [] })).toBeNull();
  });

  test.each([
    [
      "末尾まで届かなかった",
      { stopped: "max_steps", timed_out_images: [] },
      /stopped before the end \(max_steps\)/,
    ],
    [
      "画像を打ち切った",
      { stopped: null, timed_out_images: [{ url: "http://x/a.png", y: 600 }] },
      /1 image\(s\) timed out: http:\/\/x\/a\.png/,
    ],
  ])("%s なら、その内容を 1 行の警告にする", (_label, record, message) => {
    expect(incompleteSettle(record)).toMatch(message);
  });

  test("両方に当たれば、両方を 1 行に書く", () => {
    const warning = incompleteSettle({
      stopped: "total_timeout",
      timed_out_images: [
        { url: "http://x/a.png", y: 0 },
        { url: "http://x/b.png", y: 600 },
      ],
    });
    expect(warning).toMatch(
      /total_timeout.*2 image\(s\) timed out: http:\/\/x\/a\.png, http:\/\/x\/b\.png/,
    );
    expect(warning).not.toContain("\n");
  });
});

test("page ファイルの PAGE_VERSION が VERSION と違えば失敗する", () => {
  expect(PAGE_VERSION).toBe(VERSION);
  expect(() => assertPageVersion(VERSION)).not.toThrow();
  expect(() => assertPageVersion("0")).toThrow(/copy both files from the same version/);
});

/** ページで返る結果の形。 */
type InPageResult = Awaited<ReturnType<typeof scrollThroughInPage>>;

function fakePage(result: Partial<InPageResult>) {
  const calls: unknown[][] = [];
  const full: InPageResult = {
    start: { x: 0, y: 0 },
    end: { x: 0, y: 0 },
    steps: 1,
    scroll_height: 600,
    viewport_height: 600,
    stopped: null,
    timed_out_images: [],
    content_visibility_overridden: 0,
    ...result,
  };
  return {
    calls,
    page: {
      evaluate: async (fn: unknown, arg: unknown) => {
        calls.push([fn, arg]);
        return full;
      },
    },
  };
}

describe("settleByScrolling（偽のページ）", () => {
  test("ページへ scrollThroughInPage と読んだ上限を渡し、記録を返す", async () => {
    const { page, calls } = fakePage({
      steps: 3,
      scroll_height: 1500,
      stopped: "max_steps",
      timed_out_images: [{ url: "http://x/a.png", y: 600 }],
      content_visibility_overridden: 2,
    });
    const record = await settleByScrolling(page, { maxSteps: 3 });
    expect(calls).toEqual([[scrollThroughInPage, { ...DEFAULT_LIMITS, maxSteps: 3 }]]);
    expect(record).toEqual({
      version: VERSION,
      limits: {
        step_timeout_ms: DEFAULT_LIMITS.stepTimeoutMs,
        total_timeout_ms: DEFAULT_LIMITS.totalTimeoutMs,
        max_steps: 3,
      },
      steps: 3,
      scroll_height: 1500,
      viewport_height: 600,
      stopped: "max_steps",
      timed_out_images: [{ url: "http://x/a.png", y: 600 }],
      content_visibility_overridden: 2,
    });
  });

  test("記録から読んだ上限を渡すと、記録と同じ上限を書く（現側と新側で同じ記録になる）", async () => {
    const { page } = fakePage({});
    const record = await settleByScrolling(
      page,
      limitsFromRecord({ version: VERSION, limits: RECORD_LIMITS }),
    );
    expect(record.limits).toEqual(RECORD_LIMITS);
  });

  test.each([
    ["縦", { x: 0, y: 40 }],
    ["横", { x: 5, y: 0 }],
  ])("始めの位置に戻せなかったら（%s）例外にする", async (_label, end) => {
    const { page } = fakePage({ start: { x: 0, y: 0 }, end });
    await expect(settleByScrolling(page)).rejects.toThrow(/could not scroll back to \(0, 0\)/);
  });

  test("上限が不正なら、ページで何もせずに失敗する", async () => {
    const { page, calls } = fakePage({});
    await expect(settleByScrolling(page, { maxSteps: 0 })).rejects.toThrow(/limits\.maxSteps/);
    expect(calls).toEqual([]);
  });
});

// ---- 実際の Chrome で確かめる ----

/** 1×1 の赤い PNG。 */
const RED_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);
const ORIGIN = "http://scroll-settle.test";

/** 高さ 3000px の要素の下に、遅延読み込みの画像・IntersectionObserver の要素・content-visibility の要素を置いたページ。 */
function pageHtml({ never = false } = {}): string {
  return `<!doctype html><meta charset="utf-8"><style>
body{margin:0} .spacer{height:3000px} .box{width:200px;height:200px;display:block}
#io{background:#00f} #io.seen{background:#0f0}
#cv{content-visibility:auto;contain-intrinsic-size:200px 200px;width:200px} #cv div{width:200px;height:200px;background:#f0f}
#cvh{content-visibility:hidden;contain-intrinsic-size:200px 200px;width:200px;height:200px} #cvh div{width:200px;height:200px;background:#ff0}
</style>
<div class="spacer"></div>
<img id="lazy" class="box" loading="lazy" src="/img/red.png?token=secret#f">
<div id="io" class="box"></div>
<div id="cv"><div></div></div>
<div id="cvh"><div></div></div>
${never ? '<img id="never" class="box" loading="lazy" src="/img/never.png?sig=abc">' : ""}
<div style="height:100px"></div>
<script>
new IntersectionObserver((es)=>{for(const e of es) if(e.isIntersecting) e.target.classList.add('seen')}).observe(document.getElementById('io'));
</script>`;
}

let browser: Browser;
/** 撮った画像の画素を読むページ。テストの間で使い回す。 */
let reader: Page;

beforeAll(async () => {
  browser = await chromium.launch({ executablePath: findChrome(undefined, process.env) });
  reader = await browser.newPage();
});

afterAll(async () => {
  await browser?.close();
});

/**
 * ページを開く。setup は、ページを開く前の準備（時刻の固定など）である。
 */
async function openPage(
  html: string,
  {
    viewport = { width: 800, height: 600 },
    setup,
  }: { viewport?: { width: number; height: number }; setup?: (page: Page) => Promise<void> } = {},
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await setup?.(page);
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = route.request().url();
    // 読み込みが終わらない画像（応答しない）
    if (url.includes("never.png")) return;
    if (url.includes("/img/")) return route.fulfill({ contentType: "image/png", body: RED_PNG });
    return route.fulfill({ contentType: "text/html", body: html });
  });
  await page.goto(`${ORIGIN}/`);
  return { page, close: () => context.close() };
}

/**
 * ページで式を評価し、数の配列として読む。テストは DOM の型を読み込まないので、ページで実行するコードは式の文字列で渡す。
 * @param expression 数の配列を返す式
 */
async function numbersIn(page: Page, expression: string): Promise<number[]> {
  const value: unknown = await page.evaluate(expression);
  assert(isArray(value), `${expression} が配列でない`);
  const numbers = value.filter((v): v is number => typeof v === "number");
  assert(numbers.length === value.length, `${expression} が数の配列でない`);
  return numbers;
}

/** いまのスクロールの位置（x, y）。 */
const scrollPosition = (page: Page) => numbersIn(page, "[window.scrollX, window.scrollY]");

/** 全画面の画像で、要素ごとに中心の画素の色（"r,g,b"）を読む。画像は 1 回だけ読む。 */
async function colorsInFullShot(
  page: Page,
  shot: Buffer,
  ids: string[],
): Promise<Record<string, string>> {
  const [scrollX, scrollY] = await scrollPosition(page);
  const points: number[][] = [];
  for (const id of ids) {
    const box = await page.locator(`#${id}`).boundingBox();
    assert(box, `#${id} が見つからない`);
    points.push([
      Math.floor(box.x + scrollX + box.width / 2),
      Math.floor(box.y + scrollY + box.height / 2),
    ]);
  }
  const rgb = await numbersIn(
    reader,
    `(async () => {
      const img = new Image();
      img.src = "data:image/png;base64,${shot.toString("base64")}";
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return ${JSON.stringify(points)}.flatMap(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3));
    })()`,
  );
  return Object.fromEntries(ids.map((id, i) => [id, rgb.slice(i * 3, i * 3 + 3).join(",")]));
}

describe("実際の Chrome で確かめる", () => {
  test("Chrome が見つかる（見つからなければ、この節のテストは確かめられない）", () => {
    expect(() => findChrome(undefined, process.env)).not.toThrow();
  });

  test("スクロールせずに全画面で撮ると、画面の下の遅延読み込みの内容は描画されない（この処理が要る理由）", async () => {
    const { page, close } = await openPage(pageHtml());
    try {
      const shot = await page.screenshot({ fullPage: true, animations: "disabled" });
      expect(await colorsInFullShot(page, shot, ["lazy", "io", "cv"])).toEqual({
        lazy: "255,255,255",
        io: "0,0,255",
        cv: "255,255,255",
      });
    } finally {
      await close();
    }
  });

  test.each([
    { width: 800, height: 600 },
    { width: 400, height: 600 },
  ])(
    "末尾までスクロールしてから撮ると、遅延読み込みの画像・IntersectionObserver の要素・content-visibility: auto の要素が描画される（$width×$height）",
    async (viewport) => {
      const { page, close } = await openPage(pageHtml(), { viewport });
      try {
        const record = await settleByScrolling(page);
        expect(await scrollPosition(page)).toEqual([0, 0]);
        const shot = await page.screenshot({ fullPage: true, animations: "disabled" });
        // content-visibility: hidden の要素（cvh）は、ページが意図して隠しているので上書きしない
        expect(await colorsInFullShot(page, shot, ["lazy", "io", "cv", "cvh"])).toEqual({
          lazy: "255,0,0",
          io: "0,255,0",
          cv: "255,0,255",
          cvh: "255,255,255",
        });
        expect(record).toMatchObject({
          stopped: null,
          timed_out_images: [],
          content_visibility_overridden: 1,
          viewport_height: 600,
        });
        expect(record.steps).toBeGreaterThan(1);
      } finally {
        await close();
      }
    },
  );

  test("読み込まれない画像は上限で打ち切り、URL をクエリを外して記録し、撮影は続けられる", async () => {
    const { page, close } = await openPage(pageHtml({ never: true }));
    try {
      const record = await settleByScrolling(page, { stepTimeoutMs: 300 });
      expect(record.stopped).toBeNull();
      expect(record.timed_out_images).toEqual([
        { url: `${ORIGIN}/img/never.png`, y: expect.any(Number) },
      ]);
      const shot = await page.screenshot({ fullPage: true, animations: "disabled" });
      expect(await colorsInFullShot(page, shot, ["lazy"])).toEqual({ lazy: "255,0,0" });
    } finally {
      await close();
    }
  });

  test("時刻を固定しても（page.clock.setFixedTime）、上限で打ち切って返る", async () => {
    const { page, close } = await openPage(pageHtml({ never: true }), {
      setup: (p) => p.clock.setFixedTime(new Date("2026-01-02T03:04:05Z")),
    });
    try {
      const record = await settleByScrolling(page, { stepTimeoutMs: 300 });
      expect(record.timed_out_images).toHaveLength(1);
    } finally {
      await close();
    }
  });

  test("始めの位置がスクロールした位置なら、その位置に戻す", async () => {
    const { page, close } = await openPage(pageHtml());
    try {
      await page.evaluate("window.scrollTo(0, 500)");
      await settleByScrolling(page);
      expect(await scrollPosition(page)).toEqual([0, 500]);
    } finally {
      await close();
    }
  });

  test("位置の数の上限に達したら、末尾まで届かずに止めた理由を記録する", async () => {
    const { page, close } = await openPage(pageHtml());
    try {
      const record = await settleByScrolling(page, { maxSteps: 2 });
      expect(record).toMatchObject({ steps: 2, stopped: "max_steps" });
      expect(await scrollPosition(page)).toEqual([0, 0]);
    } finally {
      await close();
    }
  });

  test("全体の時間の上限に達したら、その理由を記録する", async () => {
    const { page, close } = await openPage(pageHtml());
    try {
      const record = await settleByScrolling(page, { totalTimeoutMs: 1 });
      expect(record.stopped).toBe("total_timeout");
    } finally {
      await close();
    }
  });

  test("スクロールしても位置が戻されるページでは、同じ位置で待ち続けずに止める", async () => {
    // スクロールのたびに先頭へ戻すページ（文書がスクロールしない形の代わり）
    const html = pageHtml().replace(
      "<script>",
      "<script>addEventListener('scroll',()=>{if(scrollY>0)scrollTo(0,0)});",
    );
    const { page, close } = await openPage(html);
    try {
      const record = await settleByScrolling(page);
      expect(record).toMatchObject({ steps: 2, stopped: "not_scrolled" });
    } finally {
      await close();
    }
  });

  test("requestAnimationFrame が呼ばれないページ（見えていないタブなど）でも、末尾までスクロールして返る", async () => {
    const { page, close } = await openPage(pageHtml(), {
      // ページの scripts より先に、requestAnimationFrame を呼ばれない関数に差し替える
      setup: async (p) => {
        await p.addInitScript("window.requestAnimationFrame = () => 0;");
      },
    });
    try {
      const record = await settleByScrolling(page);
      expect(record).toMatchObject({ stopped: null, timed_out_images: [] });
      expect(record.steps).toBeGreaterThan(1);
    } finally {
      await close();
    }
  });

  test("画面に収まるページでは、1 つの位置だけで終える", async () => {
    const { page, close } = await openPage("<!doctype html><p>short</p>");
    try {
      const record = await settleByScrolling(page);
      expect(record).toMatchObject({ steps: 1, stopped: null, content_visibility_overridden: 0 });
    } finally {
      await close();
    }
  });
});
