// 文書のチェック（check-doc-refs.ts・check-time-sensitive-prose.ts・check-version-mentions.ts）が共有する、走査対象。
//
// 走査対象は、テキストの実体のファイル（コピーとリンクを除く。scripts/lib/source-scope.ts）のうち、
// Tier 4（経過の記録）と階層の外（eval の入力）を除いたもの。階層は scripts/gates/docs/doc-tiers.json で決める。
// Markdown は表の階層、それ以外のファイルはコードコメントとして Tier 3 に数える。
import { TEXT_EXTENSIONS } from "../code/check-control-chars.ts";
import { listSources } from "../tooling/run-on-sources.ts";
import { ALLOWED_PATH } from "../../lib/doc-scan.ts";
import { loadDocTiers, tierOf } from "./doc-tiers.ts";

export type ScannedFile = { file: string; tier: number; markdown: boolean };

// eval の入力（prompt と期待値）は、eval が想定する別のリポジトリの状態を書いたものなので読まない。
const EVAL_INPUT_RE = /^evals\/[^/]+\/evals\.json$/;

/**
 * 走査するファイルと階層。
 * options の exclude はチェック自身の fixture など、読まないファイル。
 */
export function scannedFiles(
  root: string,
  { exclude = [] }: { exclude?: readonly string[] } = {},
): ScannedFile[] {
  const config = loadDocTiers(root);
  const out: ScannedFile[] = [];
  for (const file of listSources(root, TEXT_EXTENSIONS)) {
    if (exclude.includes(file) || file === ALLOWED_PATH || EVAL_INPUT_RE.test(file)) continue;
    const markdown = file.endsWith(".md");
    const tier = tierOf(config, file);
    // 階層の外（null）と Tier 4 は読まない。Markdown の階層が決まらない（undefined）ものは、
    // 読まずに通さないよう Tier 3 として読む。
    if (tier === null || tier === 4) continue;
    out.push({ file, tier: markdown && tier !== undefined ? tier : 3, markdown });
  }
  return out;
}
