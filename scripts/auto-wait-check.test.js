// parity-suite が生成するスイートから待たない Playwright API を検出する回帰テスト（Issue #311）。

import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-suite/scripts/auto-wait-check.mjs");
const { maskNonCode, scanSource, scanSourceWithStats } = await import(script);

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
  ["optional Page", "await page?.waitForTimeout(500)", "fixed-wait"],
  ["optional Page chain", "await page?.getByRole('status').textContent()", "immediate-read"],
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
  expect(result.stdout).toMatch(/走査 2 ファイル/);

  result = spawnSync(process.execPath, [script, join(dir, "missing")], { encoding: "utf8" });
  expect(result.status).toBe(2);
  expect(result.stderr).toMatch(/読み込めない/);
});

test("引数が重なっても走査ファイル数は重複を除いた実数を出す", () => {
  // 走査自体は重複を除いた集合に対して 1 回ずつ行う。件数だけ水増しすると
  // 「走査ファイル数がスイートの実ファイル数と合っているか」の確認が通ってしまう。
  const dir = mkdtempSync(join(tmpdir(), "auto-wait-check-dup-"));
  const spec = join(dir, "suite.spec.ts");
  writeFileSync(spec, "await expect(page.getByRole('row')).toHaveCount(2);\n");
  const result = spawnSync(process.execPath, [script, dir, spec, dir], { encoding: "utf8" });
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/走査 1 ファイル/);
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
  expect(result.stdout).toMatch(/走査 1 ファイル/);

  result = spawnSync(process.execPath, [script, metadata], { encoding: "utf8" });
  expect(result.status).toBe(2);
  expect(result.stderr).toMatch(/対象外の拡張子/);
});

// --- 正規表現リテラル（Issue #346） ---

test("正規表現リテラルを潰し、アポストロフィを文字列の開始として数えない", () => {
  const source = [
    "import { expect, test } from '@playwright/test';",
    "test('orders', async ({ page }) => {",
    "  const row = page.locator('tr').first();",
    "  await expect(row).toHaveText(/won't/);",
    "  const value = await row.textContent();",
    "  expect(value).toBe('x');",
    "});",
  ].join("\n");
  expect(scanSource(source).map((v) => v.rule)).toEqual(["immediate-read"]);
});

test("偶数個のアポストロフィに挟まれた違反を静かに潰さない", () => {
  const source = [
    "await expect(row).toHaveText(/won't/);",
    "const value = await locator.textContent();",
    "await expect(row).toHaveText(/can't/);",
  ].join("\n");
  expect(scanSource(source).map((v) => v.rule)).toEqual(["immediate-read"]);
});

test.each([
  ["文字クラス内の /", "await expect(row).toHaveText(/[/]'/);"],
  ["エスケープした /", "await expect(row).toHaveText(/a\\/'b/);"],
  ["フラグ付き", "await expect(row).toHaveText(/won't/gi);"],
  ["バッククォートを含む", "await expect(row).toHaveText(/`'/);"],
  ["${ を含む", "await expect(row).toHaveText(/${'}/);"],
])("正規表現リテラル（%s）の内側は字句として数えない", (_name, regexLine) => {
  const source = `${regexLine}\nconst value = await locator.textContent();`;
  expect(scanSource(source).map((v) => v.rule)).toEqual(["immediate-read"]);
});

test.each([
  ["識別子の後", "const r = a / b + c / d;"],
  ["閉じ括弧の後", "const r = f(1) / g(2) + h(3) / k(4);"],
  ["閉じ角括弧の後", "const r = xs[0] / ys[1] + zs[2] / ws[3];"],
  ["数値の後", "const r = 10 / 2 + 30 / 5;"],
  ["後置インクリメントの後", "let i = 1; const r = i++ / 2 + i-- / 3;"],
])("除算（%s）を正規表現リテラルとして潰さない", (_name, source) => {
  expect(maskNonCode(source)).toBe(source);
});

test("キーワードの後の / は正規表現として潰す", () => {
  const source = "function f(x) { return /a b/.test(x); }";
  expect(maskNonCode(source)).toBe("function f(x) { return      .test(x); }");
});

test("行をまたぐ / は正規表現として潰さない", () => {
  const source = "const r = (a) / b\nconst value = await locator.textContent();\n";
  expect(scanSource(source).map((v) => v.rule)).toEqual(["immediate-read"]);
});

