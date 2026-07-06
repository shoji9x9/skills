// 構成図 SVG を headless Chrome で PNG にラスタライズし、目視確認用に出力する。
// SVG は画像参照ツールで直接描画できないため、この PNG 化を挟む。エージェントは
// 出力 PNG を画像として読み、references/conventions.md の確認観点で品質チェックする。
//   node preview-diagram.mjs <env名 | SVGファイル名>   → 出力 PNG の絶対パスを表示
//   例: node preview-diagram.mjs local
//       node preview-diagram.mjs architecture-prod.svg
// SVG の場所は render-diagram.mjs と同じ規則（DIAGRAM_DIR/out、DIAGRAM_OUT_DIR で上書き）。
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const DIAGRAM_DIR = process.env.DIAGRAM_DIR ?? process.cwd();
const OUT_DIR = process.env.DIAGRAM_OUT_DIR ?? join(DIAGRAM_DIR, "out");

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node preview-diagram.mjs <env名 | SVGファイル名>");
  process.exit(1);
}
// env 名（拡張子なし）で渡されたら architecture-<env>.svg に読み替える。
const fileName = arg.endsWith(".svg") ? basename(arg) : `architecture-${arg}.svg`;
const svgPath = join(OUT_DIR, fileName);
if (!existsSync(svgPath)) {
  console.error(`SVG が見つかりません: ${svgPath}（先に render-diagram.mjs を実行）`);
  process.exit(1);
}

const chrome = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]
  .filter(Boolean)
  .find((p) => existsSync(p));

if (!chrome) {
  console.error(
    "Chrome/Chromium が見つかりません。導入するか PUPPETEER_EXECUTABLE_PATH / CHROME_PATH を設定してください。",
  );
  process.exit(1);
}

const svg = readFileSync(svgPath, "utf8");
const head = svg.match(/<svg[^>]*>/);
if (!head) throw new Error(`SVG が不正（<svg> がありません）: ${svgPath}`);
const width = Number(head[0].match(/width="(\d+)"/)?.[1] ?? 1540);
const height = Number(head[0].match(/height="(\d+)"/)?.[1] ?? 900);

const work = mkdtempSync(join(tmpdir(), "diagram-preview-"));
const html = join(work, "preview.html");
writeFileSync(html, `<!doctype html><meta charset="utf8"><body style="margin:0">${svg}</body>`);

const out = join(tmpdir(), `${basename(svgPath, ".svg")}-preview.png`);
execFileSync(
  chrome,
  [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--hide-scrollbars",
    `--screenshot=${out}`,
    `--window-size=${width},${height}`,
    "--default-background-color=FFFFFFFF",
    pathToFileURL(html).href,
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);

console.log(out);
