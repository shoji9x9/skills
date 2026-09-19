// 被覆表の `present` を新側で突き合わせたかを数える検査（正本）。Issue #337。
//
// 何のためか: 部品被覆表の 3 値（`present` / `absent` / `unmeasured`）は**移行元側の測定**である。
// 「移行元でその操作が在ることを確かめた」と「新側で同じ操作を実施して移行元と差が無いことを確かめた」は
// **別の測定**なのに、どちらも `present` に見える。**欠落を見つけるのは後者だけ**で、
// 前者をいくら積んでも新側の欠落は 1 件も示されない（移行元の記録だから）。
//
// そこで**新側の突き合わせを別の成果物に持たせ**（`new/<target>/component-comparison.json`）、
// 被覆表の `present` セルすべてに対応する行を要求する。行が無ければ未突合として数える。
//
// 突き合わせの証拠は 3 点に分ける——**入口・当たり判定・完了**。
// 実測された欠落（下位を持つ項目を押すとメニューが閉じる／三角が押せる範囲の外にある／
// 並び替えの印が省略された文字に重なる）は、どれも「機能は在る」が「操作を最後まで完了できない」形で、
// ケースの文面（「エクスポート」「列のソート」）には出てこない。1 点でも欠けたら突き合わせ済みにしない。
//
// 決定論的: 乱数・現在時刻・ネットワークに依存しない。読むのは JSON だけで、ブラウザは駆動しない。
// TypeScript 構文は使わない（型は JSDoc）。
//
// 終了コード: 0 ＝ 条件を満たす（判定しない場合を含む）、1 ＝ 未突合・不整合が残る、2 ＝ 使い方の誤り・型崩れ。

import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ツールのバージョン（正本）。判定規則・出力形状を変えたら上げる。
 * @type {string}
 */
export const VERSION = "2";

/** セルの鍵の区切り。`component` / `item` / `instance` にこの文字は使えない。 */
export const KEY_SEPARATOR = "|";

/** 突き合わせの証拠の 3 点（正本）。ケースの文面に出てこない軸をここで固定する。 */
export const EVIDENCE_AXES = ["entry", "hit_area", "completion"];

/** 未突合の扱いの語彙（正本）。`accepted` は承認記録が要る。 */
export const DISPOSITIONS = ["blocking", "accepted"];

/**
 * セルの鍵。**材料が 1 つでも欠けたら鍵を作らない**——`String(undefined)` は有効な鍵へ化け、
 * 1 行が全セルを満たして未突合が 0 件に見える。
 * @param {{component?: unknown, item?: unknown, instance?: unknown}} cell
 * @returns {string | null}
 */
export function cellKey(cell) {
  const parts = [cell.component, cell.item, cell.instance];
  // **区切り文字を含む材料も鍵を作らない**——`("a|b","c","d")` と `("a","b|c","d")` は
  // どちらも `a|b|c|d` になり、別の操作の記録が別のセルの証拠として通る
  // （指紋も同じ潰れた鍵を数えるので一致してしまう）。
  if (!parts.every((p) => typeof p === "string" && p.trim() !== "" && !p.includes(KEY_SEPARATOR))) {
    return null;
  }
  return parts.map((p) => String(p)).join(KEY_SEPARATOR);
}

/**
 * 空でない文字列か。
 * @param {unknown} value
 * @returns {boolean}
 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/** 新側リポジトリがコミットを持たないことを表す語彙上のセンチネル（リポジトリ共通）。 */
const NO_COMMIT = "none";

/**
 * 整数として読む。読めなければ null（「記録が無い」と「0 回」を混ぜない）。
 * @param {unknown} value
 * @returns {number | null}
 */
function toInteger(value) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/**
 * 被覆表の `present` セルの鍵から指紋を作る。
 *
 * **指紋は突き合わせ表が「どの被覆表に対する記録か」を縛る**——被覆表が更新されて
 * `present` が増えたのに古い突き合わせ表が残ると、増えた分が数えられないまま通る。
 * @param {string[]} keys
 * @returns {string}
 */
