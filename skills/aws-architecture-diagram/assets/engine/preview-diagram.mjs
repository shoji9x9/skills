// 構成図 SVG を headless Chrome で PNG にラスタライズし、目視確認用に出力する。
// SVG は画像参照ツールで直接描画できないため、この PNG 化を挟む。エージェントは
// 出力 PNG を画像として読み、references/conventions.md の確認観点で品質チェックする。
//   node preview-diagram.mjs <env名 | SVGファイル名>   → 出力 PNG の絶対パスを表示
//   例: node preview-diagram.mjs local
//       node preview-diagram.mjs architecture-prod.svg
// SVG の場所は render-diagram.mjs と同じ規則（DIAGRAM_DIR/out、DIAGRAM_OUT_DIR で上書き）。
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
// 生成物以外の SVG も受け付けるため、クォート種別・px 等の単位を許容して寛容にパースし、
// width/height が無ければ viewBox の幅・高さにフォールバックする（NaN で誤サイズにしない）。
// 値の直後がクォート／空白／`>` で終わるものだけ採用する。これで `100%` のような
// 単位付き（px 以外）は不一致となり viewBox へフォールバックできる（px は明示的に許容）。
const dimAttr = (name) =>
  head[0].match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']?\\s*([\\d.]+)(?:px)?\\s*["'\\s>]`, "i"),
  )?.[1];
const vb = head[0].match(/viewBox\s*=\s*["']\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)/i);
const width = Math.round(Number(dimAttr("width") ?? vb?.[1] ?? 1540));
const height = Math.round(Number(dimAttr("height") ?? vb?.[2] ?? 900));

const work = mkdtempSync(join(tmpdir(), "diagram-preview-"));
const out = join(tmpdir(), `${basename(svgPath, ".svg")}-preview.png`);
// Chrome サンドボックスは既定で有効（ローカルの安全性を下げない）。root/コンテナ等
// サンドボックスが使えない環境でだけ DIAGRAM_CHROME_NO_SANDBOX=1 で opt-in する。
const noSandbox = process.env.DIAGRAM_CHROME_NO_SANDBOX === "1";
// 応答が返らない（ハングする）ケースを検出可能な失敗に変える。DIAGRAM_CHROME_TIMEOUT_MS で調整。
// 不正値（非数・0 以下）は既定へ倒す（NaN を渡すと timeout が無効になり元のハングへ戻るため）。
const timeoutEnv = Number(process.env.DIAGRAM_CHROME_TIMEOUT_MS);
const timeoutMs = Number.isFinite(timeoutEnv) && timeoutEnv > 0 ? timeoutEnv : 120000;
// work は preview.html 置き場。out（PNG）は tmpdir 直下なのでクリーンアップの影響を受けない。
// 任意の SVG（ファイル名指定も可）を Chrome で開くため、埋め込み前に <script>/on* を
// 除去する（diagram-engine のアイコン埋め込みと同型の多層防御。自前生成の SVG では no-op）。
const safeSvg = svg
  .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
  .replace(/<script\b[^>]*\/>/gi, "")
  .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
  .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
  // クォート無しの on* も除去（値内の `/` は許すが、自己終端 `/>` の `/` は食わない）。
  .replace(/\son[a-z]+\s*=\s*(?:[^\s"'>/]|\/(?!>))*/gi, "");

let failure = null;
try {
  const html = join(work, "preview.html");
  writeFileSync(
    html,
    `<!doctype html><meta charset="utf-8"><body style="margin:0">${safeSvg}</body>`,
  );
  execFileSync(
    chrome,
    [
      "--headless",
      ...(noSandbox ? ["--no-sandbox"] : []),
      "--disable-gpu",
      // コンテナの /dev/shm は既定 64MB しかなく、大きめのキャンバスでは Chrome が
      // 共有メモリ不足で SIGTRAP 終了・ハングを起こす（不定期に失敗する）。共有メモリの
      // 代わりに /tmp を使わせて安定させる。/dev/shm が十分な環境では実害が無く、
      // --no-sandbox と違って安全性も下げないため常に付ける。
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      `--screenshot=${out}`,
      `--window-size=${width},${height}`,
      "--default-background-color=FFFFFFFF",
      pathToFileURL(html).href,
    ],
    // killSignal は既定（SIGTERM）にしない。SIGTERM をハンドルできない状態で固まった
    // 子プロセスは終了せず、execFileSync が timeout を過ぎても戻らない（＝この timeout が
    // 防ごうとしているハングがそのまま残る）。SIGKILL なら握り潰せないので必ず戻る。
    { stdio: ["ignore", "ignore", "pipe"], timeout: timeoutMs, killSignal: "SIGKILL" },
  );
} catch (err) {
  failure = err;
} finally {
  // 失敗時も含め一時ディレクトリを必ず削除（/tmp にゴミを残さない）。
  // process.exit は finally を実行しないため、失敗の報告はこのブロックの後で行う。
  rmSync(work, { recursive: true, force: true });
}

if (failure) {
  // Chrome の実行以外の失敗（HTML の書き出し等）は握り潰さずそのまま投げる。
  if (failure.status === undefined && failure.signal === undefined) throw failure;
  // execFileSync の例外をそのまま投げると stdout/stderr の Buffer ダンプが数十行続き、
  // 切り分けに要る signal / status が埋もれる。要点と対処だけを出す。
  // タイムアウトで kill されたときは code === "ETIMEDOUT"（signal は killSignal に指定した
  // SIGKILL が入るだけで、他の signal 終了と区別が付かない）。実測で確認した形状に合わせて分岐する。
  const reason =
    failure.code === "ETIMEDOUT"
      ? `${timeoutMs}ms 応答なしで中断`
      : failure.signal
        ? `signal ${failure.signal}`
        : `exit ${failure.status ?? failure.code}`;
  console.error(`Chrome での PNG 化に失敗しました（${reason}）: ${chrome}`);
  // dbus 関連の警告は成功時にも出るノイズなので落とし、残りの末尾だけ見せる。
  const lines = String(failure.stderr ?? "")
    .split("\n")
    .filter((l) => l.trim() && !/dbus|Failed to connect to the bus/i.test(l));
  if (lines.length) console.error(lines.slice(-5).join("\n"));
  console.error(
    "対処: メモリ不足が疑われる場合はコンテナの --shm-size を増やす" +
      "（共有メモリ回避の --disable-dev-shm-usage は既定で付与済み）。" +
      (noSandbox
        ? ""
        : "サンドボックスが使えない環境では DIAGRAM_CHROME_NO_SANDBOX=1 を設定する。") +
      "応答待ちで中断した場合は DIAGRAM_CHROME_TIMEOUT_MS で延長する。",
  );
  process.exit(1);
}

console.log(out);
