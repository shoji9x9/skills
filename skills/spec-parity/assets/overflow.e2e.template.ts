/**
 * 横のはみ出しを測るテスト（雛形）— spec-parity
 *
 * このファイルは、プロジェクトへコピーして使う雛形である。コピー先は `tests/<slug>/overflow.e2e.ts` にする。
 * `<slug>` は対象機能の slug に置き換える（import のパスは、tests/parity/ を指すように直す）。
 *
 * metadata.json の capture_conditions に宣言したページ（pages）と幅（viewports）の組をすべて測り、測定の記録を書く。
 * 判定はしない。はみ出したかの判定は、spec-parity に同梱した overflow-check.mjs が記録を読んで行う
 * （測っていない組を合格にしないため、期待する組は宣言から作る）。
 * 測るのは PARITY_OVERFLOW_CAPTURE=1 の実行だけで、それ以外の実行（スイートの green の確認）ではスキップする。
 * スキップは本体の中の test.skip() で行う。現行でもスキップされるので、収束の判定はこのテストを比べない。
 *
 * 測るもの: documentElement の scrollWidth と clientWidth、window.innerWidth（その幅で測れたかの確かめ）。
 * 測らないもの: 内部でスクロールするコンテナの中のはみ出し、overflow: hidden で切れた内容、操作で開くメニューやダイアログの中。
 * これらを確かめるなら、状態を作る操作を足した測り方を別に書き、未検証の一覧から外す。
 *
 * 環境変数は次のとおりである。
 *   PARITY_OVERFLOW_CAPTURE … "1" の実行でだけ測る。
 *   PARITY_SLUG             … 対象機能の slug（必須）。
 *   PARITY_NEW_TARGET       … new で測るとき必須（replace-strategy の target の名前）。
 *   PARITY_CURRENT_TARGET   … current で測るとき必須（replace-strategy の target の名前）。
 *   PARITY_COMMIT           … 測る側のバージョン（必須。新側は verify-metadata.json の new.commit と同じ値）。
 *   PARITY_REPO_ROOT        … .replace/ を持つリポジトリのルート（省略時は cwd）。
 * 出力先は、新側が `.replace/parity/<slug>/new/<target>/overflow.json`、現側が `.replace/parity/<slug>/overflow-current.json` である。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sideOf } from "../parity/sides.ts";
import { test } from "../parity/test.ts";

// overflow-check.mjs の MEASUREMENT_VERSION と同じ値にする
const OVERFLOW_VERSION = "1";

type Viewport = { width: number; height: number };

// テストが使う fixture の形（@e2e-dev/web の WebApp と Browser のうち、使うものだけ）
type Fx = {
  app: { baseUrl: string; open(path: string): Promise<void> };
  browser: {
    setViewport(size: Viewport): Promise<void>;
    evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
  };
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} が未設定`);
  if (name !== "PARITY_COMMIT" && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v))
    throw new Error(`${name} がディレクトリ名の形でない: ${v}`);
  return v;
}

// 宣言の形は overflow-check.mjs が確かめるので、ここでは読めることだけを確かめる
function declaration(root: string): { pages: string[]; viewports: Viewport[] } {
  const doc: unknown = JSON.parse(readFileSync(join(root, "metadata.json"), "utf8"));
  const cc: unknown =
    typeof doc === "object" && doc !== null ? Reflect.get(doc, "capture_conditions") : null;
  const pages: unknown = cc && typeof cc === "object" ? Reflect.get(cc, "pages") : null;
  const viewports: unknown = cc && typeof cc === "object" ? Reflect.get(cc, "viewports") : null;
  if (!Array.isArray(pages) || !Array.isArray(viewports))
    throw new Error("metadata.json の capture_conditions に pages と viewports が無い");
  return {
    pages: pages.map(String),
    viewports: viewports.map((v) => ({ width: Number(v.width), height: Number(v.height) })),
  };
}

test("横のはみ出しを測る", async ({ app, browser }: Fx) => {
  test.skip(
    process.env.PARITY_OVERFLOW_CAPTURE !== "1",
    "PARITY_OVERFLOW_CAPTURE=1 の実行でだけ測る",
  );
  const side = sideOf(app.baseUrl);
  const slug = requireEnv("PARITY_SLUG");
  const root = join(process.env.PARITY_REPO_ROOT ?? process.cwd(), ".replace", "parity", slug);
  const target = requireEnv(side === "new" ? "PARITY_NEW_TARGET" : "PARITY_CURRENT_TARGET");
  const { pages, viewports } = declaration(root);
  const records = [];
  for (const viewport of viewports) {
    await browser.setViewport(viewport);
    for (const page of pages) {
      await app.open(page);
      const m = await browser.evaluate(async () => {
        // Web フォントの読み込みで幅が変わるので、読み込みを待ってから測る
        await document.fonts.ready;
        const el = document.documentElement;
        return {
          inner_width: window.innerWidth,
          client_width: el.clientWidth,
          scroll_width: el.scrollWidth,
        };
      });
      records.push({ page, viewport, ...m });
    }
  }
  const out =
    side === "new"
      ? join(root, "new", target, "overflow.json")
      : join(root, "overflow-current.json");
  mkdirSync(dirname(out), { recursive: true });
  const doc = {
    version: OVERFLOW_VERSION,
    side,
    slug,
    target,
    commit: requireEnv("PARITY_COMMIT"),
    records,
  };
  writeFileSync(`${out}.tmp`, `${JSON.stringify(doc, null, 2)}\n`);
  renameSync(`${out}.tmp`, out);
});
