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
// レジストリは YAML パーサを同梱しないため、キーを名前を変えずに集めた registries.json を受け取る
// （intentional_diffs / component_diffs は設定ファイル由来、component_diff_exception_causes /
// component_diff_exceptions は .replace/parity/<slug>/component-diff-exceptions.json 由来。
// 組み立て方の正本は references/normalize.md「registries.json の組み立て」）。
//
// インスタンス例外は原因を causes 側に 1 回だけ持ち、インスタンスは cause（id）で参照する。
// 参照や照合キーが揃わないインスタンスは fail-closed で照合に使わない（吸収されず unexplained として
// 残る）。理由は「黙って吸収する」より「残す」ほうが安全側だから。
// ただし黙って捨てもしない——fail-closed で照合に使わなかった例外は stderr の警告として出す
// （diff.md の不整合の母数。条件の一覧は references/normalize.md が正本なのでここでは数を固定しない）。
//
// 決定論的: 乱数・現在時刻に依存しない。入力順を保って分類する。
// TypeScript 構文は使わない（型は JSDoc）。

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * ツールのバージョン（正本）。分類ロジック・出力形状を変えたら上げる。
 * diff-metadata.json の differ_versions.diff_normalize に記録する値はこれを使う（手入力にしない）。
 * @type {string}
 */
export const VERSION = "2";

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
 * インスタンス例外の cause（id）を causes 配列へ解決する。
 * 解決できない・根拠（evidence）が空の原因は null を返し、呼び出し側は照合に使わない（fail-closed）。
 * 原因の文言をインスタンスへ複製させないための参照解決であり、照合キーには一切関与しない。
 * @param {object} ex - インスタンス例外
 * @param {Array<{ id?:string, reason?:string, evidence?:string }>} causes
 * @returns {{ id:string, reason:string, evidence:string } | null}
 */
export function resolveExceptionCause(ex, causes) {
  const list = Array.isArray(causes) ? causes : [];
  if (!ex || typeof ex.cause !== "string" || ex.cause.length === 0) return null;
  const found = list.find((c) => c && c.id === ex.cause);
  if (!found) return null;
  const evidence = typeof found.evidence === "string" ? found.evidence.trim() : "";
  if (evidence.length === 0) return null;
  return {
    id: found.id,
    reason: typeof found.reason === "string" ? found.reason : "",
    evidence,
  };
}

/**
 * インスタンス例外の参照整合を検査して、照合に使えないものの理由を列挙する。
 * 「何も出ないこと」を合格根拠にせず、CLI は結果を stderr の警告として出す
 * （警告が出た例外は照合されていない＝候補は unexplained のまま残る）。
 * 検査するのは fail-closed の各条件（条件の一覧は references/normalize.md が正本）で、
 * これが diff-metadata.json の accepted_exceptions.unresolved の母数になる。
 * @param {Array<object>} exceptions
 * @param {Array<object>} causes
 * @param {string} [slug] - 対象 slug（ctx.slug）。渡すと slug 不一致も検出する
 * @returns {string[]} 問題の説明（空配列なら全件が照合に使える）
 */
export function validateExceptions(exceptions, causes, slug) {
  const list = Array.isArray(exceptions) ? exceptions : [];
  const problems = [];
  list.forEach((ex, i) => {
    const at = `component_diff_exceptions[${i}]`;
    if (!ex || typeof ex !== "object") {
      problems.push(`${at}: not an object`);
      return;
    }
    if (!ex.slug) {
      problems.push(`${at}: missing slug — not used for matching`);
    } else if (slug && ex.slug !== slug) {
      problems.push(
        `${at}: slug "${ex.slug}" does not match the target slug "${slug}" — not used for matching`,
      );
    }
    // 照合キーの欠落は「どの値にも合う」ではなく不一致（1 エントリで N 件を畳めないようにする）。
    // element も照合キー（論理名。無ければ "none" を書く）なので欠落を検出する——書き忘れると
    // どの Diff にも合致せず、警告が無ければ「黙って無効化された例外」になる。
    // state だけはスキーマに既定値 default があるので欠落を不足として数えない。
    const missingKeys = ["page", "viewport", "element"].filter((k) => !ex[k]);
    if (missingKeys.length > 0) {
      problems.push(
        `${at}: missing matching key(s) ${missingKeys.join(", ")} — not used for matching ` +
          `(an omitted key is not a wildcard; write one instance per occurrence)`,
      );
    }
    if (typeof ex.cause !== "string" || ex.cause.length === 0) {
      problems.push(`${at}: missing cause (required; the reason text lives in the cause entry)`);
      return;
    }
    if (!resolveExceptionCause(ex, causes)) {
      problems.push(
        `${at}: cause "${ex.cause}" is unresolved or its evidence is empty — not used for matching`,
      );
    }
  });
  return problems;
}

