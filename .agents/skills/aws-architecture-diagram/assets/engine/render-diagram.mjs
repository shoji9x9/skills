// 構成図 SVG を生成する（スキル所有のエンジン。コピーせずスキルから実行する）。
//   cd <プロジェクトの図ディレクトリ> && node <skill>/assets/engine/render-diagram.mjs [--env a,b]
//   （または DIAGRAM_DIR=<図ディレクトリ> を指定）
//
// プロジェクト所有ファイル（DIAGRAM_DIR に置く。既定は cwd）:
//   environments.mjs      環境レジストリ（＝存在すべき環境の単一ソース。.js でもよい）
//   architecture-spec.mjs 環境レジストリが読む base 仕様（レジストリからの相対 import なので
//                         ファイル名・拡張子はプロジェクトが自由に決めてよい）
//   icons/                アイコン（browser/internet ＋ fetch した aws-icons/）
//   out/                  SVG 出力先
//
// 対象環境: --env 省略時は環境レジストリの全環境、--env a,b で一部だけ。
// 場所の上書き: DIAGRAM_DIR / DIAGRAM_ICON_DIR / DIAGRAM_OUT_DIR。
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { renderDiagram } from "./diagram-engine.mjs";

const DIAGRAM_DIR = process.env.DIAGRAM_DIR ?? process.cwd();
const ICON_DIR = process.env.DIAGRAM_ICON_DIR ?? join(DIAGRAM_DIR, "icons");
const OUT_DIR = process.env.DIAGRAM_OUT_DIR ?? join(DIAGRAM_DIR, "out");

// 環境レジストリの拡張子は決め打ちしない。"type": "module" のプロジェクトでは .js が既定で ESM に
// なるため、リポジトリの拡張子規約に合わせて environments.js で置けるようにする（.mjs 優先なので
// 既存プロジェクトの挙動は変わらない）。どちらも無いときは ERR_MODULE_NOT_FOUND ではなく、探した
// 候補を示すエラーで止める（「レジストリの中身を間違えた」との誤診を防ぐ）。
const REGISTRY_CANDIDATES = ["environments.mjs", "environments.js"];
const found = REGISTRY_CANDIDATES.map((name) => join(DIAGRAM_DIR, name)).filter((p) =>
  existsSync(p),
);
const registryPath = found[0];
if (!registryPath) {
  throw new Error(
    `環境レジストリが見つかりません: ${DIAGRAM_DIR} に ${REGISTRY_CANDIDATES.join(" か ")} を置いてください。`,
  );
}
// 両方あると先勝ちで片方が黙って無視され、「編集したのに図に反映されない」を起こす（.mjs →
// .js へリネームした際の消し忘れが典型）。どちらを使いどちらを捨てたかを必ず知らせる。
if (found.length > 1) {
  console.error(
    `警告: 環境レジストリが複数あります。${registryPath} を使い、${found.slice(1).join(" / ")} は無視します（リネームしたなら古い方を削除してください）。`,
  );
}

// プロジェクト所有の環境レジストリを動的 import（sibling の base 仕様もそこから辿られる）。
// レジストリは環境定義（environments）と base（baseSpec）だけを持てばよく、環境→spec の
// 解決はここ（エンジン）で行う（プロジェクト側のボイラープレートを増やさない）。
const { environments, baseSpec } = await import(pathToFileURL(registryPath).href);

// 環境名 → spec（transform があれば base に適用、無ければ base に title だけ差し替え）。
// title 未設定の環境は base の title を既定に使う（"undefined" が図に出るのを防ぐ）。
function specFor(name) {
  const env = environments[name];
  if (!env) {
    throw new Error(`未知の環境: ${name}（定義済み: ${Object.keys(environments).join(", ")}）`);
  }
  if (env.transform) {
    // baseSpec は clone して渡す。transform が誤って base をミューテートしても環境間で
    // 汚染しないため（環境の独立性を担保。structuredClone は Node 18+）。
    const s = env.transform(structuredClone(baseSpec));
    // transform が title を付け忘れても "undefined" が図に出ないよう最終フォールバック。
    return { ...s, title: s.title ?? env.title ?? baseSpec.title };
  }
  return { ...baseSpec, title: env.title ?? baseSpec.title };
}

// --env の指定を取り出す（--env a,b / --env=a,b いずれも受ける）。
// フラグの有無と値を区別する（--env を付けたのに値が空、を全環境と取り違えないため）。
function envArg() {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--env") return { present: true, value: argv[i + 1] };
    if (a.startsWith("--env=")) return { present: true, value: a.slice("--env=".length) };
  }
  return { present: false };
}

function resolveEnvs() {
  const { present, value } = envArg();
  if (!present) return Object.keys(environments); // --env 無し = 全環境
  // 値が無い／次トークンが別フラグ（--）のときは、それを環境名扱いせず明示エラーにする。
  if (value === undefined || value.startsWith("--")) {
    throw new Error("--env には環境名を指定してください（例: --env prod,local）。省略時は全環境。");
  }
  const list = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.length) {
    throw new Error("--env には環境名を指定してください（例: --env prod,local）。省略時は全環境。");
  }
  return list;
}

// 先に全環境をレンダリングしてから書き出す。エンジンは規約違反（直交検査・重複エッジ等）を
// 例外で止めるため、レンダリングと書き出しを交互に行うと「先頭の環境だけ新しく、残りは
// 古いまま」の out/ が残り、目視確認で stale な PNG を新しい図と取り違える。
mkdirSync(OUT_DIR, { recursive: true });
const rendered = resolveEnvs().map((name) => ({
  out: join(OUT_DIR, `architecture-${name}.svg`),
  svg: renderDiagram(specFor(name), { iconDir: ICON_DIR }),
}));
for (const { out, svg } of rendered) {
  writeFileSync(out, svg);
  console.log(`wrote ${out} (${svg.length} bytes)`);
}
