// 寸法の決まり方（窓の寸法に対する位置・寸法の式）を当てはめ・照合する（原本）。
// 原本は parity-suite にあり、スキルディレクトリ内から直接実行する（プロジェクトへコピーしない）。
// parity-replace は完了判定でインストール済みの parity-suite から同じスクリプトを check で呼ぶ。
//
// なぜ要るか: 撮影条件が 1 ビューポートだと、画素・特性照合・aria の 3 つの比較方法はその 1 点でしか比べない。
// 移行元が「割合 × 親要素の寸法 ＋ 定数」で決まっていても、測った px を並べた新側は 3 つの比較方法すべてで緑になり、
// 別の窓で数十 px ずれる。窓を変えて同じ要素を読み、式を記録して新側に当てれば、この形を落とせる。
//
// 何をするか:
//   fit   現側で窓を 4 つ以上変えて読んだ矩形（samples）から、要素 × 軸（x / y / width / height）ごとに式を当てはめる。
//         式は `値 = ratio.width × 窓の幅 ＋ ratio.height × 窓の高さ ＋ offset` で、最小二乗で当てはめる。
//         残差（最大絶対誤差）が許容内なら fits に記録する。超える・一部の窓で表示されないなら unfit（式が読めない）に記録する。
//         --write で metadata.json の capture_conditions.dimension_model へ書く（手で転記させない）。
//   check 新側で同じ窓（measured_at）に読んだ矩形を、現側の fits の式による予測値と突き合わせる。
//         --write <replace-metadata.json> で結果を dimension_check として書く。
//         exit 2 も error として書き、前回の合格を残さない。
//
// 基準の寸法を窓の寸法に固定する理由: 親要素（グリッド・パネル）自身が窓に対して線形なら、親要素に対して線形な要素も
// 窓に対して線形になる（合成しても線形）。窓の幅と高さを独立に動かして 2 変数で当てれば、どの親要素を基準にするかを選ぶ判断が要らない。
// ブレークポイント（メディアクエリ）や min / max の頭打ちをまたぐと線形にならず、unfit になる。これは正しい振る舞いである。
//
// 次の入力は合格として扱わない（exit 2）。窓 4 未満・窓が一直線上に並ぶ（幅と高さを独立に動かしていない）・
// 宣言したビューポートを含まない・窓の欠け／重複・要素キーの欠落／重複・型の誤り。
// 判定しない場合（judged: false）は、dimension_model の欠落と status: not_measured / not_required だけに限り、理由を出力に残す。
//
// 決定論的: 乱数・現在時刻に依存しない。TypeScript 構文は使わない（型は JSDoc）。

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { isArray } from "./lib/is-array.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import { fileIo } from "./lib/file-io.mjs";
import { errorMessage } from "./lib/errors.mjs";
import { parseFlags } from "./lib/flags.mjs";
import { isFiniteNumber, isPlainObject, nonEmptyString } from "./lib/guards.mjs";

/**
 * ツールのバージョン（原本）。当てはめ・判定ロジック・出力形状を変えたら上げる。
 * dimension_model.tool_version と一致しない記録は check で落ちる（現側を採り直す）。
 * @type {string}
 */
export const VERSION = "1";

/** 当てはめる軸。getBoundingClientRect() の 4 値（x / y はページ座標）。 */
export const PROPERTIES = ["x", "y", "width", "height"];

/** 既定の許容残差（px）。サブピクセルの丸めを飲み、数 px のずれは飲まない。 */
export const DEFAULT_TOLERANCE = 0.5;

/** 当てはめに要る窓の最小数（3 係数に対して自由度 1 以上を残す。3 窓だと常に残差 0 で証拠にならない）。 */
export const MIN_WINDOWS = 4;

const STATUSES = ["measured", "not_measured", "not_required"];

/** check が許容に上乗せする丸め分（px）。fit が残す係数の桁から決まる上限。 */
const ROUNDING_SLACK = 1e-6;

class UsageError extends Error {}

/**
 * x / y / width / height がすべて有限数の矩形か。読むのは PROPERTIES の軸だけなので、値は数として扱う。
 * @param {unknown} v
 * @returns {v is Record<string, number> & { readonly __isFiniteRect: true }}
 */
function isFiniteRect(v) {
  return isPlainObject(v) && PROPERTIES.every((p) => isFiniteNumber(v[p]));
}

/**
 * dimension_model.fits の 1 件。
 * @typedef {{ page: string, element: string, property: string, ratio: { width: number, height: number }, offset: number }} FitRecord
 */

/**
 * fits の 1 件の形か。
 * @param {unknown} f
 * @returns {f is FitRecord & { readonly __isFitRecord: true }}
 */
function isFitRecord(f) {
  return (
    isPlainObject(f) &&
    nonEmptyString(f.page) &&
    nonEmptyString(f.element) &&
    typeof f.property === "string" &&
    PROPERTIES.includes(f.property) &&
    isPlainObject(f.ratio) &&
    isFiniteNumber(f.ratio.width) &&
    isFiniteNumber(f.ratio.height) &&
    isFiniteNumber(f.offset)
  );
}

/**
 * check の照合で外れた 1 件。
 * @typedef {{ page: string, element: string, property: string, window: { width: number, height: number } | null, reason: string, expected?: number, actual?: number, deviation?: number }} CheckFailure
 */

/**
 * check が判定を飛ばした軸（unfit）。
 * @typedef {{ page: string, element: string, property: string, reason: string }} UnfitNote
 */

/**
 * @param {number} v
 * @param {number} digits
 * @returns {number}
 */