/**
 * インスタンス例外との照合。slug・page・state・viewport・element・property・値が合致するか。
 * slug はスキーマ上必須のため、欠落・不一致の例外は常に不一致として扱う
 * （書き忘れた例外が全 slug の差分を吸収しないための安全側）。
 * cause が解決できない例外も同じく不一致として扱う（fail-closed）。
 *
 * 照合キー（page / viewport）の欠落も不一致として扱う。欠落を「どの値にも合う」と
 * 読むと 1 エントリが N インスタンスを吸収でき、契約が禁じている「件数を畳まない」を
 * スキーマ側から破れてしまう（元の実装では別ページ・別状態の 2 件が警告なしで吸収された）。
 * matchNoise が「行側の欠落は不一致として扱う」のと同じ規律で、
 * 「件数は検証の弱さのシグナル」を命名規約ではなくコードで守る。
 * state だけはスキーマの既定値 default を補う。
 *
 * element の "none" は「論理名が無い要素」を指すスキーマ値であって match-all ではない
 * （特性照合の Diff は必ず論理名を持つため、"none" の例外はこの経路では合致しない。
 * 画素経路の例外は本スキルが適用する）。
 *
 * 合致したら解決済みの原因を cause_reason / cause_evidence として添えて返す。
 * @param {{ name?:string, prop?:string, expected?:string, actual?:string }} diff
 * @param {Array<object>} exceptions
 * @param {{ slug:string, page?:string, state?:string, viewport?:string }} ctx
 * @param {Array<object>} causes - registries.component_diff_exception_causes
 * @returns {object | null}
 */
export function matchException(diff, exceptions, ctx, causes) {
  const list = Array.isArray(exceptions) ? exceptions : [];
  for (const ex of list) {
    if (!ex.slug || ex.slug !== ctx.slug) continue;
    // ctx 側の欠落も不一致にする。Diff は page / viewport を持たないので、ctx に無ければ
    // 「どの page / viewport の候補か」を確かめる手段が無い——ここを「指定されたときだけ比較」に
    // すると --page / --viewport を省いた実行で例外がページ・viewport を跨いで一致してしまう。
    if (!ctx.page || ex.page !== ctx.page) continue;
    if (!ctx.viewport || ex.viewport !== ctx.viewport) continue;
    // state だけは両側にスキーマ既定値 default があるので、欠落を default として突き合わせる。
    if ((ex.state || "default") !== (ctx.state || "default")) continue;
    const elementOk = ex.element === "none" ? !diff.name : ex.element === diff.name;
    if (!elementOk) continue;
    const propertyOk =
      ex.property === "pixel" || normalizeValue(ex.property) === normalizeValue(diff.prop);
    if (!propertyOk) continue;
    const valuesOk =
      normalizeValue(ex.current) === normalizeValue(diff.expected) &&
      normalizeValue(ex.new) === normalizeValue(diff.actual);
    if (!valuesOk) continue;
    const cause = resolveExceptionCause(ex, causes);
    if (!cause) continue;
    return { ...ex, cause_reason: cause.reason, cause_evidence: cause.evidence };
  }
  return null;
}

/**
 * ノイズ基準値から該当 page/state/viewport の行を引く（最初に合致した行）。
 * 吸収の判定はここでは行わない（applyNoiseBaseline が残余の件数と集計で比較する）。
 * noise_baseline は page × state × viewport の組で記録する契約のため、ctx で指定した軸は
 * 行側の値と厳密に比較し、行側の欠落は不一致として扱う（別の組の基準値を誤適用しない）。
 * @param {Array<{ page?:string, state?:string, viewport?:string, trait_diffs?:number }>} noiseBaseline
 * @param {{ page?:string, state?:string, viewport?:string }} ctx
 * @returns {{ trait_diffs:number } | null}
 */
export function matchNoise(noiseBaseline, ctx) {
  const list = Array.isArray(noiseBaseline) ? noiseBaseline : [];
  for (const row of list) {
    if (ctx.page && row.page !== ctx.page) continue;
    if (ctx.state && row.state !== ctx.state) continue;
    if (ctx.viewport && row.viewport !== ctx.viewport) continue;
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
 * @param {object} registries - { intentional_diffs, component_diffs, component_diff_exceptions, component_diff_exception_causes }
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
  const ex = matchException(
    diff,
    registries.component_diff_exceptions,
    ctx,
    registries.component_diff_exception_causes,
  );
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
  // 参照整合の問題は入力エラーにせず警告に留める（他の例外・レジストリの分類は続行する）。
  // 警告が出た例外は照合に使われていないため、該当候補は unexplained として残る。
  for (const problem of validateExceptions(
    registries.component_diff_exceptions,
    registries.component_diff_exception_causes,
    ctx.slug,
  )) {
    process.stderr.write(`warning: ${problem}\n`);
  }
  // fail-closed は「落とす」だけでなく「見える」まで作る。--page / --viewport を省くと
  // 照合キーを確かめられず例外は 1 件も適用されないので、黙って 0 件にせず理由を出す。
  const exceptionCount = Array.isArray(registries.component_diff_exceptions)
    ? registries.component_diff_exceptions.length
    : 0;
  const missingCtx = ["page", "viewport"].filter((k) => !ctx[k]);
  if (exceptionCount > 0 && missingCtx.length > 0) {
    process.stderr.write(
      `warning: --${missingCtx.join(" / --")} not given; ` +
        `none of the ${exceptionCount} instance exception(s) can be matched (fail-closed)\n`,
    );
  }
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

// CLI エントリ判定は両辺を実パスに解決してから突き合わせる。
// process.argv[1] は起動時のパスのまま、import.meta.url も --preserve-symlinks(-main)
// （NODE_OPTIONS 経由でも付く）では未解決のままなので、片側だけ解決すると
// シンボリックリンク経由（.claude/skills/<name> → .agents/skills/<name>）の起動で条件が偽になり、
// main() が呼ばれず何も出力せず exit 0 になる（サイレント no-op）。
const invokedAsCli = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    // 実パス解決に失敗したら生パスで突き合わせる（サイレント no-op より誤検出を選ぶ）。
    return entry === self;
  }
})();

if (invokedAsCli) {
  process.exit(main(process.argv.slice(2)));
}
