/**
 * 新側ベースライン採取スペック（雛形）— parity-diff
 *
 * このファイルはプロジェクトへコピーして使う雛形。コピー先の既定は
 * `<parity_suite_dir>/parity/<slug>/new-only/capture-new.spec.ts`（実際のパスは
 * `.replace/parity/<slug>/metadata.json` の `suite.new_only` に記録する）。
 *
 * 満たすべきこと（parity-diff の references/capture-new.md が要求する条件）:
 *   1. 現側と同一条件で撮る。条件は手で書き写さず metadata.json の capture_conditions から引く
 *   2. 現側ベースラインと対称のレイアウトで書き出す（page × state × viewport の対応が取れる形）
 *   3. 同一条件で 2 回撮り、新側の自己ノイズを測れるようにする（2 回目は別ディレクトリへ）。
 *      2 回目は測定後に parity-diff が削除する一時作業物であり、成果物として残さない
 *   4. 採取専用の `new-capture` プロジェクトでだけ走らせる。`current` にも `new` にも入れない
 *      （`current` に入ると現行アプリの画面が新側ベースラインとして書き出され差分ゼロに化ける。
 *      `new` に残すと、採取用の環境変数を渡さない parity-replace の green 検証が
 *      このファイルの読み込み時点で落ち、往復ループが進まなくなる）。
 *      除外は playwright.config の `current` / `new` の `testIgnore: '**\/new-only\/**'` で行い、
 *      採取は `testDir` を new-only/ に絞った `new-capture` プロジェクトが担う
 *      （parity-suite が設定し `metadata.json` の `suite.new_only` に記録する）。
 *      下の beforeEach は設定漏れに備えた fail-fast であり、testIgnore の代わりではない
 *
 * 環境変数:
 *   PARITY_NEW_TARGET  … 対象の新側 target 名（必須。成果物の出力先 new/<target>/ を決める）
 *   PARITY_SLUG        … 対象機能の slug（必須。.replace/features.md が採番したもの）
 *   PARITY_CAPTURE_PASS… "baseline"（既定。1 回目＝新側ベースライン）| "noise"（2 回目＝自己ノイズ用）
 *   PARITY_NOISE_PAIRS … noise パスで撮り直す組（"page|state|viewport" のカンマ区切り）。未設定なら全組
 *   PARITY_CAPTURE_PAIRS … baseline パスで撮る組（同じ書式）。未設定なら全組。部品改修の一括再検証
 *                        （parity-diff の references/component-change.md）で、component-impact.mjs が返した
 *                        影響する組だけを撮り直すために使う。撮らない組の baseline-new は触らない
 *   PARITY_NEW_UI_URL  … 新側 UI の baseURL（playwright.config の `new-capture` プロジェクトが参照する）
 *   PARITY_REPO_ROOT   … `.replace/` を持つリポジトリルート（省略時は cwd）。Playwright は
 *                        playwright.config のあるディレクトリ（既定 `e2e/`）から起動されることがあり、
 *                        cwd 相対のままだと metadata が読めない／成果物が `e2e/.replace/...` へ逸れる
 *
 * 1 回目と 2 回目の差分量（pixel_diff / trait_diffs）を測るのはスペックの仕事ではない。
 * 記録済みの画素差分ツールと trait-compare に、下の 2 つの出力ディレクトリを渡して測る。
 *
 * 撮影に使ったブラウザの同一性（ブラウザ名・版・userAgent・channel・headless・ブラウザ側とランナーの OS）は
 * `new/<target>/browser-identity.<pass>.json` に書き出す。parity-diff が自己ノイズの測定値を再利用するかを決める
 * 指紋（diff-metadata.json の noise_measurement.fingerprint.capture_conditions）へ入れる。
 */
import { readFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
// 現側の capture_conditions.browser が cdp なら、@playwright/test ではなく共通のフィクスチャ（利用者環境のブラウザへ接続する。
// parity-suite の references/locator-mapping.md「利用者環境のブラウザへ接続する」）から import する
import { test } from "@playwright/test";

// TODO: プロジェクトの現側スペックが使っている入口をそのまま使う（現側と対称に書く）。
//       パスは metadata.json の suite.locator_map / suite.interactions / suite.tools から引き、推測しない。
import { captureTraits } from "../../lib/tools/vendor/trait-capture.mjs";
import { resolveLocator as resolveCurrent } from "../../lib/locator-map/<slug>";
// 新側のロケータ例外（new/<target>/replace-metadata.json の suite.locator_map_new が指すファイル）。
// 例外ゼロなら parity-replace はこのファイルを作らないので、その場合はこの import ごと外す。
import { resolveLocator as resolveNewException } from "../../lib/locator-map/<slug>.new";
import { applyState } from "../../lib/interactions";
// 表示の軸（capture_conditions.display_axes）を持つ機能だけ使う。軸が無ければこの import と呼び出しごと外してよい
import { applyDisplayAxes } from "../../lib/interactions";

const slug = requireEnv("PARITY_SLUG");
const target = requireEnv("PARITY_NEW_TARGET");
const pass = process.env.PARITY_CAPTURE_PASS ?? "baseline";
if (pass !== "baseline" && pass !== "noise") {
  // 綴り違いを既定へ落とすと 2 回目の撮影が新側ベースラインを静かに上書きする
  throw new Error(`PARITY_CAPTURE_PASS must be "baseline" or "noise" (got "${pass}")`);
}
const repoRoot = process.env.PARITY_REPO_ROOT ?? process.cwd();

// 撮影条件は metadata.json（parity-suite が記録した現側の条件）から引く。手で書き写さない。
// pages[].name は noise_baseline[].page と同じ語彙、masks[].name はロケータマッピングで解決できる論理名
// （形式の正本は parity-suite の assets/metadata-template.json の capture_conditions）
const metadata = JSON.parse(
  readFileSync(join(repoRoot, ".replace", "parity", slug, "metadata.json"), "utf8"),
);
const { viewports, states, masks, full_page: fullPage } = metadata.capture_conditions;
const pages: { name: string; path: string }[] = metadata.capture_conditions.pages;

// 表示を切り替える軸。基準の組は全軸の既定値を明示して当て、変種（variants）は既定値に変種の値を重ねて当てる。
// 変種の label はビューポートの label と同じ位置（書き出し先・組の鍵）に入り、窓の寸法は変種の viewport が指す窓を使う
// （形式の正本は parity-suite の assets/metadata-template.json の capture_conditions.display_axes）
type Axis = { name: string; default: string; not_applicable?: { page: string }[] };
type Variant = { label: string; viewport: string; values: Record<string, string> };
const displayAxes = metadata.capture_conditions.display_axes;
if (!displayAxes || !Array.isArray(displayAxes.axes) || !Array.isArray(displayAxes.variants)) {
  // 軸を数えていない現側成果物で撮ると、既定の 1 値だけの比較が「全部撮った」ように見える
  throw new Error("capture_conditions.display_axes is missing: parity-suite で軸を数えさせる");
}
const axes: Axis[] = displayAxes.axes;
const defaults: Record<string, string> = Object.fromEntries(axes.map((a) => [a.name, a.default]));
const shots = [
  ...viewports.map((v: { label: string; width: number; height: number }) => ({
    label: v.label,
    width: v.width,
    height: v.height,
    values: {} as Record<string, string>,
  })),
  ...(displayAxes.variants as Variant[]).map((variant) => {
    const base = viewports.find((v: { label: string }) => v.label === variant.viewport);
    if (!base)
      throw new Error(
        `display_axes.variants ${variant.label}: viewport ${variant.viewport} is unknown`,
      );
    return { label: variant.label, width: base.width, height: base.height, values: variant.values };
  }),
];
// 変種の軸を not_applicable と宣言したページは、その変種で撮らない（現側と同じ集合にする）
function applies(shot: { values: Record<string, string> }, pageName: string): boolean {
  return Object.keys(shot.values).every(
    (axis) =>
      !axes.find((a) => a.name === axis)?.not_applicable?.some((na) => na.page === pageName),
  );
}

// 撮影に使うブラウザは現側と揃える。片側だけ利用者環境で撮ると、環境の差がそのまま差分に出る
const browserMode: unknown = metadata.capture_conditions.browser;
if (browserMode !== "launched" && browserMode !== "cdp") {
  throw new Error(
    `capture_conditions.browser must be "launched" or "cdp" (got ${JSON.stringify(browserMode)}): parity-suite で記録させる`,
  );
}
if ((browserMode === "cdp") !== Boolean(process.env.PARITY_NEW_CDP_URL)) {
  throw new Error(
    `current side captured with browser "${browserMode}" but PARITY_NEW_CDP_URL is ${process.env.PARITY_NEW_CDP_URL ? "set" : "unset"}: ` +
      "新側 target の browser.cdp_url を現側と揃える",
  );
}

// baseline パスは新側ベースライン本体、noise パスは自己ノイズ測定用の 2 回目
// （noise-pass2/ は測定値を diff-metadata.json へ記録した時点で parity-diff が削除する。
//  次の測定はここへ撮り直すので、不在は欠落ではない）
const outRoot = join(
  repoRoot,
  ".replace",
  "parity",
  slug,
  "new",
  target,
  pass === "noise" ? "noise-pass2" : "baseline-new",
);
const onlyPairs = (process.env.PARITY_NOISE_PAIRS ?? "").split(",").filter(Boolean);
const capturePairs = (process.env.PARITY_CAPTURE_PAIRS ?? "").split(",").filter(Boolean);
if (capturePairs.length > 0 && pass !== "baseline") {
  // noise パスの絞り込みは PARITY_NOISE_PAIRS が持つ。2 つの変数が別々の組を指すと、どちらで絞ったか読めない
  throw new Error(
    "PARITY_CAPTURE_PAIRS is for the baseline pass; use PARITY_NOISE_PAIRS for the noise pass",
  );
}

// 新側は「現側マッピング → 新側例外」の順で解決する（例外は解決できない論理名だけを埋める契約）
function resolveLocator(page: import("@playwright/test").Page, name: string) {
  return resolveNewException(page, name) ?? resolveCurrent(page, name);
}

// page / state / viewport はそのままディレクトリ階層になる。`..` が混じると join が outRoot の
// 外を指し、noise パスの rmSync が採取ディレクトリの外を消しうる。撮影・削除の前に落とす
function assertInsideOutRoot(dir: string): void {
  const rel = relative(outRoot, dir);
  // page / state / viewport（変種の label）の 3 段がそれぞれ 1 つのディレクトリ名であることまで確かめる。
  // `.` / `..` は outRoot の内側に収まったまま別の組のディレクトリを指し、noise パスの削除が兄弟の組を消す
  const segments = rel.split(/[\\/]/);
  if (
    rel === "" ||
    rel.startsWith("..") ||
    isAbsolute(rel) ||
    segments.length !== 3 ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(
      `capture output "${dir}" escapes "${outRoot}": ` +
        "check capture_conditions.pages[].name / states / viewports for path traversal",
    );
  }
}

// PARITY_NOISE_PAIRS の語彙が pages[].name とずれると「全組スキップ＝自己ノイズ未測定」が
// 静かに成功扱いになる。ずれは撮影前に落とす（安全側＝測り直しではなく停止）
const allPairs = new Set<string>(
  shots.flatMap((v) =>
    pages
      .filter((p) => applies(v, p.name))
      .flatMap((p) => states.map((s: string) => `${p.name}|${s}|${v.label}`)),
  ),
);
const unknownPairs = [...onlyPairs, ...capturePairs].filter((pair) => !allPairs.has(pair));
if (unknownPairs.length > 0) {
  throw new Error(
    `PARITY_NOISE_PAIRS / PARITY_CAPTURE_PAIRS have pairs that match no capture target: ${unknownPairs.join(", ")}. ` +
      "capture_conditions.pages[].name must use the same vocabulary as noise_baseline[].page",
  );
}

// スクロールバーの扱いは現側と揃える（capture_conditions.scrollbars。片側だけ場所を取ると、見える幅と高さが
// 厚みの分ずれて全面差分になる）。Playwright のヘッドレス Chromium の既定は hidden（--hide-scrollbars）。
// launchOptions はワーカー単位の設定なので describe の中には置けず、ファイルの最上位で切り替える。
// test.use はプロジェクトの launchOptions をオブジェクトごと置き換えるので、new-capture に launchOptions（args 等）が
// あるならその値をここへ写してから ignoreDefaultArgs を足す（落とすと現側と起動条件がずれる）
const scrollbars: unknown = metadata.capture_conditions.scrollbars;
if (scrollbars !== "hidden" && scrollbars !== "shown") {
  throw new Error(
    `capture_conditions.scrollbars must be "hidden" or "shown" (got ${JSON.stringify(scrollbars)}): parity-suite で記録させる`,
  );
}
if (scrollbars === "shown") {
  test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });
}

