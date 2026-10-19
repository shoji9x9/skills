// kaizen のスクリプトのテストが、設定ファイル（kaizen.jsonc）を置き、手元の設定から隔離した環境で起動するための部品。
//
// 手元の人ごとの設定（~/.config/skills/shoji9x9/kaizen.jsonc）や、シェルに残った KAIZEN_* の環境変数を
// テストが読むと、結果が手元の状態で変わる。そこで XDG_CONFIG_HOME を一時ディレクトリの中に向け、KAIZEN_* を消す。
// スクリプトは設定ファイルがあると node で読むので、テストを実行している node のディレクトリを PATH の先頭に置く
// （mise の shim はリポジトリの外のディレクトリでは node を解決できない）。
import { mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

/** kaizen のスクリプトを起動する環境。extra の undefined はその変数を消す。 */
export function kaizenEnv(
  dir: string,
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("KAIZEN_")) delete env[k];
  env.XDG_CONFIG_HOME = join(dir, ".test-xdg");
  env.PATH = `${dirname(process.execPath)}:${process.env.PATH ?? ""}`;
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

/** リポジトリの層の kaizen.jsonc を書く。 */
export function writeKaizenConfig(dir: string, text: string): void {
  const configDir = join(dir, ".config", "skills", "shoji9x9");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "kaizen.jsonc"), text);
}

/**
 * names のコマンドを除いた PATH を返す。base（PATH の値）の各ディレクトリの実行ファイルを dir/bin-without にリンクで集め、
 * names だけを除く。/usr/bin だけの PATH のように決め打ちすると、そこに node がある環境で「node が無い」状態を作れない。
 */
export function pathWithout(dir: string, names: string[], base: string): string {
  const bin = join(dir, "bin-without");
  mkdirSync(bin, { recursive: true });
  for (const d of base.split(delimiter)) {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (names.includes(name)) continue;
      try {
        symlinkSync(join(d, name), join(bin, name));
      } catch {
        // 先に見つかった同名のコマンドを優先する（PATH の順と同じ）。
      }
    }
  }
  return bin;
}
