// 構成図の SVG を生成する（スキルが持つエンジン。コピーせず、スキルの場所から実行する）。
// 図のディレクトリを設定（aws-architecture-diagram.jsonc の diagram_dir）に書くか --dir で渡せば、cd しなくてよい。
//
//     cd <プロジェクトの図ディレクトリ> && node <skill>/scripts/render-diagram.mjs [--env a,b]
//
// プロジェクトが持つファイル（図のディレクトリに置く。デフォルトは cwd）は次のとおりである。
//
// - `environments.mjs`: 環境レジストリ。在るべき環境を定義する唯一の場所で、`.js` でもよい。
// - `architecture-spec.mjs`: 環境レジストリが読む base 仕様。レジストリから相対パスで import するので、
//   ファイル名と拡張子はプロジェクトが自由に決めてよい。
// - `icons/`: アイコン（browser・internet と、取得した aws-icons/）。
// - `out/`: SVG の出力先。
//
// 対象の環境は、--env を省略すると環境レジストリの全環境、`--env a,b` なら指定した環境だけになる。
// 場所の決め方（--dir・--icon-dir・--out-dir と設定のキー）は diagram-config.mjs にある。
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { diagramConfig } from "./diagram-config.mjs";
import { renderDiagram } from "./diagram-engine.mjs";

const config = diagramConfig(process.argv.slice(2), {
  values: ["--env"],
  usage: "usage: node render-diagram.mjs [--env a,b]",
});
const diagramDir = config.dir;
const ICON_DIR = config.iconDir;
const OUT_DIR = config.outDir;

// 環境レジストリの拡張子は決め打ちしない。"type": "module" のプロジェクトでは .js がデフォルトで ESM に
// なるため、リポジトリの拡張子規約に合わせて environments.js で置けるようにする（.mjs 優先なので
// 既存プロジェクトの挙動は変わらない）。どちらも無いときは ERR_MODULE_NOT_FOUND ではなく、探した
// 候補を示すエラーで止める（「レジストリの中身を間違えた」との誤診を防ぐ）。
const REGISTRY_CANDIDATES = ["environments.mjs", "environments.js"];
const found = REGISTRY_CANDIDATES.map((name) => join(diagramDir, name)).filter((p) =>
  existsSync(p),
);
const registryPath = found[0];
if (!registryPath) {
  throw new Error(
    `環境レジストリが見つかりません: ${diagramDir} に ${REGISTRY_CANDIDATES.join(" か ")} を置いてください。`,
  );
}
// 両方あると、先に見つかった方を使い、もう片方は警告なしに無視される。「編集したのに図に反映されない」が起きる
// （.mjs から .js へ名前を変えたときの消し忘れでよく起きる）。そこで、どちらを使い、どちらを使わなかったかを必ず知らせる。
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
/** @param {string} name */
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

// --env の指定を読む（--env a,b / --env=a,b いずれも受ける）。値が無いときは、diagramConfig が誤りとして止める。
function resolveEnvs() {
  const value = config.flags["--env"];
  if (typeof value !== "string") return Object.keys(environments); // --env 無し = 全環境
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
