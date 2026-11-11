/**
 * 故障注入のテスト（雛形）— spec-parity
 *
 * このファイルは、プロジェクトへコピーして使う雛形である。コピー先は `tests/<slug>/strength/faults.e2e.ts` にする。
 * `<slug>` は対象機能の slug に置き換え、例の画面・ロケータ・期待値を、スイートの assertion に合わせて書き換える。
 *
 * 1 つの故障ごとに、スイートの assertion をそのまま当てるテストを 1 つ書く。注入した状態で assertion が赤くなれば、
 * スイートはその故障を検出できる。注入しない対照のテストも置き、それが通ることを確かめる。
 * 判定は spec-parity に同梱した strength-check.mjs が、e2e の結果と強度の計画（strength-plan.json）から行う。
 * テストの名前は、計画の controls と faults[].test に「ファイルのパス › テスト名」で書く。
 *
 * 注入が描画まで届いたかは、assertion の前に確かめる。届いていなければ、PARITY_INJECTION_NOT_APPLIED を含むエラーを投げる。
 * strength-check.mjs は、そのテストを検出として数えない（注入が届かずに現行がそのまま描画された状態を、弱さと取り違えない）。
 * PARITY_STRENGTH=1 の実行でだけ動かし、それ以外の実行（スイートの green の確認）ではスキップする。
 */
import { expect } from "e2e";
import type { Screen } from "e2e";
import { test } from "../../parity/test.ts";

type Item = { id: number; name: string; price: number };

// テストが使う fixture の形（screen は e2e の Screen、app と browser は @e2e-dev/web の WebApp・Browser のうち使うものだけ）
type Fx = {
  app: { open(path: string): Promise<void> };
  screen: Screen;
  browser: {
    // 例の故障が返す応答の形。書き換える応答に合わせて直す
    route(
      pattern: string,
      handler: (route: {
        fulfill(response: { json: Item[] }): Promise<void>;
      }) => Promise<void> | void,
    ): Promise<void>;
    evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
  };
};

function strengthOnly(): void {
  test.skip(process.env.PARITY_STRENGTH !== "1", "PARITY_STRENGTH=1 の実行でだけ動かす");
}

function notApplied(what: string): never {
  throw new Error(`PARITY_INJECTION_NOT_APPLIED ${what}`);
}

test("対照: 注入しないと通る", async ({ app, screen }: Fx) => {
  strengthOnly();
  await app.open("/");
  await screen.getByRole("button", "読み込む").click();
  await expect(screen.getByRole("status")).toHaveText("読み込み 2 件");
  await expect(screen.getByRole("heading", { name: "商品一覧", level: 1 })).toBeVisible();
});

// 値・件数・並び: 画面がデータを受け取る境界（API の応答）を書き換える
test("故障: 応答の件数を変える", async ({ app, screen, browser }: Fx) => {
  strengthOnly();
  await browser.route("**/api/items", (route) =>
    route.fulfill({ json: [{ id: 1, name: "x", price: 1 }] }),
  );
  await app.open("/");
  await screen.getByRole("button", "読み込む").click();
  const shown = await browser.evaluate(
    () => document.querySelector("[role=status]")?.textContent ?? "",
  );
  if (!shown.includes("1 件")) notApplied(`件数の書き換えが描画に届いていない（${shown}）`);
  await expect(screen.getByRole("status")).toHaveText("読み込み 2 件");
});

// 構造: 見出しの階層を DOM で変える
test("故障: 見出しの階層を変える", async ({ app, screen, browser }: Fx) => {
  strengthOnly();
  await app.open("/");
  const changed = await browser.evaluate(() => {
    const h = document.querySelector("h1");
    if (!h) return false;
    const h2 = document.createElement("h2");
    h2.textContent = h.textContent;
    h.replaceWith(h2);
    return document.querySelector("h1") === null;
  });
  if (!changed) notApplied("h1 を h2 に置き換えられない");
  await expect(screen.getByRole("heading", { name: "商品一覧", level: 1 })).toBeVisible();
});