function round(v, digits) {
  const f = 10 ** digits;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * @param {{ width: number, height: number }} w
 * @returns {string}
 */
function windowKey(w) {
  return `${w.width}x${w.height}`;
}

/**
 * 窓 1 つを検証する（キーを作る前に型を確かめる。"1366" のような文字列を、実在の窓のキーとして扱わない）。
 * @param {unknown} w
 * @param {string} at
 * @returns {{ width: number, height: number }}
 */
function validateWindow(w, at) {
  if (
    !isPlainObject(w) ||
    typeof w.width !== "number" ||
    typeof w.height !== "number" ||
    !Number.isInteger(w.width) ||
    !Number.isInteger(w.height) ||
    w.width <= 0 ||
    w.height <= 0
  ) {
    throw new UsageError(`${at} の width / height が正の整数でない`);
  }
  return { width: w.width, height: w.height };
}

/**
 * 窓の一覧を検証する（正の整数・重複なし・4 以上・一直線上に並ばない）。
 * @param {unknown} windows
 * @param {string} label
 * @returns {{ width: number, height: number }[]}
 */
export function validateWindows(windows, label) {
  if (!isArray(windows)) throw new UsageError(`${label} が配列でない`);
  const seen = new Set();
  const out = windows.map((raw, i) => {
    const w = validateWindow(raw, `${label}[${i}]`);
    const key = windowKey(w);
    if (seen.has(key)) throw new UsageError(`${label} に窓 ${key} が重複している`);
    seen.add(key);
    return w;
  });
  if (out.length < MIN_WINDOWS) {
    throw new UsageError(
      `${label} が ${out.length} 窓しかない（${MIN_WINDOWS} 窓以上。3 窓では 3 係数が常に残差 0 で当てはまり証拠にならない）`,
    );
  }
  const [p0] = out;
  const p1 = out.find((p) => p.width !== p0.width || p.height !== p0.height);
  const independent =
    p1 !== undefined &&
    out.some(
      (p) =>
        (p1.width - p0.width) * (p.height - p0.height) -
          (p1.height - p0.height) * (p.width - p0.width) !==
        0,
    );
  if (!independent) {
    throw new UsageError(
      `${label} の窓が一直線上に並んでいる（縦横比が一定など）。幅と高さを独立に動かした窓を含める。含めないと、幅と高さのどちらに追従しているかを分けられない`,
    );
  }
  return out;
}

/**
 * 値 = a × W ＋ b × H ＋ c を最小二乗で当てはめる。
 * @param {{ W: number, H: number, v: number }[]} points
 * @returns {{ ratio: { width: number, height: number }, offset: number, residual: number }}
 */
export function fitPlane(points) {
  const n = points.length;
  const mW = points.reduce((s, p) => s + p.W, 0) / n;
  const mH = points.reduce((s, p) => s + p.H, 0) / n;
  const mv = points.reduce((s, p) => s + p.v, 0) / n;
  let sWW = 0;
  let sHH = 0;
  let sWH = 0;
  let sWv = 0;
  let sHv = 0;
  for (const p of points) {
    const dW = p.W - mW;
    const dH = p.H - mH;
    const dv = p.v - mv;
    sWW += dW * dW;
    sHH += dH * dH;
    sWH += dW * dH;
    sWv += dW * dv;
    sHv += dH * dv;
  }
  const det = sWW * sHH - sWH * sWH;
  // validateWindows が一直線上の配置を落とすので det は正。念のため潰れた系は例外にする（0 除算を値へ流さない）
  if (!(det > 0)) throw new UsageError("窓の配置から係数を一意に決められない");
  const a = (sWv * sHH - sHv * sWH) / det;
  const b = (sHv * sWW - sWv * sWH) / det;
  const c = mv - a * mW - b * mH;
  const residual = Math.max(...points.map((p) => Math.abs(p.v - (a * p.W + b * p.H + c))));
  return { ratio: { width: a, height: b }, offset: c, residual };
}

/**
 * 要素ごとの矩形を窓に対応付ける（窓の欠け・重複・未宣言の窓を落とす）。
 * @param {unknown} elements
 * @param {{ width: number, height: number }[]} windows
 * @param {string} label
 * @returns {Map<string, { page: string, element: string, rects: Map<string, Record<string, number> | null> }>}
 */
function indexElements(elements, windows, label) {
  if (!isArray(elements)) throw new UsageError(`${label}.elements が配列でない`);
  const windowKeys = new Set(windows.map(windowKey));
  /** @type {Map<string, { page: string, element: string, rects: Map<string, Record<string, number> | null> }>} */
  const index = new Map();
  elements.forEach((e, i) => {
    const at = `${label}.elements[${i}]`;
    // キーの材料を先に弾く（欠落を "undefined" という有効なキーとして扱わない）
    if (!isPlainObject(e) || !nonEmptyString(e.page) || !nonEmptyString(e.element)) {
      throw new UsageError(`${at} の page / element が空でない文字列でない`);
    }
    const key = JSON.stringify([e.page, e.element]);
    if (index.has(key)) {
      throw new UsageError(`${at} の (page, element) = (${e.page}, ${e.element}) が重複している`);
    }
    if (!isArray(e.rects)) throw new UsageError(`${at}.rects が配列でない`);
    /** @type {Map<string, Record<string, number> | null>} */
    const rects = new Map();
    e.rects.forEach((r, j) => {
      if (!isPlainObject(r) || !isPlainObject(r.window)) {
        throw new UsageError(`${at}.rects[${j}].window が無い`);
      }
      const wk = windowKey(validateWindow(r.window, `${at}.rects[${j}].window`));
      if (!windowKeys.has(wk))
        throw new UsageError(`${at}.rects[${j}] の窓 ${wk} が windows に無い`);
      if (rects.has(wk)) throw new UsageError(`${at}.rects に窓 ${wk} が重複している`);
      const rect = r.rect;
      if (rect === null) {
        rects.set(wk, null);
        return;
      }
      if (!isFiniteRect(rect)) {
        throw new UsageError(
          `${at}.rects[${j}].rect が x / y / width / height の有限数を持たない（表示されない窓は null と書く）`,
        );
      }
      rects.set(wk, rect);
    });
    const missing = windows.filter((w) => !rects.has(windowKey(w))).map(windowKey);
    if (missing.length > 0) {
      throw new UsageError(
        `${at} に窓 ${missing.join(", ")} の矩形が無い（表示されないなら null と書く）`,
      );
    }
    index.set(key, { page: e.page, element: e.element, rects });
  });
  if (index.size === 0) throw new UsageError(`${label}.elements が 0 件（測った要素が無い）`);
  return index;
}

/**
 * @param {unknown} text
 * @returns {string}
 */
function fingerprint(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

/**
 * fit が fits に書く 1 件（当てはめた式と残差）。
 * @typedef {FitRecord & { residual: number }} FittedRecord
 */

/**
 * fit が unfit に書く 1 件（式が読めない軸）。表示されない窓があるときは residual を null にする。
 * @typedef {{ page: string, element: string, property: string, residual: number | null, reason: string }} UnfitRecord
 */

/**
 * 1 つの軸について、窓ごとの (窓の幅, 窓の高さ, 値) を並べる。
 * @param {Map<string, Record<string, number> | null>} rects
 * @param {{ width: number, height: number }[]} windows
 * @param {string} property
 * @returns {{ W: number, H: number, v: number }[]}
 */
function planePoints(rects, windows, property) {
  return windows.map((w) => {
    const rect = rects.get(windowKey(w));
    // 呼び出し側が表示されない窓の無いことを確かめている（indexElements が全窓の矩形を求める）。
    // 矩形が無いときは、入力の誤りではなくこのスクリプトの不具合なので TypeError にする
    if (!rect) throw new TypeError(`窓 ${windowKey(w)} の矩形が無い`);
    return { W: w.width, H: w.height, v: rect[property] };
  });
}

/**
 * 要素 1 つの 4 軸に式を当てはめ、残差が許容内なら fits へ、そうでなければ unfit へ足す。
 * @param {{ page: string, element: string, rects: Map<string, Record<string, number> | null> }} entry
 * @param {{ width: number, height: number }[]} windows
 * @param {{ tolerance: number, fits: FittedRecord[], unfit: UnfitRecord[] }} acc
 */
function fitElement({ page, element, rects }, windows, acc) {
  // 全窓で見えない要素は「式が読めない」ではなく採取の失敗（認証切れ・別ルート・ロケータ不解決）として落とす
  // （unfit に流すと照合 0 件のモデルが measured を名乗り、check が ok: true を返す）
  if (windows.every((w) => rects.get(windowKey(w)) === null)) {
    throw new UsageError(
      `samples の (${page}, ${element}) が全ての窓で表示されていない（採取の失敗を疑う。ページ・認証・ロケータを確かめて採り直す）`,
    );
  }
  // 見えない窓は軸に依らないので、1 回だけ求める。
  const hidden = windows.filter((w) => rects.get(windowKey(w)) === null).map(windowKey);
  for (const property of PROPERTIES) {
    if (hidden.length > 0) {
      acc.unfit.push({
        page,
        element,
        property,
        residual: null,
        reason: `hidden_in_windows: ${hidden.join(", ")}`,
      });
      continue;
    }
    const f = fitPlane(planePoints(rects, windows, property));
    const residual = round(f.residual, 4);
    if (f.residual > acc.tolerance) {
      acc.unfit.push({ page, element, property, residual, reason: "residual_exceeds_tolerance" });
    } else {
      acc.fits.push({
        page,
        element,
        property,
        // 係数の丸め誤差（× 窓の寸法）が check の偏差に乗るので、残差が許容ぎりぎりの軸で
        // 現側と同一の新側を落とさないよう、係数は窓の寸法を掛けても 1e-6 px 未満に収まる桁で残す
        ratio: { width: round(f.ratio.width, 10), height: round(f.ratio.height, 10) },
        offset: round(f.offset, 8),
        residual,
      });
    }
  }
}

/**
 * 現側の samples から dimension_model を作る。
 * @param {unknown} samples
 * @param {{ viewports: { width: number, height: number }[], targets: { traitElements: string[], pages: string[] }, tolerance: number, samplesText: string }} opts
 */
export function fitModel(samples, opts) {
  if (!isPlainObject(samples)) throw new UsageError("samples が JSON オブジェクトでない");
  const windows = validateWindows(samples.windows, "samples.windows");
  const keys = new Set(windows.map(windowKey));
  if (!opts.viewports.some((v) => keys.has(windowKey(v)))) {
    throw new UsageError(
      `samples.windows が capture_conditions.viewports のどれも含まない（${opts.viewports.map(windowKey).join(", ")}）。撮影したビューポートを測る窓に入れる`,
    );
  }
  const index = indexElements(samples.elements, windows, "samples");
  // 測る対象を自分で選ばせない: 撮影ページは全て、特性を採った論理名は全てどこかのページで窓を変えて読んでいること
  assertCoverage([...index.values()], opts.targets, "samples");
  /** @type {{ tolerance: number, fits: FittedRecord[], unfit: UnfitRecord[] }} */
  const acc = { tolerance: opts.tolerance, fits: [], unfit: [] };
  for (const entry of index.values()) fitElement(entry, windows, acc);
  return {
    status: "measured",
    tool: "dimension-fit",
    tool_version: VERSION,
    tolerance: opts.tolerance,
    measured_at: windows,
    samples_fingerprint: fingerprint(opts.samplesText),
    fits: acc.fits,
    unfit: acc.unfit,
    reason: null,
  };
}

/**
 * capture_conditions.viewports を読む（fit / check 共通）。
 * @param {unknown} metadata
 * @returns {{ width: number, height: number }[]}
 */
function readViewports(metadata) {
  const cc = isPlainObject(metadata) ? metadata.capture_conditions : undefined;
  if (!isPlainObject(cc) || !isArray(cc.viewports) || cc.viewports.length === 0) {
    throw new UsageError("metadata.json の capture_conditions.viewports が空でない配列でない");
  }
  const seen = new Set();
  return cc.viewports.map((raw, i) => {
    const v = validateWindow(raw, `capture_conditions.viewports[${i}]`);
    // 同じ寸法を 2 つ並べて「ビューポート 2 つ以上」の免除（not_required）を通させない
    if (seen.has(windowKey(v))) {
      throw new UsageError(`capture_conditions.viewports に ${windowKey(v)} が重複している`);
    }
    seen.add(windowKey(v));
    return v;
  });
}

/**
 * 特性を採った論理名と撮影ページ（fit / check 共通）。測る対象を自分で選ばせないための基準集合。
 * @param {unknown} metadata
 * @returns {{ traitElements: string[], pages: string[] }}
 */
function readTargets(metadata) {
  const traits = isPlainObject(metadata) ? metadata.traits : undefined;
  if (
    !isPlainObject(traits) ||
    !isArray(traits.elements) ||
    traits.elements.length === 0 ||
    !traits.elements.every(nonEmptyString)
  ) {
    throw new UsageError(
      "metadata.json の traits.elements が空でない文字列の配列でない（特性を採る論理名を確定してから通す）",
    );
  }
  // capture_conditions が JSON オブジェクトであることは、先に呼ぶ readViewports が確かめている
  const cc = isPlainObject(metadata) ? metadata.capture_conditions : undefined;
  // オブジェクトでない要素は name を undefined にして、空でない文字列の判定で落とす
  const pageNames =
    isPlainObject(cc) && isArray(cc.pages)
      ? cc.pages.map((p) => (isPlainObject(p) ? p.name : undefined))
      : [];
  if (pageNames.length === 0 || !pageNames.every(nonEmptyString)) {
    throw new UsageError("metadata.json の capture_conditions.pages[].name が空でない配列でない");
  }
  // 同じ論理名の重複を 1 つの集合要素へ潰さない（上書きされた論理名の分だけ測る対象が警告なしに減る）
  const elementNames = traits.elements;
  const duplicatedElements = elementNames.filter((n, i) => elementNames.indexOf(n) !== i);
  if (duplicatedElements.length > 0) {
    throw new UsageError(
      `traits.elements が重複している: ${[...new Set(duplicatedElements)].join(", ")}`,
    );
  }
  // 同名のページを 1 つの集合キーへ潰さない（1 つ目のページを測っただけで、2 つ目を測り忘れても通る）
  const duplicated = pageNames.filter((n, i) => pageNames.indexOf(n) !== i);
  if (duplicated.length > 0) {
    throw new UsageError(
      `capture_conditions.pages[].name が重複している: ${[...new Set(duplicated)].join(", ")}`,
    );
  }
  return {
    traitElements: elementNames,
    pages: pageNames,
  };
}

/**
 * 記録（samples または fits ∪ unfit）が基準集合を覆っているか。page 単位で見る（ある page で測った論理名で別の page の欠けを埋めない）。
 * @param {{ page: string, element: string }[]} entries
 * @param {{ traitElements: string[], pages: string[] }} targets
 * @param {string} label
 */
function assertCoverage(entries, targets, label) {
  const declared = new Set(targets.pages);
  const strayPages = [...new Set(entries.map((e) => e.page))].filter((p) => !declared.has(p));
  if (strayPages.length > 0) {
    throw new UsageError(
      `${label} に capture_conditions.pages に無いページ: ${strayPages.join(", ")}`,
    );
  }
  const pages = new Set(entries.map((e) => e.page));
  const missingPages = targets.pages.filter((p) => !pages.has(p));
  if (missingPages.length > 0) {
    throw new UsageError(
      `${label} に測っていないページ: ${missingPages.join(", ")}（ページごとに窓を変えて読む）`,
    );
  }
  const elements = new Set(entries.map((e) => e.element));
  const missingElements = targets.traitElements.filter((name) => !elements.has(name));
  if (missingElements.length > 0) {
    throw new UsageError(
      `${label} に無い traits.elements の論理名: ${missingElements.join(", ")}（そのページで窓を変えて読む）`,
    );
  }
}

/**
 * capture_conditions.dimension_model を読み、status が既知の値かを確かめる。
 * @param {unknown} metadata - 現側 metadata.json
 * @returns {{ dm: Record<string, unknown>, status: string }}
 */
function readDimensionModel(metadata) {
  // readViewports が capture_conditions を JSON オブジェクトだと確かめているので、この分岐には到達しない
  const cc = isPlainObject(metadata) ? metadata.capture_conditions : undefined;
  if (!isPlainObject(cc)) {
    throw new UsageError("metadata.json の capture_conditions.viewports が空でない配列でない");
  }
  // キーの欠落は免除にしない（判定しない場合は、理由付きの not_measured / not_required だけに限る）
  if (!Object.hasOwn(cc, "dimension_model")) {
    throw new UsageError(
      "capture_conditions.dimension_model が無い。parity-suite で fit を通すか、測れないなら status: not_measured と reason を書く（キーを省略したまま判定を免除しない）",
    );
  }
  const dm = cc.dimension_model;
  if (!isPlainObject(dm) || typeof dm.status !== "string" || !STATUSES.includes(dm.status)) {
    throw new UsageError(`dimension_model.status が ${STATUSES.join(" / ")} のいずれでもない`);
  }
  return { dm, status: dm.status };
}

/**
 * 判定しない場合（not_measured / not_required）の結果を作る。閉じた集合に限り、理由を必須にする。
 * @param {Record<string, unknown>} dm
 * @param {string} status - measured 以外の status
 * @param {number} viewportCount - capture_conditions.viewports の数
 * @returns {{ judged: false, reason: string }}
 */
function unjudgedResult(dm, status, viewportCount) {
  if (!nonEmptyString(dm.reason)) {
    throw new UsageError(`dimension_model.status: ${status} に reason が無い`);
  }
  if (status === "not_required" && viewportCount < 2) {
    throw new UsageError(
      "ビューポートが 1 つの撮影で dimension_model.status: not_required は使えない（1 点の px を並べたレイアウトが 3 つの比較方法で緑になる）",
    );
  }
  return { judged: false, reason: `dimension_model.status: ${status}（${dm.reason}）` };
}

/**
 * measured の dimension_model から、ツールのバージョン・許容・測定窓を読む。
 * @param {Record<string, unknown>} dm
 * @param {{ width: number, height: number }[]} viewports
 * @returns {{ tolerance: number, windows: { width: number, height: number }[] }}
 */
function readMeasuredWindows(dm, viewports) {
  if (dm.tool_version !== VERSION) {
    throw new UsageError(
      `dimension_model.tool_version が ${String(dm.tool_version)}（ツールは ${VERSION}）。parity-suite で現側を採り直す`,
    );
  }
  if (!isFiniteNumber(dm.tolerance) || dm.tolerance < 0) {
    throw new UsageError("dimension_model.tolerance が 0 以上の数でない");
  }
  const windows = validateWindows(dm.measured_at, "dimension_model.measured_at");
  const measuredKeys = new Set(windows.map(windowKey));
  if (!viewports.some((v) => measuredKeys.has(windowKey(v)))) {
    throw new UsageError(
      "dimension_model.measured_at が capture_conditions.viewports のどれも含まない（撮影したビューポートで照合されない）。parity-suite で採り直す",
    );
  }
  return { tolerance: dm.tolerance, windows };
}

/**
 * dimension_model.fits を読む（形と重複を確かめる）。
 * @param {unknown[]} list
 * @returns {{ fits: FitRecord[], seen: Set<string> }}
 */
function readFitRecords(list) {
  const seen = new Set();
  const fits = list.map((f, i) => {
    if (!isFitRecord(f)) {
      throw new UsageError(`dimension_model.fits[${i}] の形が不正`);
    }
    const key = JSON.stringify([f.page, f.element, f.property]);
    if (seen.has(key)) throw new UsageError(`dimension_model.fits[${i}] が重複している`);
    seen.add(key);
    return f;
  });
  return { fits, seen };
}

/**
 * dimension_model.unfit を読む。fits と同じくキーの材料を検証する（不正な記録を、中身の無い note として扱わない）。
 * @param {unknown[]} list
 * @param {Set<string>} seenFit - fits に在る (page, element, property) のキー
 * @returns {UnfitNote[]}
 */
function readUnfitNotes(list, seenFit) {
  const seenUnfit = new Set();
  return list.map((u, i) => {
    if (
      !isPlainObject(u) ||
      !nonEmptyString(u.page) ||
      !nonEmptyString(u.element) ||
      typeof u.property !== "string" ||
      !PROPERTIES.includes(u.property) ||
      !nonEmptyString(u.reason)
    ) {
      throw new UsageError(`dimension_model.unfit[${i}] の形が不正`);
    }
    const key = JSON.stringify([u.page, u.element, u.property]);
    if (seenUnfit.has(key)) throw new UsageError(`dimension_model.unfit[${i}] が重複している`);
    if (seenFit.has(key)) {
      throw new UsageError(
        `dimension_model.unfit[${i}] が fits にも在る（式が読めたか読めないかが矛盾）`,
      );
    }
    seenUnfit.add(key);
    return { page: u.page, element: u.element, property: u.property, reason: u.reason };
  });
}

/**
 * 記録された (page, element) が 4 軸すべてを fits か unfit のどちらかに持つかを確かめ、(page, element) の一覧を返す。
 * 軸を消した記録で、消した軸の照合を警告なしに飛ばさない。
 * @param {{ page: string, element: string, property: string }[]} records
 * @returns {{ page: string, element: string }[]}
 */
function assertAllAxesRecorded(records) {
  /** @type {Map<string, { page: string, element: string, properties: Set<string> }>} */
  const byElement = new Map();
  for (const e of records) {
    const key = JSON.stringify([e.page, e.element]);
    const entry = byElement.get(key) ?? { page: e.page, element: e.element, properties: new Set() };
    entry.properties.add(e.property);
    byElement.set(key, entry);
  }
  for (const e of byElement.values()) {
    const lacking = PROPERTIES.filter((p) => !e.properties.has(p));
    if (lacking.length > 0) {
      throw new UsageError(
        `dimension_model の (${e.page}, ${e.element}) に軸 ${lacking.join(", ")} が fits にも unfit にも無い（記録が欠けている。parity-suite で fit を通し直す）`,
      );
    }
  }
  return [...byElement.values()];
}

/**
 * dimension_model の fits / unfit を読み、基準集合を覆っているかを確かめる。
 * @param {Record<string, unknown>} dm
 * @param {{ traitElements: string[], pages: string[] }} targets
 * @returns {{ fits: FitRecord[], unfit: UnfitNote[] }}
 */
function readModelRecords(dm, targets) {
  if (!isArray(dm.fits) || !isArray(dm.unfit)) {
    throw new UsageError("dimension_model.fits / unfit が配列でない");
  }
  if (dm.fits.length + dm.unfit.length === 0) {
    throw new UsageError("dimension_model.fits と unfit がどちらも空（測った要素が無い）");
  }
  const { fits, seen } = readFitRecords(dm.fits);
  const unfit = readUnfitNotes(dm.unfit, seen);
  assertCoverage(assertAllAxesRecorded([...fits, ...unfit]), targets, "dimension_model");
  return { fits, unfit };
}

/**
 * 記録された式が今の現側 samples から当てたものかを確かめる（採り直して fit を通していない古い式や、
 * fit の後に手で書き換えた式で照合しない）。
 * @param {Record<string, unknown>} dm
 * @param {{ viewports: { width: number, height: number }[], targets: { traitElements: string[], pages: string[] }, tolerance: number, loadCurrentSamplesText: (() => string) | undefined }} ctx
 */
function assertModelDerived(dm, ctx) {
  if (
    typeof dm.samples_fingerprint !== "string" ||
    !/^[0-9a-f]{64}$/.test(dm.samples_fingerprint)
  ) {
    throw new UsageError(
      "dimension_model.samples_fingerprint が sha256 の 16 進 64 桁でない。parity-suite で fit を通し直す",
    );
  }
  if (ctx.loadCurrentSamplesText === undefined) {
    throw new UsageError("式の出所を照合するための現側 samples が渡されていない");
  }
  const currentSamplesText = ctx.loadCurrentSamplesText();
  if (fingerprint(currentSamplesText) !== dm.samples_fingerprint) {
    throw new UsageError(
      "現側 dimension-samples.json が dimension_model.samples_fingerprint と一致しない（採り直した samples に fit を通していない）。parity-suite で fit --write を通し直す",
    );
  }
  // 指紋は samples が変わっていないことしか示さない。記録された式そのものが samples から導かれたものかを、
  // 同じ samples・同じ許容で当てはめ直して突き合わせる（fit の後に係数を手で書き換えたモデルで照合しない）
  /** @type {ReturnType<typeof fitModel>} */
  let recomputed;
  try {
    recomputed = fitModel(JSON.parse(currentSamplesText), {
      viewports: ctx.viewports,
      targets: ctx.targets,
      tolerance: ctx.tolerance,
      samplesText: currentSamplesText,
    });
  } catch (e) {
    throw new UsageError(
      `現側 dimension-samples.json から式を当てはめ直せない: ${errorMessage(e)}`,
    );
  }
  /**
   * @param {{ measured_at?: unknown, fits?: unknown, unfit?: unknown }} m
   */
  const derived = (m) =>
    JSON.stringify({ measured_at: m.measured_at, fits: m.fits, unfit: m.unfit });
  if (derived(recomputed) !== derived(dm)) {
    throw new UsageError(
      "dimension_model の measured_at / fits / unfit が、現側 dimension-samples.json から当てはめ直した結果と一致しない（fit の後に書き換えられている）。parity-suite で fit --write を通し直す",
    );
  }
}

/**
 * 新側 samples を読み、現側の測定窓をすべて含むかを確かめて、要素ごとの矩形に索引する。
 * @param {unknown} samples - 新側 samples
 * @param {{ width: number, height: number }[]} windows - 現側の測定窓
 */
function indexNewSamples(samples, windows) {
  if (!isPlainObject(samples)) throw new UsageError("新側 samples が JSON オブジェクトでない");
  const sampleWindows = validateWindows(samples.windows, "新側 samples.windows");
  const sampleKeys = new Set(sampleWindows.map(windowKey));
  const lacking = windows.filter((w) => !sampleKeys.has(windowKey(w))).map(windowKey);
  if (lacking.length > 0) {
    throw new UsageError(
      `新側 samples.windows に現側の測定窓 ${lacking.join(", ")} が無い（同じ窓で測る）`,
    );
  }
  return indexElements(samples.elements, sampleWindows, "新側 samples");
}

/**
 * 1 つの式を 1 つの窓で照合する。外れたら CheckFailure、合えば null を返す。
 * @param {FitRecord} f
 * @param {{ width: number, height: number }} w
 * @param {{ rect: Record<string, number> | null | undefined, tolerance: number }} ctx
 * @returns {CheckFailure | null}
 */
function checkFitAt(f, w, { rect, tolerance }) {
  const base = { page: f.page, element: f.element, property: f.property, window: w };
  if (rect === null || rect === undefined) return { ...base, reason: "hidden" };
  const expected = f.ratio.width * w.width + f.ratio.height * w.height + f.offset;
  const deviation = Math.abs(rect[f.property] - expected);
  // 記録した係数の丸め（1e-6 px 未満）だけを飲む。fits の残差は tolerance 以下なので、現側と同一の矩形は通る
  if (deviation > tolerance + ROUNDING_SLACK) {
    return {
      ...base,
      reason: "deviation_exceeds_tolerance",
      expected: round(expected, 4),
      actual: rect[f.property],
      deviation: round(deviation, 4),
    };
  }
  return null;
}

/**
 * 新側の矩形を、現側の式による予測値と窓ごとに突き合わせる。
 * @param {FitRecord[]} fits
 * @param {{ windows: { width: number, height: number }[], index: ReturnType<typeof indexElements>, tolerance: number }} ctx
 * @returns {{ failures: CheckFailure[], checked: number }}
 */
function compareFits(fits, { windows, index, tolerance }) {
  /** @type {CheckFailure[]} */
  const failures = [];
  let checked = 0;
  for (const f of fits) {
    const entry = index.get(JSON.stringify([f.page, f.element]));
    if (entry === undefined) {
      failures.push({
        page: f.page,
        element: f.element,
        property: f.property,
        window: null,
        reason: "not_sampled",
      });
      continue;
    }
    for (const w of windows) {
      checked += 1;
      const failure = checkFitAt(f, w, { rect: entry.rects.get(windowKey(w)), tolerance });
      if (failure !== null) failures.push(failure);
    }
  }
  return { failures, checked };
}

/**
 * 新側の samples を現側の dimension_model と突き合わせる。
 * @param {unknown} metadata - 現側 metadata.json
 * @param {() => unknown} loadSamples - 新側 samples（measured のときだけ読む）
 * @param {() => string} [loadCurrentSamplesText] - 現側 dimension-samples.json の本文（measured のときだけ読み、式の出所と照合する）
 * @returns {{ judged: false, reason: string, unfit_to_note?: UnfitNote[] } | { judged: true, reason: null, ok: boolean, checked: number, failures: CheckFailure[], unfit_to_note: UnfitNote[] }}
 */
export function checkModel(metadata, loadSamples, loadCurrentSamplesText) {
  const viewports = readViewports(metadata);
  const { dm, status } = readDimensionModel(metadata);
  if (status !== "measured") return unjudgedResult(dm, status, viewports.length);
  const { tolerance, windows } = readMeasuredWindows(dm, viewports);
  const targets = readTargets(metadata);
  const { fits, unfit } = readModelRecords(dm, targets);
  assertModelDerived(dm, { viewports, targets, tolerance, loadCurrentSamplesText });
  const index = indexNewSamples(loadSamples(), windows);
  const { failures, checked } = compareFits(fits, { windows, index, tolerance });
  // 照合できる式が 0 件（全軸が unfit）なら合格を名乗らない。新側へ反映していない軸として porting.md へ明示させる
  if (fits.length === 0) {
    return {
      judged: false,
      reason: "dimension_model.fits が 0 件（全ての軸で式が読めず、照合していない）",
      unfit_to_note: unfit,
    };
  }
  return {
    judged: true,
    reason: null,
    ok: failures.length === 0,
    checked,
    failures,
    // 式が読めなかった軸。新側へ反映したかをスクリプトは判定できないので、porting.md へ明示させる
    unfit_to_note: unfit,
  };
}

const USAGE = [
  "usage: dimension-fit.mjs fit --samples <現側 samples.json> --metadata <metadata.json> [--tolerance <px>] [--write]",
  "       dimension-fit.mjs check --metadata <現側 metadata.json> --current-samples <現側 samples.json> --samples <新側 samples.json> [--write <replace-metadata.json>]",
].join("\n");

/**
 * 結果を JSON で stdout に書く。
 * @param {Record<string, unknown>} obj
 */
function printResult(obj) {
  process.stdout.write(
    `${JSON.stringify({ tool: "dimension-fit", version: VERSION, ...obj }, null, 2)}\n`,
  );
}

/**
 * main が使う入出力。
 * @typedef {import("./lib/file-io.mjs").FileIo} Io
 */

/**
 * check の記録に添える指紋の材料。照合の途中で埋まるので、失敗の記録もその時点の値を書く。
 * @typedef {{ newSamplesText: string | null, modelFingerprint: string | null }} CheckState
 */

/**
 * check --write の書き込み先。引数の解析より先に全て拾う（後続の引数の不備で exit 2 になっても前回の合格を上書きできるように）。
 * --write が複数あれば解析で exit 2 にするが、どれにも古い合格を残さないよう失敗の記録は全ての先へ書く。
 * @param {string[]} rest - モードの後の引数
 * @param {string} cwd
 * @returns {string[]}
 */
function collectCheckWritePaths(rest, cwd) {
  /** @type {string[]} */
  const paths = [];
  rest.forEach((a, i) => {
    const v = rest[i + 1];
    if (a === "--write" && nonEmptyString(v) && !v.startsWith("--")) {
      paths.push(resolve(cwd, v));
    }
  });
  return paths;
}

/**
 * dimension_check を replace-metadata.json へ書く関数を作る。
 * @param {Io} io
 * @param {CheckState} state
 * @returns {(record: Record<string, unknown>, path: string) => void}
 */
function makeCheckWriter(io, state) {
  return (record, path) => {
    const replaceMetadata = JSON.parse(io.readFile(path));
    if (!isPlainObject(replaceMetadata)) {
      throw new UsageError("--write の先が JSON オブジェクトでない");
    }
    replaceMetadata.dimension_check = {
      tool: "dimension-fit",
      tool_version: VERSION,
      ...record,
      // どの式とどの新側 samples を照合した記録か（採り直した後に古い記録を見分ける）
      model_fingerprint: state.modelFingerprint,
      samples_fingerprint: state.newSamplesText === null ? null : fingerprint(state.newSamplesText),
    };
    io.writeFile(path, `${JSON.stringify(replaceMetadata, null, 2)}\n`);
  };
}

/**
 * モードの後の引数を読む。--write は、check では値（書き込み先）を取り、fit では値を取らない。
 * 同じオプションの重複は、どちらの値で動いたかが曖昧になるので、parseFlags が止める。
 * @param {"fit" | "check"} mode
 * @param {string[]} rest
 * @returns {Record<string, string | true>}
 */
function parseOptions(mode, rest) {
  const common = ["--samples", "--metadata", "--tolerance"];
  const parsed = parseFlags(
    rest,
    mode === "check"
      ? { values: [...common, "--write", "--current-samples"] }
      : { values: common, bools: ["--write"] },
  );
  if (parsed.error !== undefined) throw new UsageError(parsed.error);
  // parseFlags は空の値だけを誤りにする。空白だけの値も値の書き忘れとして扱う。
  // 通すと、`--tolerance " "` が Number で 0 になり、許容幅 0 として警告なしに判定する。
  for (const [name, value] of Object.entries(parsed.strings)) {
    if (!nonEmptyString(value)) throw new UsageError(`${name} に値が無い`);
  }
  // --write は、check では strings に、fit では bools に入る。
  return Object.fromEntries(
    [...Object.entries(parsed.strings), ...Object.entries(parsed.bools)].map(([name, value]) => [
      name.slice(2),
      value,
    ]),
  );
}

/**
 * fit の --tolerance を読む。無ければ既定の許容残差。
 * @param {string | true | undefined} raw
 * @returns {number}
 */
function readToleranceOption(raw) {
  if (typeof raw !== "string") return DEFAULT_TOLERANCE;
  const tolerance = Number(raw);
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new UsageError("--tolerance が 0 以上の数でない");
  }
  return tolerance;
}

/**
 * fit を実行する。
 * @param {{ opts: Record<string, string | true>, metadata: unknown, metadataPath: string }} ctx
 * @param {Io} io
 * @returns {number}
 */
function runFit({ opts, metadata, metadataPath }, io) {
  if (typeof opts.samples !== "string") throw new UsageError("--samples が無い");
  const tolerance = readToleranceOption(opts.tolerance);
  const viewports = readViewports(metadata);
  const targets = readTargets(metadata);
  const samplesText = io.readFile(resolve(io.cwd, opts.samples));
  const model = fitModel(JSON.parse(samplesText), {
    viewports,
    targets,
    tolerance,
    samplesText,
  });
  if (opts.write === true) {
    // readViewports が capture_conditions を JSON オブジェクトだと確かめているので、この分岐には到達しない
    const cc = isPlainObject(metadata) ? metadata.capture_conditions : undefined;
    if (!isPlainObject(cc)) {
      throw new UsageError("metadata.json の capture_conditions.viewports が空でない配列でない");
    }
    cc.dimension_model = model;
    io.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  }
  printResult({
    mode: "fit",
    fits: model.fits.length,
    unfit: model.unfit.length,
    dimension_model: model,
  });
  return 0;
}

/**
 * check に渡す 2 つの読み込み関数を作る（measured のときだけ呼ばれる）。新側 samples の本文は state に残す。
 * @param {Record<string, string | true>} opts
 * @param {Io} io
 * @param {CheckState} state
 * @returns {{ loadSamples: () => unknown, loadCurrentSamplesText: () => string }}
 */
function checkLoaders(opts, io, state) {
  return {
    loadSamples: () => {
      if (typeof opts.samples !== "string") {
        throw new UsageError("dimension_model.status: measured の照合には --samples（新側）が要る");
      }
      state.newSamplesText = io.readFile(resolve(io.cwd, opts.samples));
      return JSON.parse(state.newSamplesText);
    },
    loadCurrentSamplesText: () => {
      if (typeof opts["current-samples"] !== "string") {
        throw new UsageError(
          "dimension_model.status: measured の照合には --current-samples（現側 dimension-samples.json）が要る",
        );
      }
      return io.readFile(resolve(io.cwd, opts["current-samples"]));
    },
  };
}

/**
 * check の結果から、--write の先へ書く記録を作る。
 * @param {ReturnType<typeof checkModel>} result
 * @returns {Record<string, unknown>}
 */
function checkRecord(result) {
  return {
    judged: result.judged,
    reason: result.reason,
    ok: result.judged ? result.ok : null,
    checked: result.judged ? result.checked : 0,
    failures: result.judged ? result.failures.length : 0,
    unfit_to_note: result.unfit_to_note ?? [],
    error: null,
  };
}

/**
 * check を実行する。
 * @param {{ opts: Record<string, string | true>, metadata: unknown, checkWritePaths: string[] }} ctx
 * @param {{ io: Io, state: CheckState, writeCheck: (record: Record<string, unknown>, path: string) => void }} deps
 * @returns {number}
 */
function runCheck({ opts, metadata, checkWritePaths }, { io, state, writeCheck }) {
  const cc = isPlainObject(metadata) ? metadata.capture_conditions : undefined;
  if (isPlainObject(cc) && Object.hasOwn(cc, "dimension_model")) {
    state.modelFingerprint = fingerprint(JSON.stringify(cc.dimension_model));
  }
  if (opts.tolerance !== undefined) {
    throw new UsageError("check に --tolerance は渡せない（現側に記録した tolerance を使う）");
  }
  const { loadSamples, loadCurrentSamplesText } = checkLoaders(opts, io, state);
  const result = checkModel(metadata, loadSamples, loadCurrentSamplesText);
  for (const path of checkWritePaths) writeCheck(checkRecord(result), path);
  printResult({ mode: "check", ...result });
  if (result.judged && !result.ok) {
    for (const f of result.failures) process.stderr.write(`warn: ${JSON.stringify(f)}\n`);
    process.stderr.write(
      `error: 寸法の決まり方が現側と合わない ${result.failures.length} 件 — 1 点の px ではなく式で反映する\n`,
    );
    return 1;
  }
  return 0;
}

/**
 * exit 2 で終わる check の失敗を、--write の全ての先へ書く。
 * 前回の ok: true を残したまま exit 2 で終わらせない（記録から古い合格と見分けられなくなる）。
 * @param {string[]} paths
 * @param {string} message
 * @param {(record: Record<string, unknown>, path: string) => void} writeCheck
 */
function writeErrorRecords(paths, message, writeCheck) {
  for (const path of paths) {
    try {
      writeCheck(
        {
          judged: false,
          reason: null,
          ok: false,
          checked: 0,
          failures: 0,
          unfit_to_note: [],
          error: message,
        },
        path,
      );
    } catch (writeError) {
      process.stderr.write(`error: 失敗の記録も書けない（${path}）: ${errorMessage(writeError)}\n`);
    }
  }
}

/**
 * @param {string[]} argv - process.argv.slice(2)
 * @param {{ readFile?: (p: string) => string, writeFile?: (p: string, s: string) => void, cwd?: string }} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const io = fileIo(deps);
  const [mode, ...rest] = argv;
  const checkWritePaths = mode === "check" ? collectCheckWritePaths(rest, io.cwd) : [];
  /** @type {CheckState} */
  const state = { newSamplesText: null, modelFingerprint: null };
  const writeCheck = makeCheckWriter(io, state);
  try {
    if (mode !== "fit" && mode !== "check") throw new UsageError("先頭に fit か check を書く");
    const opts = parseOptions(mode, rest);
    if (typeof opts.metadata !== "string") throw new UsageError("--metadata が無い");
    const metadataPath = resolve(io.cwd, opts.metadata);
    const metadata = JSON.parse(io.readFile(metadataPath));
    if (mode === "fit") return runFit({ opts, metadata, metadataPath }, io);
    return runCheck({ opts, metadata, checkWritePaths }, { io, state, writeCheck });
  } catch (e) {
    const message = errorMessage(e);
    process.stderr.write(`error: ${message}\n${USAGE}\n`);
    writeErrorRecords(checkWritePaths, message, writeCheck);
    return 2;
  }
}

if (isCliEntry(import.meta.url)) {
  // process.exit は書き込み中の stdout を捨てる（パイプ越しに 64KB を超える JSON が切れる）。終了コードだけを設定して自然終了させる
  process.exitCode = main(process.argv.slice(2));
}
