// aws-architecture-diagram の preview-diagram.mjs のテスト。
//
// スクリプトは out/ の SVG を HTML に埋め込み、headless Chrome のスクリーンショットで PNG にする。
// Chrome は PUPPETEER_EXECUTABLE_PATH に置いた偽物のシェルスクリプトにする。偽物は渡された引数と
// 読み込んだ HTML を記録し、--screenshot の先に PNG の代わりのファイルを書く（失敗の形は環境変数で選ぶ）。
//
// 確かめる状態は次のとおりである。
//   - 引数: 無い / 環境名 / SVG のファイル名（ディレクトリ付き）/ 指す SVG が無い / SVG に <svg> が無い
//   - 大きさ: width と height / 単位 px / 引用符なし / 100% のような px 以外の単位（viewBox へ戻る）/ どちらも無い
//   - SVG の中身: <script> と on* の属性（HTML に入れる前に取り除く）
//   - サンドボックス: デフォルト（有効）/ --no-sandbox / 設定の chrome_no_sandbox: true
//   - Chrome の失敗: 0 以外の終了 / signal での終了 / 時間切れ
//   - 後片付け: HTML を置いた一時ディレクトリは、成功しても失敗しても消す

import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "skills/aws-architecture-diagram/assets/engine/preview-diagram.mjs");

const FAKE_CHROME = `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$FAKE_CHROME_LOG/args.txt"
for a in "$@"; do
  case "$a" in
    --screenshot=*) shot="\${a#--screenshot=}" ;;
    file://*) page="\${a#file://}" ;;
  esac
done
cp "$page" "$FAKE_CHROME_LOG/page.html"
case "\${FAKE_CHROME_MODE:-ok}" in
  ok) printf 'PNG' > "$shot" ;;
  fail)
    for i in 1 2 3 4 5 6; do echo "line $i" >&2; done
    echo "Failed to connect to the bus: no dbus" >&2
    exit 3 ;;
  signal) kill -TERM $$ ;;
  hang) exec sleep 30 ;;
esac
`;

type Run = {
  args?: string[];
  svg?: string | null;
  svgName?: string;
  env?: Record<string, string>;
  /** 人ごとの設定（${XDG_CONFIG_HOME}/skills/shoji9x9/aws-architecture-diagram.jsonc）の中身 */
  userConfig?: string;
};

function run(opts: Run) {
  const dir = makeTempDir("preview-");
  const out = join(dir, "out");
  const tmp = join(dir, "tmp");
  const log = join(dir, "log");
  for (const d of [out, tmp, log]) mkdirSync(d);
  if (opts.userConfig !== undefined) {
    const userDir = join(dir, "xdg", "skills", "shoji9x9");
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, "aws-architecture-diagram.jsonc"), opts.userConfig);
  }
  if (opts.svg !== null) {
    writeFileSync(
      join(out, opts.svgName ?? "architecture-prod.svg"),
      opts.svg ?? '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect/></svg>',
    );
  }
  const chrome = join(dir, "fake-chrome");
  writeFileSync(chrome, FAKE_CHROME);
  chmodSync(chrome, 0o755);
  const result = spawnSync(
    process.execPath,
    [script, ...(opts.args ?? ["prod"]), "--out-dir", out],
    {
      // 手元の設定ファイルを読まないよう、git の外の一時ディレクトリで実行し、人ごとの設定の置き場所も一時ディレクトリにする
      cwd: dir,
      env: {
        ...process.env,
        XDG_CONFIG_HOME: join(dir, "xdg"),
        PUPPETEER_EXECUTABLE_PATH: chrome,
        TMPDIR: tmp,
        FAKE_CHROME_LOG: log,
        ...opts.env,
      },
      encoding: "utf8",
      timeout: 20000,
    },
  );
  if (result.error) throw result.error;
  const argsFile = join(log, "args.txt");
  const chromeArgs = existsSync(argsFile) ? readFileSync(argsFile, "utf8").trim().split("\n") : [];
  const pageFile = join(log, "page.html");
  return {
    ...result,
    tmp,
    chrome,
    chromeArgs,
    page: existsSync(pageFile) ? readFileSync(pageFile, "utf8") : "",
    // 一時ディレクトリ（diagram-preview-*）が残っていないかを見るための、TMPDIR の中身。
    leftovers: readdirSync(tmp).filter((f) => f.startsWith("diagram-preview-")),
  };
}

