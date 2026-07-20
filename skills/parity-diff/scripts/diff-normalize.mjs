// 特性照合の差分に正規化レジストリを適用して機械分類する（正本）。
// 正本はこのスキル側にあり、実行時はスキルディレクトリ内から直接実行する
// （プロジェクトへコピーしない。gh skill update の自動更新を効かせるため）。
//
// 何をするか: trait-compare.mjs の出力（Diff 配列）に、意図的差異レジストリ・コンポーネント系統差 T・
// インスタンス例外・ノイズ基準値を機械的に当てて各 Diff を分類する。「LLM に判断させない部分」を担う。
// LLM トリアージは、ここで unexplained / deviates_T / pending_review として残った候補だけを 1 件ずつ扱う。
//
// 何をしないか: 差分の検出（trait-compare の仕事）・crop 生成（pixel-crops の仕事）・
// 分類の主観判断（triage の仕事）は行わない。
//
// レジストリは YAML パーサを同梱しないため、skills.yml から該当キーを読み取って JSON へ変換した
// registries.json を受け取る（intentional_diffs / component_diffs / component_diff_exceptions）。
//
// 決定論的: 乱数・現在時刻に依存しない。入力順を保って分類する。
// TypeScript 構文は使わない（型は JSDoc）。

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * ツールのバージョン（正本）。分類ロジック・出力形状を変えたら上げる。
 * diff-metadata.json の differ_versions.diff_normalize に記録する値はこれを使う（手入力にしない）。
 * @type {string}
 */
export const VERSION = "1";

/**
 * CSS 値・ラベルの表記ゆれを吸収した正規化文字列を返す（単位そのものは残す）。
 * @param {unknown} v
 * @returns {string}
 */
