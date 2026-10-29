// エンジンのスクリプト（render・preview・fetch）が共通に使う、場所と Chrome の設定の決め方。
//
// 設定は shoji9x9/skills の共通の置き場所の aws-architecture-diagram.jsonc に置き、同梱の skill-config.mjs で読む
// （置き場所・層・解決の順序は references/config-files.md）。1 回だけ変える値は、CLI のオプションで渡す。
//
// | 値 | CLI のオプション（cwd からの相対パス） | 設定のキー（リポジトリのルートからの相対パス） | どちらも無いとき |
// | --- | --- | --- | --- |
// | 図のディレクトリ | --dir | diagram_dir | cwd |
// | アイコン | --icon-dir | icon_dir | <図のディレクトリ>/icons |
// | SVG の出力先 | --out-dir | out_dir | <図のディレクトリ>/out |
// | Chrome のサンドボックスを無効にする | --no-sandbox | chrome_no_sandbox | 有効のまま |
// | PNG への変換を打ち切る時間（ミリ秒） | --timeout-ms | chrome_timeout_ms | 120000 |
import { join, resolve } from "node:path";
import { parseFlags } from "./lib/flags.mjs";
import { ConfigError, findRoot, loadConfig } from "./skill-config/skill-config.mjs";

/** このモジュールが読む、値を取る引数。 */
const VALUED = ["--dir", "--icon-dir", "--out-dir", "--timeout-ms"];

/**
 * @typedef {object} DiagramConfig
 * @property {string} dir 図のディレクトリ
 * @property {string} iconDir アイコンのディレクトリ
 * @property {string} outDir SVG の出力先
 * @property {boolean} noSandbox Chrome のサンドボックスを無効にするか
 * @property {number} timeoutMs PNG への変換を打ち切る時間（ミリ秒）
 * @property {Record<string, string | string[] | true>} flags スクリプトが受け付ける引数の値（このモジュールが読む引数も入る）
 * @property {string[]} positionals 位置引数
 */

/**
 * スクリプトの引数を読む。このモジュールが読む引数（--dir など）に、スクリプトが受け付ける引数を足して parseFlags に渡す。
 * `--名前=値` の形も受け付ける。誤りがあれば、理由と使い方を stderr に出して exit 2 で止める。
 * @param {string[]} argv
 * @param {{ values?: readonly string[], positionals?: number, usage: string }} script スクリプトが受け付ける引数と使い方
 * @returns {{ flags: Record<string, string | string[] | true>, positionals: string[] }}
 */
function readArgs(argv, script) {
  const parsed = parseFlags(argv, {
    values: [...VALUED, ...(script.values ?? [])],
    bools: ["--no-sandbox"],
    positionals: script.positionals ?? 0,
    equals: true,
  });
  if (parsed.error === undefined) return parsed;
  console.error(`error: ${parsed.error}`);
  console.error(script.usage);
  // スクリプトの使い方には、このモジュールが読む引数が無い。書かないと、受け付ける引数を読み手が知る方法が無い。
  console.error(
    "  共通: [--dir <dir>] [--icon-dir <dir>] [--out-dir <dir>] [--timeout-ms <ms>] [--no-sandbox]",
  );
  process.exit(2);
}

/**
 * 場所と Chrome の設定を決める。設定の誤り（知らないキー・型の誤り・置けない層・使わなくなった環境変数 DIAGRAM_*）は、
 * 理由を stderr に出して exit 1 で止める。
 * @param {string[]} argv スクリプトの引数（process.argv.slice(2)）
 * @param {{ values?: readonly string[], positionals?: number, usage: string }} script スクリプトが受け付ける引数と使い方
 * @param {{ cwd?: string; env?: NodeJS.ProcessEnv }} [o]
 * @returns {DiagramConfig}
 */
export function diagramConfig(argv, script, o = {}) {
  const cwd = o.cwd ?? process.cwd();
  const env = o.env ?? process.env;
  const { flags, positionals } = readArgs(argv, script);
  const root = findRoot(cwd);
  /** @type {ReturnType<typeof loadConfig>} */
  let r;
  try {
    r = loadConfig({ name: "aws-architecture-diagram", root, env });
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
  /** @param {string} key */
  const fromRoot = (key) => {
    const v = r[key]?.value;
    return typeof v === "string" ? resolve(root, v) : undefined;
  };
  /** @param {string} name */
  const fromCli = (name) => {
    const v = flags[name];
    return typeof v === "string" ? resolve(cwd, v) : undefined;
  };
  const dir = fromCli("--dir") ?? fromRoot("diagram_dir") ?? cwd;
  const iconDir = fromCli("--icon-dir") ?? fromRoot("icon_dir") ?? join(dir, "icons");
  const outDir = fromCli("--out-dir") ?? fromRoot("out_dir") ?? join(dir, "out");
  const noSandbox = flags["--no-sandbox"] === true || r.chrome_no_sandbox?.value === true;
  const rawTimeout = flags["--timeout-ms"];
  let timeoutMs =
    typeof r.chrome_timeout_ms?.value === "number" ? r.chrome_timeout_ms.value : 120000;
  if (typeof rawTimeout === "string") {
    // 数でない値や 0 以下を受け付けると、打ち切りが無効になり、応答しない Chrome を待ち続ける
    if (!/^[1-9]\d*$/.test(rawTimeout))
      throw new Error("--timeout-ms には 1 以上の整数を指定してください");
    timeoutMs = Number(rawTimeout);
  }
  return { dir, iconDir, outDir, noSandbox, timeoutMs, flags, positionals };
}