test.each([
  ["if", "if (x) /it's ok/.test(y);"],
  ["while", "while (x) /it's ok/.test(y);"],
  ["for", "for (const r of rows) /it's ok/.test(r);"],
  ["入れ子の呼び出しを含む if", "if (f(x)) /it's ok/.test(y);"],
])("制御構文の頭を閉じる )（%s）の後の正規表現を潰す", (_name, head) => {
  // `)` を一律に「値の終わり」と読むと、正規表現内のアポストロフィが文字列の開始に化け、
  // 偶数個なら間の実コードが静かに潰れる（Issue #346 と同じ故障クラス）。
  const source = [head, "const value = await locator.textContent();", "// isn't relevant"].join(
    "\n",
  );
  expect(scanSource(source).map((v) => v.rule)).toEqual(["immediate-read"]);
});

test.each([
  ["JSX の式コンテナ", "const el = <A x={1} /><B y={await locator.textContent()} />;"],
  ["オブジェクトリテラル", "const r = {a: 1} / n + (await locator.textContent()) / 3;"],
])("値で終わる } の後の / を正規表現として潰さない（%s）", (_name, source) => {
  // `}` を一律に「文の位置」と読むと、2 つの `/` に挟まれた実コードが静かに潰れる。
  expect(scanSource(source).map((v) => v.rule)).toEqual(["immediate-read"]);
});

test("ブロックを閉じる } の後の正規表現は潰す", () => {
  const source = "if (x) { y(); } /it's ok/.test(z);\nconst v = await locator.textContent();";
  expect(scanSource(source).map((v) => v.rule)).toEqual(["immediate-read"]);
});

test("終端を確定できない / は除算として読み進め、後続の違反を飲み込まない", () => {
  // 正規表現リテラルは行をまたげない。ガードが無いと次の行以降の `/` まで潰して違反が消える。
  const source = [
    "const re = /unterminated",
    "const value = await locator.textContent();",
    "const ratio = a / b;",
  ].join("\n");
  expect(scanSource(source).map((v) => v.rule)).toEqual(["immediate-read"]);
});

// --- 入れ子のテンプレート文字列（Issue #381） ---

test("${} の中のテンプレート文字列を閉じられる", () => {
  const source = [
    'const value = "x";',
    'const line = `- cell${value === "" ? "" : ` "${value}"`}`;',
    "const read = await locator.textContent();",
  ].join("\n");
  expect(scanSource(source).map((v) => v.rule)).toEqual(["immediate-read"]);
});

test("入れ子の補間の内側もコードとして検出する", () => {
  const source = "const line = `${`${await locator.textContent()}`}`;";
  expect(scanSource(source).map((v) => v.rule)).toEqual(["immediate-read"]);
});

test("入れ子のテンプレート文字列の文字部分にある例示は誤検出しない", () => {
  expect(scanSource("const line = `${`do not use locator.count()`}`;")).toEqual([]);
});

test("閉じていない入れ子のテンプレート文字列は判定不能を成功扱いにしない", () => {
  expect(() => scanSource("const line = `${`inner`}")).toThrow(/閉じていない/);
});

// --- 受け側の解決（Issue #348） ---

test("Page Object のメンバー式の受け側を検出する", () => {
  const source = [
    "export class OrdersPage {",
    "  constructor(page) {",
    "    this.page = page;",
    "  }",
    "  async firstRowText() {",
    '    return await this.page.locator("tr").first().textContent();',
    "  }",
    "}",
  ].join("\n");
  expect(scanSource(source).map((v) => v.rule)).toEqual(["immediate-read"]);
});

test("画面オブジェクトのプロパティ越しの固定時間待機を検出する", () => {
  const source = [
    "export async function settle(screen) {",
    "  await screen.page.waitForTimeout(800);",
    "}",
  ].join("\n");
  expect(scanSource(source).map((v) => v.rule)).toEqual(["fixed-wait"]);
});

test.each([
  ["function 宣言", "function pagerValue(view: Page): Locator { return view.locator('.x'); }"],
  ["アロー関数", "const pagerValue = (view: Page): Locator => view.locator('.x');"],
  [
    "Promise<Locator>",
    "async function pagerValue(view: Page): Promise<Locator> { return view.locator('.x'); }",
  ],
])("戻り値が Locator の関数（%s）を受け側として解決する", (_name, declaration) => {
  const source = `${declaration}\nconst total = await pagerValue(view).innerText();`;
  expect(scanSource(source).map((v) => v.rule)).toEqual(["immediate-read"]);
});

test("解決できない関数呼び出しの受け側は判定不能として報告する", () => {
  const source = "const total = await pagerValue(view).innerText();";
  expect(scanSource(source).map((v) => v.rule)).toEqual(["unresolved-receiver"]);
});

