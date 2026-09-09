// parity-suite が生成するスイートから待たない Playwright API を検出する回帰テスト（Issue #311）。

import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-suite/scripts/auto-wait-check.mjs");
const { scanSource } = await import(script);

test("陽性コントロール: locator と自動リトライ assertion は通る", () => {
  const source = `
    const save = page.getByRole('button', { name: 'Save' });
    await expect(save).toBeVisible();
    await expect(save).toHaveText('Save');
    await expect(page.getByRole('row')).toHaveCount(3);
  `;
  expect(scanSource(source)).toEqual([]);
});

test.each([
  ["page.$", "await page.$('#save')", "query-handle"],
  ["page.$$", "await page.$$('.row')", "query-handle"],
  ["elementHandle", "await locator.elementHandle()", "element-handle"],
  ["elementHandles", "await locator.elementHandles()", "element-handle"],
  ["locator.all", "await locator.all()", "locator-all"],
  ["textContent", "await locator.textContent()", "immediate-read"],
  ["allTextContents", "await locator.allTextContents()", "immediate-read"],
  ["count", "await locator.count()", "immediate-read"],
  ["isVisible", "await locator.isVisible()", "immediate-read"],
  ["waitForTimeout", "await page.waitForTimeout(500)", "fixed-wait"],
])("%s を違反として検出する", (_name, source, rule) => {
  expect(scanSource(source)).toEqual([expect.objectContaining({ rule })]);
});

test("コメントと文字列内の例示はコードとして誤検出しない", () => {
  const source = `
    // await page.$('#example')
    const note = "locator.textContent()";
    /* await locator.all() */
    await expect(page.getByText(note)).toBeVisible();
  `;
  expect(scanSource(source)).toEqual([]);
});

test("テンプレート文字列の補間内はコードとして検出する", () => {
  const source = "const value = `prefix ${await locator.textContent()} suffix`;";
  expect(scanSource(source)).toEqual([expect.objectContaining({ rule: "immediate-read" })]);
});

test("テンプレート文字列の文字部分にある例示は誤検出しない", () => {
  expect(scanSource("const note = `do not use locator.textContent()`;")).toEqual([]);
});

test("Playwright 以外の同名メソッドは誤検出しない", () => {
  const source = `
    await Promise.all(tasks);
    const size = collection.count();
    await clock.waitForTimeout(10);
    await wrapper.elementHandle();
  `;
  expect(scanSource(source)).toEqual([]);
});

test("Page / Locator の直接チェーン・代入別名・型注釈を検出する", () => {
  const source = `
    const rows = page.getByRole('row');
    await rows.all();
    await page.getByRole('status').textContent();
    async function inspect(target: Locator, browserPage: Page) {
      await target.count();
      await browserPage.waitForTimeout(10);
    }
  `;
  expect(scanSource(source).map((v) => v.rule)).toEqual([
    "locator-all",
    "immediate-read",
    "immediate-read",
    "fixed-wait",
  ]);
});

test("非 BMP 文字の後でも違反位置を UTF-16 code unit 単位で保つ", () => {
  const source = "const note = '𠮟る'; await locator.textContent();";
  const [violation] = scanSource(source);
  expect(violation).toMatchObject({
    line: 1,
    column: source.indexOf(".textContent") + 1,
    rule: "immediate-read",
  });
});

test("セミコロン無しの Page 別名も検出する", () => {
  const source = `
    const browserPage = page
    await browserPage.$('#save')
    await browserPage.waitForTimeout(100)
  `;
  expect(scanSource(source).map((v) => v.rule)).toEqual(["query-handle", "fixed-wait"]);
});

test("閉じていない文字列は判定不能を成功扱いにしない", () => {
  expect(() => scanSource("const x = 'unterminated")).toThrow(/閉じていない/);
});

test("CLI は対象 0 件を成功扱いにせず、違反と正常入力を弁別する", () => {
  const dir = mkdtempSync(join(tmpdir(), "auto-wait-check-"));
  const bad = join(dir, "bad.spec.ts");
  const good = join(dir, "good.spec.ts");
  writeFileSync(bad, "await page.$('#save');\n");
  let result = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/bad\.spec\.ts:1:\d+: query-handle/);

  writeFileSync(bad, "await expect(page.getByRole('button')).toBeVisible();\n");
  writeFileSync(good, "await expect(page.getByRole('row')).toHaveCount(2);\n");
  result = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/2 ファイルを走査/);

  result = spawnSync(process.execPath, [script, join(dir, "missing")], { encoding: "utf8" });
  expect(result.status).toBe(2);
  expect(result.stderr).toMatch(/読み込めない/);
});

test("ディレクトリ走査では非対象ファイルを無視し、明示ファイルなら入力誤りにする", () => {
  const dir = mkdtempSync(join(tmpdir(), "auto-wait-check-mixed-"));
  const source = join(dir, "suite.spec.ts");
  const metadata = join(dir, "metadata.json");
  writeFileSync(source, "await expect(page.getByRole('status')).toBeVisible();\n");
  writeFileSync(metadata, "{}\n");
  writeFileSync(join(dir, "README.md"), "# Suite\n");

  let result = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/1 ファイルを走査/);

  result = spawnSync(process.execPath, [script, metadata], { encoding: "utf8" });
  expect(result.status).toBe(2);
  expect(result.stderr).toMatch(/対象外の拡張子/);
});
