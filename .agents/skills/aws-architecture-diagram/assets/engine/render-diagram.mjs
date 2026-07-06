// 構成図 SVG を生成する（スキル所有のエンジン。コピーせずスキルから実行する）。
//   cd <プロジェクトの図ディレクトリ> && node <skill>/assets/engine/render-diagram.mjs [--env a,b]
//   （または DIAGRAM_DIR=<図ディレクトリ> を指定）
//
// プロジェクト所有ファイル（DIAGRAM_DIR に置く。既定は cwd）:
//   environments.mjs      環境レジストリ（＝存在すべき環境の単一ソース）
//   architecture-spec.mjs environments.mjs が読む base 仕様
//   icons/                アイコン（browser/internet ＋ fetch した aws-icons/）
//   out/                  SVG 出力先
//
// 対象環境: --env 省略時は environments.mjs の全環境、--env a,b で一部だけ。
// 場所の上書き: DIAGRAM_DIR / DIAGRAM_ICON_DIR / DIAGRAM_OUT_DIR。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { renderDiagram } from "./diagram-engine.mjs";

const DIAGRAM_DIR = process.env.DIAGRAM_DIR ?? process.cwd();
const ICON_DIR = process.env.DIAGRAM_ICON_DIR ?? join(DIAGRAM_DIR, "icons");
const OUT_DIR = process.env.DIAGRAM_OUT_DIR ?? join(DIAGRAM_DIR, "out");

// プロジェクト所有の environments.mjs を動的 import（sibling の architecture-spec.mjs も辿る）。
// environments.mjs は環境定義（environments）と base（baseSpec）だけを持てばよく、環境→spec の
// 解決はここ（エンジン）で行う（プロジェクト側のボイラープレートを増やさない）。
const { environments, baseSpec } = await import(
  pathToFileURL(join(DIAGRAM_DIR, "environments.mjs")).href
);

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

mkdirSync(OUT_DIR, { recursive: true });
for (const name of resolveEnvs()) {
  const svg = renderDiagram(specFor(name), { iconDir: ICON_DIR });
  const out = join(OUT_DIR, `architecture-${name}.svg`);
  writeFileSync(out, svg);
  console.log(`wrote ${out} (${svg.length} bytes)`);
}