// 撮影に使ったブラウザの同一性。launched でも、ランナー・OS の移動、Playwright の更新による版の変化、
// channel / headless の変更で描画環境は変わる。parity-diff はこれを自己ノイズの指紋へ入れ、前回と違えば測り直す。
// 2 回目（noise）も書き、1 回目と違えば同じ環境で 2 回撮れていないので parity-diff が測定を捨てる。
// 書き出し先は outRoot の外（noise-pass2/ は測定後に消える。組のディレクトリ 3 段の外に置く）
const identityPath = join(
  repoRoot,
  ".replace",
  "parity",
  slug,
  "new",
  target,
  `browser-identity.${pass}.json`,
);
// 同一性は撮影に使うページ（プロジェクトの use の userAgent・デバイスの設定が当たったコンテキスト）から読む。
// browser.newPage() の既定のコンテキストで読むと、撮影側の userAgent と食い違う。
// OS も撮影するブラウザ側から読む——cdp では Node のランナーと描画する機械が別なので、os モジュールはランナーしか表さない。
// ランナーの OS は runner_os に別に残す
let identityRecorded = false;

// 描画するブラウザ側の OS。現側の browser_identity.browser_os と同じ正規化で読む
// （正本は parity-suite の references/locator-mapping.md「利用者環境のブラウザへ接続する」。読み方・拾うキーを変えるなら両方を変える）。
// - 撮影に使うコンテキストでは読まない。use の userAgent（デバイスの設定を含む）を当てると、Playwright は userAgentData も
//   その文字列から作って上書きする（Linux の機械で Mac の UA を当てると platform が macOS になる。実測）ので、機械を表さない。
//   同じブラウザに設定を当てない別のコンテキストを作って読み、閉じる（cdp では接続先の機械、launched では起動した機械）
// - userAgentData は安全なコンテキストにしか無い。Playwright が開いた直後の about:blank は安全なコンテキストでない（実測）ので、
//   合成した https の URL を route で返した頁で読む。撮影に使うページは移動させない（verifyScrollbars は about:blank で測る契約）
// - 拾うのは platform / platformVersion / architecture の 3 キーだけ（getHighEntropyValues は brands・mobile も返す。版は product が持つ）
// - userAgentData を持たないブラウザ（Firefox / WebKit）は navigator.platform だけを残す。cdp の接続先は Chromium 系で、
//   現側の記録にこの形は capture-scope-check.mjs が通さない（Chromium の platform も縮められている）ので、cdp の照合では食い違いとして止まる
const BROWSER_OS_PROBE_URL = "https://parity-browser-os.invalid/";
let browserOs: Record<string, string> | null = null;
async function readBrowserOs(
  browser: import("@playwright/test").Browser | null,
): Promise<Record<string, string>> {
  if (browserOs !== null) return browserOs;
  if (!browser) throw new Error("capture page has no browser: 描画するブラウザ側の OS を読めない");
  const context = await browser.newContext();
  try {
    const probe = await context.newPage();
    await probe.route(BROWSER_OS_PROBE_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>os</title>",
      }),
    );
    await probe.goto(BROWSER_OS_PROBE_URL);
    browserOs = await probe.evaluate(async () => {
      const data = (
        navigator as Navigator & {
          userAgentData?: {
            getHighEntropyValues(hints: string[]): Promise<Record<string, string>>;
          };
        }
      ).userAgentData;
      if (!data) return { platform: navigator.platform };
      const v = await data.getHighEntropyValues(["platform", "platformVersion", "architecture"]);
      return {
        platform: v.platform,
        platformVersion: v.platformVersion,
        architecture: v.architecture,
      };
    });
  } finally {
    await context.close();
  }
  return browserOs;
}
// 現新の OS をキーの集合ごと完全一致で照合する（片側だけ navigator.platform に代替した形・キーの過不足は食い違いとして扱う）
function sameBrowserOs(a: unknown, b: Record<string, string>): boolean {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  const left = a as Record<string, unknown>;
  const keys = Object.keys(left).sort();
  const want = Object.keys(b).sort();
  return keys.length === want.length && keys.every((k, i) => k === want[i] && left[k] === b[k]);
}
// スクロールバーの扱いは起動引数ではなく、撮影に使うページで実測して確かめる。
// cdp では共通のフィクスチャが connectOverCDP で接続するので launchOptions は効かず、接続先が --hide-scrollbars や
// オーバーレイのバーで起動していても分からない。launched でもプロジェクトの launchOptions が上書きしうる。
// overflow: scroll の箱を 1 つ置いてバーの幅を読み、現側の scrollbars と食い違えば撮らない（片側だけ場所を取る）。
// 読むのは頁へ移動する前の about:blank——確かめるのはブラウザの起動の仕方で、頁の CSS（scrollbar-width: none 等）ではない。
// 頁の CSS で隠したバーは現側も同じ CSS で隠れ、器ごとの差は trait-capture.mjs の scroll が照合する。
// 移動後に測ると、頁が正当にバーを隠しているだけで shown の撮影が止まる
let scrollbarPx: number | null = null;
async function verifyScrollbars(page: import("@playwright/test").Page): Promise<number> {
  if (scrollbarPx !== null) return scrollbarPx;
  const px = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:absolute;top:-10000px;left:0;width:100px;height:100px;overflow:scroll;border:0";
    document.body.appendChild(probe);
    const width = probe.offsetWidth - probe.clientWidth;
    probe.remove();
    return width;
  });
  if (scrollbars === "shown" && px === 0) {
    throw new Error(
      "capture_conditions.scrollbars is shown but scrollbars take no space in the capture browser (--hide-scrollbars が残っているか、オーバーレイのバー): 現側と同じ扱いで撮る",
    );
  }
  if (scrollbars === "hidden" && px > 0) {
    throw new Error(
      `capture_conditions.scrollbars is hidden but scrollbars take ${px}px in the capture browser: 現側と同じ扱いで撮る`,
    );
  }
  scrollbarPx = px;
  return px;
}
async function recordIdentity(
  page: import("@playwright/test").Page,
  browserName: string,
  testInfo: import("@playwright/test").TestInfo,
): Promise<void> {
  const barPx = await verifyScrollbars(page);
  if (identityRecorded) return;
  identityRecorded = true;
  // beforeAll ではなく最初のテストで読むので、ワーカーごとに 1 回。書くのは並列の枠 0 のワーカーだけにし
  // （同じプロジェクトのワーカーは同じブラウザ・同じ use で撮る）、一時ファイルからの rename で書く（途中まで書いたファイルを parity-diff が読まない）
  if (testInfo.parallelIndex !== 0) return;
  const seen = {
    userAgent: await page.evaluate(() => navigator.userAgent),
    os: await readBrowserOs(page.context().browser()),
  };
  writeJsonAtomic(identityPath, {
    browser: browserMode,
    browser_name: browserName,
    product: page.context().browser()?.version() ?? null,
    user_agent: seen.userAgent,
    // project の use に書いた値（未指定は null＝Playwright の既定）。test.use で上書きした scrollbars の起動引数は scrollbars が持つ
    channel: testInfo.project.use.channel ?? null,
    headless: testInfo.project.use.headless ?? null,
    browser_os: seen.os,
    runner_os: `${platform()} ${release()} ${arch()}`,
    // 撮影ページで実測したスクロールバーの幅（overflow: scroll の箱）。バーの種類・厚みが変われば描画環境も変わる
    scrollbar_px: barPx,
  });
}