const windowSize = (args: string[]) => args.find((a) => a.startsWith("--window-size="));

test("環境名から out/architecture-<env>.svg を開き、PNG の絶対パスを表示する", () => {
  const r = run({ args: ["prod"] });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  const png = join(r.tmp, "architecture-prod-preview.png");
  expect(r.stdout.trim()).toBe(png);
  expect(readFileSync(png, "utf8")).toBe("PNG");
  expect(r.chromeArgs).toContain(`--screenshot=${png}`);
  expect(r.chromeArgs).toContain("--headless");
  expect(r.chromeArgs).toContain("--disable-dev-shm-usage");
  // サンドボックスはデフォルトで外さない。
  expect(r.chromeArgs).not.toContain("--no-sandbox");
  expect(windowSize(r.chromeArgs)).toBe("--window-size=640,480");
  expect(r.page).toContain(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect/></svg>',
  );
  expect(r.leftovers).toEqual([]);
});

test("SVG のファイル名は、ディレクトリを外した名前で out/ から開く", () => {
  const r = run({
    args: ["somewhere/else/architecture-local.svg"],
    svgName: "architecture-local.svg",
  });
  expect(r.status).toBe(0);
  expect(r.stdout.trim()).toBe(join(r.tmp, "architecture-local-preview.png"));
});

test.each([
  ["width と height", '<svg width="300" height="200" viewBox="0 0 10 10">', "300,200"],
  ["単位 px と単引用符", "<svg width='300px' height='200px'>", "300,200"],
  ["引用符なし", "<svg width=300 height=200>", "300,200"],
  ["小数は丸める", '<svg width="300.6" height="199.4">', "301,199"],
  [
    "100% のような px 以外の単位は viewBox の幅と高さ",
    '<svg width="100%" height="100%" viewBox="0 0 800 600">',
    "800,600",
  ],
  ["width と height が無ければ viewBox の幅と高さ", '<svg viewBox="0 0 1200 700">', "1200,700"],
  ["どちらも無ければ 1540x900", "<svg>", "1540,900"],
])("ウィンドウの大きさは %s から決める", (_label, head, size) => {
  const r = run({ svg: `${head}<rect/></svg>` });
  expect(r.status).toBe(0);
  expect(windowSize(r.chromeArgs)).toBe(`--window-size=${size}`);
});

test("SVG の <script> と on* の属性は、Chrome に渡す HTML に入れない", () => {
  const r = run({
    svg: [
      '<svg width="10" height="10">',
      "<script>alert(1)</script>",
      '<script src="x.js"/>',
      '<rect onclick="a()" width="1"/>',
      "<rect onload='b()' width=\"2\"/>",
      '<rect onmouseover=c() width="3"/>',
      "</svg>",
    ].join(""),
  });
  expect(r.status).toBe(0);
  expect(r.page).not.toMatch(/<script/i);
  expect(r.page).not.toMatch(/\son[a-z]+\s*=/i);
  expect(r.page).toContain('<rect width="1"/>');
  expect(r.page).toContain('<rect width="2"/>');
  expect(r.page).toContain('<rect width="3"/>');
});

test("--no-sandbox を付けたときだけ、Chrome に --no-sandbox を付ける", () => {
  const r = run({ args: ["prod", "--no-sandbox"] });
  expect(r.status).toBe(0);
  expect(r.chromeArgs).toContain("--no-sandbox");
});

test("引数が無ければ使い方を示して 1 で終わる", () => {
  const r = run({ args: [] });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("usage: node preview-diagram.mjs <env名 | SVGファイル名>");
  expect(r.chromeArgs).toEqual([]);
});

test("SVG が無ければ、探した場所と先に実行するスクリプトを示して 1 で終わる", () => {
  const r = run({ svg: null, args: ["stg"] });
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(
    /SVG が見つかりません: .*architecture-stg\.svg（先に render-diagram\.mjs を実行）/,
  );
  expect(r.chromeArgs).toEqual([]);
});

test("<svg> の無いファイルは、Chrome を起動せずにエラーにする", () => {
  const r = run({ svg: "<html>not svg</html>" });
  expect(r.status).not.toBe(0);
  expect(r.stderr).toContain("SVG が不正（<svg> がありません）");
  expect(r.chromeArgs).toEqual([]);
});