test.each([
  // 起点が識別子になる形（`await` が読み取れる）と、起点を確定できない形（null）で分岐が違う。
  ["await 付き", "const total = await (await rows()).count();"],
  ["await なし", "const total = (await rows()).count();"],
  ["リテラル起点", "const total = [1, 2].count();"],
  ["添字アクセス", "class P { async r() { return await this['page'].textContent(); } }"],
  ["添字アクセスが途中", "const total = await rows[0].count();"],
  // 呼び出しが起点でなくても戻り値は名前で解決できない。起点だけを見ると静かに 0 件へ落ちる。
  ["呼び出しが途中（プロパティ越し）", "const total = await helpers.gridRows(view).count();"],
  [
    "呼び出しが途中（this 越し）",
    "class P { async n() { return await this.gridRows().count(); } }",
  ],
])("名前で解決できない受け側（%s）は判定不能として報告する", (_name, source) => {
  expect(scanSource(source).map((v) => v.rule)).toEqual(["unresolved-receiver"]);
});

test("判定不能の理由ごとに直し方を出し分ける", () => {
  const message = (source) => scanSource(source)[0].message;
  expect(message("const total = await pagerValue(view).innerText();")).toMatch(
    /関数呼び出しの戻り値/,
  );
  expect(message("const total = await rows[0].count();")).toMatch(/添字アクセス/);
  expect(message("const total = [1, 2].count();")).toMatch(/括弧で包んだ式/);
});

test("引数に関数型を持つ宣言でも戻り値の型注釈を読む", () => {
  // 引数列を「括弧を含まない」に限ると、注釈を付けても解決せず判定不能のまま回り続ける。
  const source = [
    "export function row(view: Page, pick: (r: Locator) => Locator): Locator {",
    "  return pick(view.locator('tr'));",
    "}",
    "const total = await row(view, pickFirst).count();",
  ].join("\n");
  expect(scanSource(source).map((v) => v.rule)).toEqual(["immediate-read"]);
});

test("export default の後の正規表現を潰す", () => {
  // `default` を許可位置から落とすと、正規表現内のアポストロフィが文字列開始に化け、
  // 次のアポストロフィまで（行をまたいで）潰れて違反ごと消える。
  const source = [
    "export default /won't/;",
    "const value = await locator.textContent();",
    "const other = /can't/;",
  ].join("\n");
  expect(scanSource(source).map((v) => v.rule)).toEqual(["immediate-read"]);
});

test.each([
  // 右辺の起点は `this` なので、起点だけを見るとこの別名はどこにも登録されず静かに素通りする。
  // locator 経由（チェーン中の `locator`）と page 経由（チェーン中の `page` ＋ getBy 呼び出し）は
  // 別の判定を通るので両方当てる。
  ["locator 経由", "const row = this.page.locator('tr');", "row.textContent()"],
  ["page 経由", "const row = this.page.getByRole('row');", "row.textContent()"],
])("メンバー式から束ねた別名（%s）を受け側として解決する", (_name, binding, usage) => {
  const source = [
    "class P {",
    "  constructor(page) { this.page = page; }",
    "  async r() {",
    `    ${binding}`,
    `    return await ${usage};`,
    "  }",
    "}",
  ].join("\n");
  expect(scanSource(source).map((v) => v.rule)).toEqual(["immediate-read"]);
});

test.each([
  ["直接呼ぶ", "return await this.gridRows().count();"],
  ["ローカル変数へ束ねる", "const rows = this.gridRows();\n    return await rows.count();"],
])("戻り値注釈を持つクラスメソッド（%s）を受け側として解決する", (_name, usage) => {
  const source = [
    "class P {",
    "  gridRows(): Locator { return this.page.locator('tr'); }",
    "  async r() {",
    `    ${usage}`,
    "  }",
    "}",
  ].join("\n");
  expect(scanSource(source).map((v) => v.rule)).toEqual(["immediate-read"]);
});

test("由来を追えない別名はローカル変数へ束ねても判定不能にする", () => {
  // ローカル変数へ束ねれば検査から消える、という抜け道を残さない。
  const source = "const rows = importedHelper();\nconst value = await rows.count();";
  const [finding] = scanSource(source);
  expect(finding).toMatchObject({ rule: "unresolved-receiver" });
  expect(finding.message).toMatch(/束ねた変数の由来を追えない/);
});

test("リテラル・算術を束ねた変数は判定不能にしない", () => {
  const source = [
    "const limit = 3;",
    "const total = limit + 1;",
    "const size = total.count();",
  ].join("\n");
  expect(scanSource(source)).toEqual([]);
});