test.beforeEach(async (_fixtures, testInfo) => {
  // fail-fast: current で走ると現行アプリを新側ベースラインとして書き出す（testIgnore の設定漏れ対策）
  if (testInfo.project.name !== "new-capture") {
    throw new Error(
      `new-only spec ran under project "${testInfo.project.name}": exclude it with testIgnore`,
    );
  }
});

for (const viewport of shots) {
  test.describe(`viewport=${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const pageDef of pages) {
      if (!applies(viewport, pageDef.name)) continue;
      for (const state of states) {
        const pair = `${pageDef.name}|${state}|${viewport.label}`;
        // 収集時点（撮影・削除より前）に検証する
        const outDir = join(outRoot, pageDef.name, state, viewport.label);
        assertInsideOutRoot(outDir);

        test(`capture ${pair}`, async ({ page, browserName }, testInfo) => {
          // 撮影に使うページでスクロールバーの扱いを実測し、同一性を読む（組を飛ばす前に行う。全組を再利用する noise パスでも書く）
          await recordIdentity(page, browserName, testInfo);
          // noise パスは「測り直す組」だけを撮る（再利用の可否は parity-diff が判定して PARITY_NOISE_PAIRS で渡す）。
          // noise パスの出力は撮る組・撮らない組とも先に消す——前反復の 2 回目が残っていると、
          // 撮らない組は「今回の baseline-new」対「前反復の 2 回目」が突き合わされて反復間のコード変更を
          // 自己ノイズとして計上し、撮る組は今回撮り直さなかったファイルが混ざる。
          // 通常は前回の測定後に parity-diff が削除済みなので no-op で、削除が中断した場合の保険として残す
          const reused = pass === "noise" && onlyPairs.length > 0 && !onlyPairs.includes(pair);
          if (pass === "noise") rmSync(outDir, { recursive: true, force: true });
          test.skip(reused, "reused noise measurement");
          // baseline パスの絞り込み: 撮らない組は前回の baseline-new をそのまま残す（削除しない。
          // 部品改修の機械判定は前回の新側と今回の新側を比べるため、前回分は呼び出し側が別の場所へ写してある）
          test.skip(
            pass === "baseline" && capturePairs.length > 0 && !capturePairs.includes(pair),
            "not in PARITY_CAPTURE_PAIRS",
          );

          mkdirSync(outDir, { recursive: true });

          // browser が cdp なら、共通のフィクスチャが接続した印を確かめる（import の差し替え漏れで、起動したブラウザのまま撮らない）
          if (browserMode === "cdp" && process.env.PARITY_CDP_CONNECTED !== "1") {
            throw new Error(
              "capture_conditions.browser is cdp but the browser was not connected over CDP: import test from the shared fixtures",
            );
          }
          // cdp では、現側が撮った利用者環境と同じブラウザへ接続したかを確かめる（モードだけが揃って別の機械で撮ると、環境の差が差分に出る）
          if (browserMode === "cdp") {
            const identity = metadata.capture_conditions.browser_identity;
            const product = page.context().browser()?.version();
            const userAgent = await page.evaluate(() => navigator.userAgent);
            // reduced UA は OS の版を固定値に縮めるので、product と userAgent だけでは OS の版・アーキテクチャが違う機械を見分けられない
            const os = await readBrowserOs(page.context().browser());
            if (identity && !Object.hasOwn(identity, "browser_os")) {
              throw new Error(
                "current side browser_identity has no browser_os: parity-suite で現側を撮り直す（描画するブラウザ側の OS を照合できない。手順の改訂 5）",
              );
            }
            if (
              !identity ||
              identity.product !== product ||
              identity.user_agent !== userAgent ||
              !sameBrowserOs(identity.browser_os, os)
            ) {
              throw new Error(
                `connected browser differs from the current side (current: ${JSON.stringify(identity)}, new: ${JSON.stringify({ product, user_agent: userAgent, browser_os: os })}): 新側 target の browser.cdp_url を現側と同じ利用者環境へ向ける`,
              );
            }
          }
          await page.goto(pageDef.path);
          // 表示の軸の値は状態へ遷移する前に当てる（基準の組も既定値を明示して当てる。ブラウザや OS の既定に委ねない）
          if (axes.length > 0) await applyDisplayAxes(page, { ...defaults, ...viewport.values });
          // 状態遷移は現側と同じ操作アダプタを使う（遷移できない状態は例外にして停止させる）。
          // applyState は撮る対象の矩形が 2 回続けて同じ値になるまで待ってから返す契約
          // （正本は parity-suite の references/baseline.md「撮る対象が動かなくなるまで待つ」）。
          // 出現直後に撮ると 1 画素の上下で結果が 2 値に転び、自己ノイズの 2 回撮りでは検出できない
          await applyState(page, state);

          // 撮影条件（アニメーション無効・マスク）は現側と同一。
          // 出典: https://playwright.dev/docs/api/class-page#page-screenshot（animations / mask）
          await page.screenshot({
            path: join(outDir, "screenshot.png"),
            // 現側が全画面で撮ったかビューポート内で撮ったかは capture_conditions.full_page が持つ。
            // ここを決め打ちすると画像サイズが違い、条件一致検証を通り抜けたまま全ページが全面差分になる
            fullPage: fullPage,
            animations: "disabled",
            mask: masks.map((m: { name: string }) => resolveLocator(page, m.name)),
          });

          // 特性は論理名 1 件ずつ渡して採る（まとめて渡すと 1 件の失敗で既採取分ごと失う）
          const traits = [];
          for (const name of metadata.traits.elements) {
            traits.push(...(await captureTraits([{ name, locator: resolveLocator(page, name) }])));
          }
          writeJson(join(outDir, "traits.json"), traits);

          // aria スナップショット（構造比較用）。出典: https://playwright.dev/docs/api/class-locator#locator-aria-snapshot
          const aria = await page.locator("body").ariaSnapshot();
          writeText(join(outDir, "aria.yaml"), aria);
        });
      }
    }
  });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

// TODO: 書き出しをラップしているプロジェクトではそのユーティリティへ差し替える
function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonAtomic(path: string, value: unknown): void {
  // 初回の実行では new/<target>/ がまだ無い（撮影の出力ディレクトリはテストの中で作る）
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeText(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

function writeText(path: string, value: string): void {
  writeFileSync(path, value, "utf8");
}