export function fingerprintOf(keys) {
  return createHash("sha256")
    .update([...keys].sort().join("\n"))
    .digest("hex");
}

/**
 * 被覆表と突き合わせ表を突き合わせる。
 * @param {{ coverage: unknown, comparison: unknown, metadata?: unknown, replaceMetadata?: unknown, target?: string | null }} input
 * @returns {{ findings: {code:string, message:string}[], counts: Record<string, number>, structural: boolean, judged: boolean }}
 */
export function checkComponentComparison(input) {
  /** @type {{code:string, message:string}[]} */
  const findings = [];
  const counts = { present: 0, compared: 0, blocking: 0, accepted: 0 };
  const coverage = /** @type {Record<string, any>} */ (input.coverage);
  if (!coverage || typeof coverage !== "object" || !Array.isArray(coverage.cells)) {
    return {
      findings: [
        {
          code: "coverage-unreadable",
          message: "被覆表が読めない（cells を持つ JSON オブジェクトでない）。合格に倒さない",
        },
      ],
      counts,
      structural: true,
      judged: true,
    };
  }
  /** @type {string[]} */
  const presentKeys = [];
  /** @type {Set<string>} */
  const seenPresent = new Set();
  for (const raw of coverage.cells) {
    const cell = /** @type {Record<string, unknown>} */ (raw ?? {});
    if (cell.value !== "present") continue;
    const key = cellKey(cell);
    if (!key) {
      findings.push({
        code: "coverage-cell-unkeyed",
        message: `被覆表に component / item / instance の揃っていない、または区切り文字（${KEY_SEPARATOR}）を含む present セルがある（突き合わせの鍵を作れない）`,
      });
      continue;
    }
    // 鍵の重複は突き合わせ表側と同じく落とす——数え上げ（present / compared / blocking）が
    // 1 セルにつき 2 回進み、被覆の規模も未突合の件数も実際と違う数で報告される。
    if (seenPresent.has(key)) {
      findings.push({
        code: "coverage-cell-duplicated",
        message: `被覆表に ${key} の present セルが 2 つ以上ある（1 セルが 2 回数えられ、present / 未突合の件数が実際と合わなくなる）`,
      });
      continue;
    }
    seenPresent.add(key);
    presentKeys.push(key);
  }
  counts.present = presentKeys.length;

  const comparison = /** @type {Record<string, any>} */ (input.comparison);
  if (!comparison || typeof comparison !== "object" || !Array.isArray(comparison.cells)) {
    findings.push({
      code: "comparison-missing",
      message:
        "新側の突き合わせ表が無い（被覆表の present は移行元側の測定であり、新側の欠落を 1 件も示さない）",
    });
    return { findings, counts, structural: false, judged: true };
  }
  if (nonEmptyString(input.target) && comparison.target !== input.target) {
    findings.push({
      code: "comparison-target-mismatch",
      message: `突き合わせ表の target「${String(comparison.target)}」が判定対象の target「${String(input.target)}」と違う（別環境の記録で収束させない）`,
    });
  }
  // **突き合わせは新側の実装の版に紐づく**——target・slug・被覆表の指紋だけで縛ると、
  // 記録した後に新側を変えても古い証拠が通る。当たり判定・完了の退行はスイートの green に
  // 出ないので、この工程が唯一の網になる。
  const observed = comparison.new_implementation;
  const observedCommit =
    observed && typeof observed === "object"
      ? /** @type {Record<string, any>} */ (observed).commit
      : undefined;
  if (!nonEmptyString(observedCommit)) {
    findings.push({
      code: "comparison-implementation-unrecorded",
      message:
        "突き合わせ表に new_implementation.commit が無い（どの版の新側を操作した記録か決まらず、実装を変えても古い証拠が通る）",
    });
  }
  // **記録した版が「汚れていない」ことまで求める。** commit だけを鍵にすると、未コミットの変更を
  // 抱えた作業ツリーで操作した記録が同じ commit の記録として通り、鍵が版を指さなくなる。
  // 欠落・非真偽値は「調べていない」なので false 以外を落とす（fail-closed）。
  const observedDirty =
    observed && typeof observed === "object"
      ? /** @type {Record<string, any>} */ (observed).dirty
      : undefined;
  if (observedDirty !== false) {
    findings.push({
      code: "comparison-implementation-dirty",
      message: `突き合わせ表の new_implementation.dirty が false でない（${observedDirty === undefined ? "欠落" : JSON.stringify(observedDirty)}）。未コミットの変更を抱えた作業ツリーで操作した記録は、commit で版を特定できない`,
    });
  }
  // **`--replace-metadata` は省略を許さない。** 照合相手が無いと鮮度の検査そのものが飛び、
  // 「記録の後に実装が変わっていない」ことを一度も確かめないまま収束する
  // （`comparison-implementation-stale` は相手が渡されたときにしか効かない）。
  const replaceMetadata = /** @type {Record<string, any> | undefined} */ (input.replaceMetadata);
  const replaceNew =
    replaceMetadata &&
    typeof replaceMetadata === "object" &&
    !Array.isArray(replaceMetadata) &&
    replaceMetadata.new &&
    typeof replaceMetadata.new === "object" &&
    !Array.isArray(replaceMetadata.new)
      ? /** @type {Record<string, any>} */ (replaceMetadata.new)
      : null;
  if (!replaceNew) {
    findings.push({
      code: "replace-metadata-unusable",
      message:
        "replace-metadata.json を new オブジェクトを持つ形で読めない（現在の新側の版が分からず、突き合わせの鮮度を確かめられない。省略・型崩れを免除にしない）",
    });
  } else {
    if (!nonEmptyString(replaceNew.commit)) {
      findings.push({
        code: "replace-metadata-commit-missing",
        message:
          "replace-metadata.json の new.commit が無い（現在の新側の版が読めないので、突き合わせの鮮度を確かめられない）",
      });
    } else if (nonEmptyString(observedCommit)) {
      const wanted = String(replaceNew.commit).trim();
      const recorded = String(observedCommit).trim();
      if (wanted === NO_COMMIT || recorded === NO_COMMIT) {
        // **`none` センチネルを素の文字列として比べない**——新側が git 管理を持たないと両側とも
        // `none` になり、実装をいくら変えても `none !== none` は常に偽で、古い記録が鮮度検査を
        // 永久に素通りする。artifact-health-check.mjs の checkStage と同じく反復回数へ退く。
        // **退き先が無いことを合格に倒さない**——材料（どちらかの反復回数）が読めなければ落とす。
        // **片側だけが `none` なら、その時点で記録と現在は別の版**——記録した SHA と現在の `none`
        // （またはその逆）は同じ版を指さない。反復回数がたまたま一致しただけで合格に倒すと、
        // git 管理の有無が変わった新側で古い記録が無音で通る。反復回数の検査とは別に必ず落とす。
        if (recorded !== wanted) {
          findings.push({
            code: "comparison-implementation-stale",
            message: `突き合わせ表の new_implementation.commit「${recorded}」が現在の新側「${wanted}」と違う（片側だけが ${NO_COMMIT} なので、反復回数が一致しても同じ版を指さない。同じ版で取り直す）`,
          });
        }
        const recordedIteration = toInteger(
          observed && typeof observed === "object"
            ? /** @type {Record<string, any>} */ (observed).iteration
            : undefined,
        );
        const loop =
          replaceMetadata &&
          typeof replaceMetadata === "object" &&
          replaceMetadata.loop &&
          typeof replaceMetadata.loop === "object" &&
          !Array.isArray(replaceMetadata.loop)
            ? /** @type {Record<string, any>} */ (replaceMetadata.loop)
            : null;
        const wantedIteration = toInteger(loop === null ? undefined : loop.iterations);
        if (recordedIteration === null || wantedIteration === null) {
          findings.push({
            code: "comparison-implementation-unversionable",
            message: `new.commit が ${NO_COMMIT}（新側リポジトリのコミットを持たない）なのに反復回数で版を対応づけられない（突き合わせ表の new_implementation.iteration: ${recordedIteration === null ? "読めない" : recordedIteration} / replace-metadata.json の loop.iterations: ${wantedIteration === null ? "読めない" : wantedIteration}）。どちらの鮮度指標も無いと、実装を変えても古い記録が通る`,
          });
        } else if (recordedIteration !== wantedIteration) {
          findings.push({
            code: "comparison-implementation-stale",
            message: `突き合わせ表の new_implementation.iteration「${recordedIteration}」が現在の新側の反復回数「${wantedIteration}」と違う（new.commit が ${NO_COMMIT} なので反復回数で判定する。記録の後に実装が変わっている。同じ版で取り直す）`,
          });
        }
      } else if (recorded !== wanted) {
        findings.push({
          code: "comparison-implementation-stale",
          message: `突き合わせ表の new_implementation.commit「${recorded}」が現在の新側「${wanted}」と違う（記録の後に実装が変わっている。同じ版で取り直す）`,
        });
      }
    }
    if (replaceNew.dirty !== false) {
      findings.push({
        code: "replace-metadata-dirty",
        message: `replace-metadata.json の new.dirty が false でない（${replaceNew.dirty === undefined ? "欠落" : JSON.stringify(replaceNew.dirty)}）。未コミットの変更があると、突き合わせをどの版に紐づけたか決まらない`,
      });
    }
  }
  // **slug の照合は被覆表との間で常に行う**——`--metadata` は任意なので、metadata があるときだけ見ると、
  // 別機能から写した突き合わせ表が「target と鍵がたまたま一致する」だけで通る（指紋は鍵しか数えない）。
  if (!nonEmptyString(coverage.slug)) {
    // **被覆表に slug が無いことを免除にしない**——照合相手が消えるだけで、
    // 別機能から写した突き合わせ表が「鍵と target が一致する」だけで通る。
    findings.push({
      code: "coverage-slug-missing",
      message:
        "被覆表に slug が無い（どの機能の測定か決まらず、突き合わせ表との帰属を照合できない）",
    });
  } else if (comparison.slug !== coverage.slug) {
    findings.push({
      code: "comparison-slug-mismatch",
      message: `突き合わせ表の slug「${String(comparison.slug)}」が被覆表の slug「${String(coverage.slug)}」と違う（別機能の記録で収束させない）`,
    });
  }
  const metadata = /** @type {Record<string, any> | undefined} */ (input.metadata);
  if (metadata && typeof metadata === "object" && nonEmptyString(metadata.slug)) {
    if (comparison.slug !== metadata.slug) {
      findings.push({
        code: "comparison-slug-mismatch",
        message: `突き合わせ表の slug「${String(comparison.slug)}」が metadata.json の slug「${String(metadata.slug)}」と違う`,
      });
    }
  }
  const expectedFingerprint = fingerprintOf(presentKeys);
  const recorded = comparison.source_coverage && comparison.source_coverage.fingerprint;
  if (!nonEmptyString(recorded)) {
    findings.push({
      code: "coverage-fingerprint-missing",
      message:
        "突き合わせ表に source_coverage.fingerprint が無い（どの被覆表に対する記録か縛られず、present が増えても古い記録で通る）",
    });
  } else if (recorded !== expectedFingerprint) {
    findings.push({
      code: "coverage-fingerprint-mismatch",
      message: `source_coverage.fingerprint が被覆表の present セルと一致しない（記録後に被覆表が変わっている。期待 ${expectedFingerprint}）`,
    });
  }

  /** @type {Map<string, Record<string, unknown>>} */
  const rows = new Map();
  for (const raw of comparison.cells) {
    const row = /** @type {Record<string, unknown>} */ (raw ?? {});
    const key = cellKey(row);
    if (!key) {
      findings.push({
        code: "comparison-row-unkeyed",
        message: `突き合わせ表に component / item / instance の揃っていない、または区切り文字（${KEY_SEPARATOR}）を含む行がある`,
      });
      continue;
    }
    if (rows.has(key)) {
      findings.push({
        code: "comparison-row-duplicated",
        message: `突き合わせ表に ${key} の行が 2 つ以上ある（どちらが有効か決まらない）`,
      });
    }
    rows.set(key, row);
  }
  const presentSet = new Set(presentKeys);
  for (const key of rows.keys()) {
    if (!presentSet.has(key)) {
      findings.push({
        code: "comparison-row-unknown",
        message: `突き合わせ表の ${key} は被覆表の present セルに無い（測っていない操作の記録が混ざっている）`,
      });
    }
  }
  for (const key of presentKeys) {
    const row = rows.get(key);
    if (!row) {
      findings.push({
        code: "cell-not-compared",
        message: `${key} は移行元で present だが、新側で突き合わせた記録が無い（在席の記録は新側の欠落を示さない）`,
      });
      counts.blocking += 1;
      continue;
    }
    if (row.compared === true) {
      const evidence = /** @type {Record<string, unknown>} */ (row.evidence ?? {});
      const missing = EVIDENCE_AXES.filter((axis) => !nonEmptyString(evidence[axis]));
      if (missing.length > 0) {
        findings.push({
          code: "evidence-axis-missing",
          message: `${key} の突き合わせに ${missing.join(" / ")} の観測が無い（入口・当たり判定・完了のどれかで止まる欠落はケースの文面に出てこない）`,
        });
        counts.blocking += 1;
        continue;
      }
      counts.compared += 1;
      continue;
    }
    if (row.compared !== false) {
      findings.push({
        code: "compared-not-boolean",
        message: `${key} の compared が真偽値でない（未突合と突き合わせ済みを書き分けられない）`,
      });
      counts.blocking += 1;
      continue;
    }
    if (!nonEmptyString(row.not_compared_reason)) {
      findings.push({
        code: "not-compared-reason-missing",
        message: `${key} は compared: false なのに理由が無い（何が突き合わせを止めているか残らない）`,
      });
      counts.blocking += 1;
      continue;
    }
    const disposition = row.disposition;
    if (disposition === "accepted") {
      if (!nonEmptyString(row.approved_by) || !nonEmptyString(row.approved_at)) {
        findings.push({
          code: "acceptance-unapproved",
          message: `${key} の accepted に approved_by / approved_at が無い（承認の無い accepted は blocking として数える）`,
        });
        counts.blocking += 1;
        continue;
      }
      counts.accepted += 1;
      continue;
    }
    if (
      disposition !== undefined &&
      disposition !== null &&
      !DISPOSITIONS.includes(String(disposition))
    ) {
      findings.push({
        code: "disposition-vocabulary",
        message: `${key} の disposition「${String(disposition)}」は語彙外（${DISPOSITIONS.join(" / ")}）`,
      });
    }
    findings.push({
      code: "cell-comparison-blocking",
      message: `${key} は新側で突き合わせていない（理由: ${String(row.not_compared_reason)}）`,
    });
    counts.blocking += 1;
  }

  return { findings, counts, structural: false, judged: true };
}