export function normalizeValue(v) {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * 意図的差異レジストリの分類 3 群のどれに該当するかを返す（部分一致・最良努力）。
 * 各エントリはカテゴリ文字列であり、Diff の name / prop にそのテキストが含まれるかで判定する。
 * 最終判断は triage が担う（ここは機械的な粗フィルタ）。
 * @param {{ name?:string, prop?:string }} diff
 * @param {{ keep?:string[], may_change?:string[], pending?:string[] }} registry
 * @returns {{ group:'keep'|'may_change'|'pending', entry:string } | null}
 */
export function matchIntentional(diff, registry) {
  const hay = normalizeValue(`${diff.name ?? ""} ${diff.prop ?? ""}`);
  for (const group of ["keep", "may_change", "pending"]) {
    const entries = Array.isArray(registry?.[group]) ? registry[group] : [];
    for (const entry of entries) {
      const needle = normalizeValue(entry);
      if (needle.length > 0 && hay.includes(needle)) {
        return { group: /** @type {'keep'|'may_change'|'pending'} */ (group), entry };
      }
    }
  }
  return null;
}

/**
 * コンポーネント系統差 T との照合。クラス名は補助メタ扱いで、判定は property と値で行う。
 * @param {{ prop?:string, expected?:string, actual?:string }} diff
 * @param {Array<{ component?:string, property:string, current:string, new:string, reason?:string }>} componentDiffs
 * @returns {{ status:'absorbed_T'|'deviates_T', rule:object } | null}
 */
export function matchComponentT(diff, componentDiffs) {
  const list = Array.isArray(componentDiffs) ? componentDiffs : [];
  /** @type {{ status:'deviates_T', rule:object } | null} */
  let deviation = null;
  for (const t of list) {
    if (normalizeValue(t.property) !== normalizeValue(diff.prop)) continue;
    const baselineMatches = normalizeValue(diff.expected) === normalizeValue(t.current);
    if (!baselineMatches) continue;
    if (normalizeValue(diff.actual) === normalizeValue(t.new)) {
      return { status: "absorbed_T", rule: t };
    }
    deviation = { status: "deviates_T", rule: t };
  }
  return deviation;
}

/**
 * インスタンス例外との照合。slug・page・state・viewport・element・property・値が合致するか。
 * @param {{ name?:string, prop?:string, expected?:string, actual?:string }} diff
 * @param {Array<object>} exceptions
 * @param {{ slug:string, page?:string, state?:string, viewport?:string }} ctx
 * @returns {object | null}
 */
export function matchException(diff, exceptions, ctx) {
  const list = Array.isArray(exceptions) ? exceptions : [];
  for (const ex of list) {
    if (ex.slug && ex.slug !== ctx.slug) continue;
    if (ctx.page && ex.page && ex.page !== ctx.page) continue;
    if (ctx.state && ex.state && ex.state !== ctx.state) continue;
    if (ctx.viewport && ex.viewport && ex.viewport !== ctx.viewport) continue;
    const elementOk = !ex.element || ex.element === "none" || ex.element === diff.name;
    if (!elementOk) continue;
    const propertyOk =
      ex.property === "pixel" || normalizeValue(ex.property) === normalizeValue(diff.prop);
    if (!propertyOk) continue;
    const valuesOk =
      normalizeValue(ex.current) === normalizeValue(diff.expected) &&
      normalizeValue(ex.new) === normalizeValue(diff.actual);
    if (!valuesOk) continue;
    return ex;
  }
  return null;
}

/**
 * ノイズ基準値から該当 page/state/viewport の行を引く（最初に合致した行）。
 * 吸収の判定はここでは行わない（applyNoiseBaseline が残余の件数と集計で比較する）。
 * @param {Array<{ page?:string, state?:string, viewport?:string, trait_diffs?:number }>} noiseBaseline
 * @param {{ page?:string, state?:string, viewport?:string }} ctx
 * @returns {{ trait_diffs:number } | null}
 */
export function matchNoise(noiseBaseline, ctx) {
  const list = Array.isArray(noiseBaseline) ? noiseBaseline : [];
  for (const row of list) {
    if (ctx.page && row.page && row.page !== ctx.page) continue;
    if (ctx.state && row.state && row.state !== ctx.state) continue;
    if (ctx.viewport && row.viewport && row.viewport !== ctx.viewport) continue;
    return { trait_diffs: Number(row.trait_diffs) || 0 };
  }
  return null;
}

/**
 * レジストリで説明できなかった残余（unexplained）にノイズ基準値を集計で適用する。
 * 「新側との差分が基準値と同程度なら回帰ではない」の判定であり、個々の Diff 単位では
 * どれがノイズかを決められないため、残余の件数が基準値 trait_diffs 以下のときに限り
 * 全件を noise_candidate に落とす。超えていれば 1 件も吸収しない（実回帰を黙って
 * 吸収しないための安全側）。基準値の行が無い組は吸収しない。
 * @param {Array<{ classification:string, matched_rule:(object|string|null) }>} classified
 * @param {Array<object>} noiseBaseline
 * @param {{ page?:string, state?:string, viewport?:string }} ctx
 * @returns {Array<{ classification:string, matched_rule:(object|string|null) }>}
 */
export function applyNoiseBaseline(classified, noiseBaseline, ctx) {
  const noise = matchNoise(noiseBaseline, ctx);
  if (!noise || noise.trait_diffs <= 0) return classified;
  const residual = classified.filter((d) => d.classification === "unexplained").length;
  if (residual === 0 || residual > noise.trait_diffs) return classified;
  return classified.map((d) =>
    d.classification === "unexplained"
      ? {
          ...d,
          classification: "noise_candidate",
          matched_rule: `noise_baseline: residual ${residual} <= trait_diffs ${noise.trait_diffs}`,
        }
      : d,
  );
}

/**
 * 1 件の Diff を分類する。順序は intentional → T → exception → unexplained。
 * ノイズ基準値は個々の Diff ではなく残余へ集計で適用する（applyNoiseBaseline）。
 * @param {object} diff
 * @param {object} registries - { intentional_diffs, component_diffs, component_diff_exceptions }
 * @param {{ slug:string, page?:string, state?:string, viewport?:string }} ctx
 * @returns {{ classification:string, matched_rule: (object|string|null) }}
 */
export function classifyDiff(diff, registries, ctx) {
  const intentional = matchIntentional(diff, registries.intentional_diffs || {});
  if (intentional) {
    if (intentional.group === "pending") {
      return {
        classification: "pending_review",
        matched_rule: `intentional_diffs.pending: ${intentional.entry}`,
      };
    }
    return {
      classification: "absorbed_registry",
      matched_rule: `intentional_diffs.${intentional.group}: ${intentional.entry}`,
    };
  }
  const t = matchComponentT(diff, registries.component_diffs);
  if (t) return { classification: t.status, matched_rule: t.rule };
  const ex = matchException(diff, registries.component_diff_exceptions, ctx);
  if (ex) return { classification: "absorbed_exception", matched_rule: ex };
  return { classification: "unexplained", matched_rule: null };
}

/**
 * CLI エントリ。
 * `node diff-normalize.mjs <trait-diffs.json> --registries <registries.json> --slug <slug> [--page <p> --state <s> --viewport <v>] [--noise <metadata.json>]`
 * unexplained / deviates_T / pending_review があれば exit 1、全て吸収なら exit 0、入力エラーは exit 2。
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {number} exit code
 */
export function main(argv) {
  const usage =
    "usage: node diff-normalize.mjs <trait-diffs.json> --registries <registries.json> --slug <slug> [--page <p> --state <s> --viewport <v>] [--noise <metadata.json>]\n";
  const positionals = [];
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (
      a === "--registries" ||
      a === "--slug" ||
      a === "--page" ||
      a === "--state" ||
      a === "--viewport" ||
      a === "--noise"
    ) {
      opts[a.slice(2)] = argv[i + 1];
      i += 1;
    } else {
      positionals.push(a);
    }
  }
  if (positionals.length !== 1 || !opts.registries || !opts.slug) {
    process.stderr.write(usage);
    return 2;
  }
  let diffs;
  let registries;
  let noiseBaseline = [];
  try {
    diffs = JSON.parse(readFileSync(positionals[0], "utf8"));
    registries = JSON.parse(readFileSync(opts.registries, "utf8"));
    if (opts.noise) {
      const meta = JSON.parse(readFileSync(opts.noise, "utf8"));
      noiseBaseline = Array.isArray(meta.noise_baseline) ? meta.noise_baseline : [];
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: cannot read inputs: ${message}\n`);
    return 2;
  }
  if (!Array.isArray(diffs)) {
    process.stderr.write("error: <trait-diffs.json> must be a JSON array of trait diffs\n");
    return 2;
  }
  if (!registries || typeof registries !== "object") {
    process.stderr.write("error: --registries must be a JSON object\n");
    return 2;
  }
  const ctx = { slug: opts.slug, page: opts.page, state: opts.state, viewport: opts.viewport };
  const classified = applyNoiseBaseline(
    diffs.map((diff) => ({ ...diff, ...classifyDiff(diff, registries, ctx) })),
    noiseBaseline,
    ctx,
  );
  process.stdout.write(JSON.stringify(classified, null, 2) + "\n");
  const actionable = classified.some(
    (d) =>
      d.classification === "unexplained" ||
      d.classification === "deviates_T" ||
      d.classification === "pending_review",
  );
  return actionable ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  process.exit(main(process.argv.slice(2)));
}