test.each([
  ["閉じタグ 2 つ", "const ui = <A></A><B>{await locator.textContent()}</B>;"],
  ["閉じタグ 1 つ", "const ui = <A>{await locator.textContent()}</A>;"],
  ["自己閉じタグ 2 つ", "const el = <A x={1} /><B y={await locator.textContent()} />;"],
])("JSX / TSX の %s を正規表現として潰さない", (_name, source) => {
  // `</` の `/` を正規表現の開始と読むと、次の閉じタグの `/` までを潰して違反ごと消える。
  expect(scanSource(source).map((v) => v.rule)).toEqual(["immediate-read"]);
});

test("空白を挟む比較の後の正規表現は潰す（JSX 閉じタグと弁別する）", () => {
  const source = [
    "const ok = a < /it's/.source.length;",
    "const value = await locator.textContent();",
    "// isn't relevant",
  ].join("\n");
  expect(scanSource(source).map((v) => v.rule)).toEqual(["immediate-read"]);
});

test.each([
  // `Promise<Locator>` を返す関数は `(await f()).x()` が型的に正しい呼び方。
  ["outer await なし", "const total = (await pagerValue(view)).innerText();"],
  ["outer await あり", "const total = await (await pagerValue(view)).innerText();"],
])("括弧で包んだ await の受け側（%s）を中身から解決する", (_name, call) => {
  const declaration =
    "async function pagerValue(view: Page): Promise<Locator> { return view.locator('.x'); }";
  expect(scanSource(`${declaration}\n${call}`).map((v) => v.rule)).toEqual(["immediate-read"]);
});

test("括弧の中身が何にも解決しなければ判定不能のまま（中身を見たぶんを fail-open にしない）", () => {
  expect(scanSource("const total = (a + b).count();").map((v) => v.rule)).toEqual([
    "unresolved-receiver",
  ]);
  expect(scanSource("const total = (await rows()).count();").map((v) => v.rule)).toEqual([
    "unresolved-receiver",
  ]);
});

test("添字アクセスがあっても既知の page / locator が混じれば解決する", () => {
  const source = "const total = await page['x'].locator('a').count();";
  expect(scanSource(source).map((v) => v.rule)).toEqual(["immediate-read"]);
});

test("受け側の種別は呼び出しに最も近い一致で決まり、解決件数に数える", () => {
  // `page.locator(…)` が返すのは Locator なので、page 専用規則（fixed-wait）は当たらない。
  // 当たらなくても「受け側を解決できた」ことは件数に残す。
  const result = scanSourceWithStats("await page.locator('sel').waitForTimeout(500);");
  expect(result.findings).toEqual([]);
  expect(result.stats).toMatchObject({ callSites: 1, resolved: 1, undecidable: 0 });
});

test("Playwright と無関係なメンバー式・関数呼び出しは誤検出しない", () => {
  const source = [
    "const total = config.pagination.count();",
    "const names = collection.items.allTextContents();",
    "await clock.timers.waitForTimeout(10);",
  ].join("\n");
  expect(scanSource(source)).toEqual([]);
});

// --- 採取スペックの免除 ---

test("current-only の採取スペックでは即時読み取りだけを免除する", () => {
  const source = [
    "const value = await locator.textContent();",
    "await page.waitForTimeout(500);",
    "await locator.all();",
  ].join("\n");
  const capture = "/repo/parity/orders/current-only/baseline.spec.ts";
  expect(scanSource(source, capture).map((v) => v.rule)).toEqual(["fixed-wait", "locator-all"]);
  const shared = "/repo/parity/orders/orders.spec.ts";
  expect(scanSource(source, shared).map((v) => v.rule)).toEqual([
    "immediate-read",
    "fixed-wait",
    "locator-all",
  ]);
});

// --- 測れた量の報告 ---

test("CLI は判定不能を 0 件へ倒さず、測れた量を出力する", () => {
  const dir = mkdtempSync(join(tmpdir(), "auto-wait-check-measured-"));
  const spec = join(dir, "unresolved.spec.ts");
  writeFileSync(spec, "const total = await pagerValue(view).innerText();\n");
  let result = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/unresolved\.spec\.ts:1:\d+: unresolved-receiver/);
  expect(result.stderr).toMatch(/受け側を解決できない呼び出しが 1 件/);
  expect(result.stderr).toMatch(/判定不能 1 件/);

  writeFileSync(spec, "function pagerValue(view: Page): Locator { return view.locator('.x'); }\n");
  result = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/判定不能 0 件/);
});