/**
 * CLI 本体。
 * @param {string[]} argv
 * @param {{ readFile?: (path: string) => string, cwd?: string, write?: (s: string) => void, writeErr?: (s: string) => void }} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const readFile = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
  const cwd = deps.cwd ?? process.cwd();
  const write = deps.write ?? ((s) => process.stdout.write(s));
  const writeErr = deps.writeErr ?? ((s) => process.stderr.write(s));
  const usage =
    "usage: component-comparison-check.mjs --coverage <component-coverage.json> --comparison <new/<target>/component-comparison.json> --target <name> --replace-metadata <new/<target>/replace-metadata.json> [--metadata <metadata.json>]";
  /**
   * 引数・入力の誤りを stderr へ知らせる（判定結果ではないので stdout の JSON には混ぜない）。
   * @param {string} message
   * @returns {number}
   */
  const fail = (message) => {
    writeErr(`error: ${message}\n${usage}\n`);
    return 2;
  };
  const out = (obj) =>
    write(
      `${JSON.stringify({ tool: "component-comparison-check", version: VERSION, ...obj }, null, 2)}\n`,
    );
  /** @type {Record<string, string>} */
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) {
      return fail(`不明な引数: ${key}`);
    }
    const value = argv[i + 1];
    if (typeof value !== "string" || value.startsWith("--")) {
      return fail(`${key} に値がない`);
    }
    if (args[key] !== undefined) {
      return fail(`${key} が複数ある`);
    }
    args[key] = value;
    i += 1;
  }
  const known = ["--coverage", "--comparison", "--metadata", "--replace-metadata", "--target"];
  const unknown = Object.keys(args).filter((k) => !known.includes(k));
  if (unknown.length > 0) {
    return fail(`不明な引数: ${unknown.join(", ")}`);
  }
  if (!args["--coverage"]) {
    return fail("--coverage は必須");
  }
  // **鮮度の照合相手を省けるようにしない**——省くと `comparison-implementation-stale` が
  // 一度も評価されず、記録の後に新側を変えても古い証拠で収束する。
  if (!args["--replace-metadata"] || args["--replace-metadata"].trim() === "") {
    return fail(
      "--replace-metadata は必須（空白だけの値も不可。現在の新側の版と突き合わせないと、記録の鮮度を確かめられない）",
    );
  }
  // `--target` を省ける形にすると、別環境で採った突き合わせ表がそのまま通る
  // （`comparison-target-mismatch` は照合相手が渡されたときにしか効かない）。
  // 突き合わせは環境別の記録なので、判定対象の target を必ず受け取る。
  // **空白だけの値を通さない**——CLI の truthy 判定は通るのに、判定側は非空文字列でないと
  // 「渡されていない」として target 照合を飛ばすため、別環境の記録が通る。
  if (!args["--target"] || args["--target"].trim() === "") {
    return fail(
      "--target は必須（空白だけの値も不可。突き合わせ表は環境別の記録なので、別 target の記録を通さない）",
    );
  }
  /** @type {Record<string, unknown>} */
  const parsed = {};
  for (const key of ["--coverage", "--comparison", "--metadata", "--replace-metadata"]) {
    const path = args[key];
    if (!path) continue;
    try {
      parsed[key] = JSON.parse(readFile(resolve(cwd, path)));
    } catch (error) {
      if (key === "--comparison") {
        // 突き合わせ表が無い・壊れているのは「まだ突き合わせていない」ことと区別できないので、
        // 合格にも型崩れにも倒さず未突合として数える（判定は checkComponentComparison が行う）。
        parsed[key] = null;
        continue;
      }
      return fail(`${path} を読めない: ${error && error.message}`);
    }
  }
  const result = checkComponentComparison({
    coverage: parsed["--coverage"],
    comparison: parsed["--comparison"] ?? null,
    metadata: parsed["--metadata"],
    replaceMetadata: parsed["--replace-metadata"],
    target: args["--target"] ?? null,
  });
  if (result.structural) {
    out({ ok: false, structural: true, findings: result.findings, counts: result.counts });
    return 2;
  }
  out({
    ok: result.findings.length === 0,
    judged: result.judged,
    findings: result.findings,
    counts: { ...result.counts, findings: result.findings.length },
  });
  return result.findings.length === 0 ? 0 : 1;
}

// CLI エントリ判定は両辺を実パスに解決してから突き合わせる（シンボリックリンク経由の起動でサイレント no-op にしない）。
const invokedAsCli = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return entry === self;
  }
})();

if (invokedAsCli) {
  // process.exit は書き込み中の stdout を捨てるため、終了コードだけ設定して自然終了させる。
  process.exitCode = main(process.argv.slice(2));
}
