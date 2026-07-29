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
 *   3. 同一条件で 2 回撮り、新側の自己ノイズを測れるようにする（2 回目は別ディレクトリへ）
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
 *   PARITY_NEW_UI_URL  … 新側 UI の baseURL（playwright.config の `new-capture` プロジェクトが参照する）
 *   PARITY_REPO_ROOT   … `.replace/` を持つリポジトリルート（省略時は cwd）。Playwright は
 *                        playwright.config のあるディレクトリ（既定 `e2e/`）から起動されることがあり、
 *                        cwd 相対のままだと metadata が読めない／成果物が `e2e/.replace/...` へ逸れる
 *
 * 1 回目と 2 回目の差分量（pixel_diff / trait_diffs）を測るのはスペックの仕事ではない。
 * 記録済みの画素差分ツールと trait-compare に、下の 2 つの出力ディレクトリを渡して測る。
 */
import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { test } from "@playwright/test";

// TODO: プロジェクトの現側スペックが使っている入口をそのまま使う（現側と対称に書く）。
//       パスは metadata.json の suite.locator_map / suite.interactions / suite.tools から引き、推測しない。
import { captureTraits } from "../../lib/tools/vendor/trait-capture.mjs";
import { resolveLocator as resolveCurrent } from "../../lib/locator-map/<slug>";
// 新側のロケータ例外（new/<target>/replace-metadata.json の suite.locator_map_new が指すファイル）。
// 例外ゼロなら parity-replace はこのファイルを作らないので、その場合はこの import ごと外す。
import { resolveLocator as resolveNewException } from "../../lib/locator-map/<slug>.new";
import { applyState } from "../../lib/interactions";

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

// baseline パスは新側ベースライン本体、noise パスは自己ノイズ測定用の 2 回目
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

// 新側は「現側マッピング → 新側例外」の順で解決する（例外は解決できない論理名だけを埋める契約）
function resolveLocator(page: import("@playwright/test").Page, name: string) {
  return resolveNewException(page, name) ?? resolveCurrent(page, name);
}

// page / state / viewport はそのままディレクトリ階層になる。`..` が混じると join が outRoot の
// 外を指し、reused 時の rmSync が採取ディレクトリの外を消しうる。撮影・削除の前に落とす
function assertInsideOutRoot(dir: string): void {
  const rel = relative(outRoot, dir);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `capture output "${dir}" escapes "${outRoot}": ` +
        "check capture_conditions.pages[].name / states / viewports for path traversal",
    );
  }
}

// PARITY_NOISE_PAIRS の語彙が pages[].name とずれると「全組スキップ＝自己ノイズ未測定」が
// 静かに成功扱いになる。ずれは撮影前に落とす（安全側＝測り直しではなく停止）
const allPairs = new Set<string>(
  viewports.flatMap((v: { label: string }) =>
    pages.flatMap((p) => states.map((s: string) => `${p.name}|${s}|${v.label}`)),
  ),
);
const unknownPairs = onlyPairs.filter((pair) => !allPairs.has(pair));
if (unknownPairs.length > 0) {
  throw new Error(
    `PARITY_NOISE_PAIRS has pairs that match no capture target: ${unknownPairs.join(", ")}. ` +
      "capture_conditions.pages[].name must use the same vocabulary as noise_baseline[].page",
  );
}

test.beforeEach(async (_fixtures, testInfo) => {
  // fail-fast: current で走ると現行アプリを新側ベースラインとして書き出す（testIgnore の設定漏れ対策）
  if (testInfo.project.name !== "new-capture") {
    throw new Error(
      `new-only spec ran under project "${testInfo.project.name}": exclude it with testIgnore`,
    );
  }
});

for (const viewport of viewports) {
  test.describe(`viewport=${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const pageDef of pages) {
      for (const state of states) {
        const pair = `${pageDef.name}|${state}|${viewport.label}`;
        // 収集時点（撮影・削除より前）に検証する
        const outDir = join(outRoot, pageDef.name, state, viewport.label);
        assertInsideOutRoot(outDir);

        test(`capture ${pair}`, async ({ page }) => {
          // noise パスは「測り直す組」だけを撮る（再利用の可否は parity-diff が判定して PARITY_NOISE_PAIRS で渡す）。
          // 撮らない組は前回実行の noise-pass2 を消す——残すと「今回の baseline-new」対「前反復の 2 回目」が
          // 突き合わされ、反復間のコード変更を自己ノイズとして計上する
          const reused = pass === "noise" && onlyPairs.length > 0 && !onlyPairs.includes(pair);
          if (reused) rmSync(outDir, { recursive: true, force: true });
          test.skip(reused, "reused noise measurement");

          mkdirSync(outDir, { recursive: true });

          await page.goto(pageDef.path);
          // 状態遷移は現側と同じ操作アダプタを使う（遷移できない状態は例外にして停止させる）
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

function writeText(path: string, value: string): void {
  writeFileSync(path, value, "utf8");
}