test("Chrome が 0 以外で終わったら、終了コードと stderr の末尾 5 行（dbus の行を除く）と対処を示す", () => {
  const r = run({ env: { FAKE_CHROME_MODE: "fail" } });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(`Chrome での PNG 化に失敗しました（exit 3）: ${r.chrome}`);
  expect(r.stderr).toContain(["line 2", "line 3", "line 4", "line 5", "line 6"].join("\n"));
  expect(r.stderr).not.toContain("line 1\n");
  expect(r.stderr).not.toContain("dbus");
  // サンドボックスが有効なときだけ、無効にする方法を案内する。
  expect(r.stderr).toContain(
    "--no-sandbox を付けるか、人ごとの設定の chrome_no_sandbox を true にする",
  );
  expect(r.leftovers).toEqual([]);
});

test("サンドボックスを無効にしているときは、無効にする案内を出さない", () => {
  const r = run({ args: ["prod", "--no-sandbox"], env: { FAKE_CHROME_MODE: "fail" } });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("（exit 3）");
  expect(r.stderr).not.toContain("--no-sandbox を付けるか");
});

test("Chrome が signal で終わったら、signal の名前を示す", () => {
  const r = run({ env: { FAKE_CHROME_MODE: "signal" } });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("（signal SIGTERM）");
  expect(r.leftovers).toEqual([]);
});

test("Chrome が --timeout-ms の間に応答しなければ止めて、時間切れとして示す", () => {
  const r = run({ args: ["prod", "--timeout-ms", "300"], env: { FAKE_CHROME_MODE: "hang" } });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("（300ms 応答なしで中断）");
  expect(r.leftovers).toEqual([]);
});

test("人ごとの設定の chrome_no_sandbox と chrome_timeout_ms を使う", () => {
  const r = run({
    userConfig:
      '{\n  // このマシンはコンテナ\n  "chrome_no_sandbox": true,\n  "chrome_timeout_ms": 300,\n}\n',
    env: { FAKE_CHROME_MODE: "hang" },
  });
  expect(r.status).toBe(1);
  expect(r.chromeArgs).toContain("--no-sandbox");
  expect(r.stderr).toContain("（300ms 応答なしで中断）");
});

test("CLI の --timeout-ms は設定より優先する", () => {
  const r = run({
    userConfig: '{ "chrome_timeout_ms": 100000 }',
    args: ["prod", "--timeout-ms", "300"],
    env: { FAKE_CHROME_MODE: "hang" },
  });
  expect(r.stderr).toContain("（300ms 応答なしで中断）");
});

test.each([
  ["型の誤り", '{ "chrome_timeout_ms": "300" }', /chrome_timeout_ms: 型が "integer" でない/],
  ["0 以下", '{ "chrome_timeout_ms": 0 }', /chrome_timeout_ms: 1 より小さい/],
  [
    "置けない層（図のディレクトリは全員が同じ）",
    '{ "diagram_dir": "docs" }',
    /diagram_dir は 人ごと の層に置けない/,
  ],
])("設定の%sは、Chrome を起動せずに 1 で止める", (_name, userConfig, message) => {
  const r = run({ userConfig });
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(message);
  expect(r.chromeArgs).toEqual([]);
});

test.each([
  ["--timeout-ms", "abc"],
  ["--timeout-ms", "0"],
])("CLI の %s %s は、Chrome を起動せずにエラーにする", (flag, value) => {
  const r = run({ args: ["prod", flag, value] });
  expect(r.status).not.toBe(0);
  expect(r.stderr).toContain("--timeout-ms には 1 以上の整数を指定してください");
  expect(r.chromeArgs).toEqual([]);
});

test.each([
  ["DIAGRAM_CHROME_NO_SANDBOX", "1"],
  ["DIAGRAM_CHROME_TIMEOUT_MS", "300"],
  ["DIAGRAM_OUT_DIR", "/x"],
])("使わなくなった環境変数 %s が残っていれば、移行の手順を示して 1 で止める", (name, value) => {
  const r = run({ env: { [name]: value } });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(`環境変数 ${name} は使わなくなった。`);
  expect(r.chromeArgs).toEqual([]);
});
