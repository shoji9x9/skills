// 寸法の決まり方（窓の寸法に対する位置・寸法の式）を当てはめ・照合する（正本）。
// 正本は parity-suite にあり、スキルディレクトリ内から直接実行する（プロジェクトへコピーしない）。
// parity-replace は完了判定でインストール済みの parity-suite から同じスクリプトを check で呼ぶ。
//
// なぜ要るか: 撮影条件が 1 ビューポートだと、画素・特性照合・aria の 3 経路はその 1 点でしか比べない。
// 移行元が「割合 × 器の寸法 ＋ 定数」で決まっていても、測った px を並べた新側は 3 経路すべてで緑になり、
// 別の窓で数十 px ずれる。窓を変えて同じ要素を読み、式を記録して新側に当てれば、この形を落とせる。
//
// 何をするか:
//   fit   現側で窓を 4 つ以上変えて読んだ矩形（samples）から、要素 × 軸（x / y / width / height）ごとに
//         値 = ratio.width × 窓の幅 ＋ ratio.height × 窓の高さ ＋ offset を最小二乗で当てはめ、
//         残差（最大絶対誤差）が許容内なら fits、超える・一部の窓で表示されないなら unfit（式が読めない）に記録する。
//         --write で metadata.json の capture_conditions.dimension_model へ書く（手で転記させない）
//   check 新側で同じ窓（measured_at）に読んだ矩形を、現側の fits の式による予測値と突き合わせる。
//         --write <replace-metadata.json> で結果を dimension_check として書く（exit 2 も error として書き、前回の合格を残さない）
//
// 器の寸法を窓の寸法に固定する理由: 器（グリッド・パネル）自身が窓に対して線形なら、器に対して線形な要素も
// 窓に対して線形になる（合成しても線形）。窓の幅と高さを独立に動かして 2 変数で当てれば、器を選ぶ判断が要らない。
// ブレークポイント（メディアクエリ）や min / max の頭打ちをまたぐと線形にならず unfit になる——それは正しい振る舞い。
//
// fail-closed: 窓 4 未満・窓が一直線上に並ぶ（幅と高さを独立に動かしていない）・宣言したビューポートを含まない・
// 窓の欠け／重複・要素キーの欠落／重複・型崩れは合格に倒さない（exit 2）。
// 判定しない経路（judged: false）は dimension_model の欠落・status: not_measured / not_required に閉じ、理由を出力に残す。
//
// 決定論的: 乱数・現在時刻に依存しない。TypeScript 構文は使わない（型は JSDoc）。

import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ツールのバージョン（正本）。当てはめ・判定ロジック・出力形状を変えたら上げる。
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
 * @param {unknown} v
 * @returns {boolean}
 */
function nonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function finite(v) {
  return typeof v === "number" && Number.isFinite(v);
}

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
 * 窓 1 つを検証する（キーを作る前に型を確かめる。"1366" のような文字列を実在の窓のキーへ化けさせない）。
 * @param {unknown} w
 * @param {string} at
 * @returns {{ width: number, height: number }}
 */
function validateWindow(w, at) {
  if (
    !isPlainObject(w) ||
    !Number.isInteger(w.width) ||
    !Number.isInteger(w.height) ||
    /** @type {number} */ (w.width) <= 0 ||
    /** @type {number} */ (w.height) <= 0
  ) {
    throw new UsageError(`${at} の width / height が正の整数でない`);
  }
  return { width: /** @type {number} */ (w.width), height: /** @type {number} */ (w.height) };
}

/**
 * 窓の一覧を検証する（正の整数・重複なし・4 以上・一直線上に並ばない）。
 * @param {unknown} windows
 * @param {string} label
 * @returns {{ width: number, height: number }[]}
 */
export function validateWindows(windows, label) {
  if (!Array.isArray(windows)) throw new UsageError(`${label} が配列でない`);
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
      `${label} の窓が一直線上に並んでいる（縦横比が一定など）。幅と高さを独立に動かした窓を含める——でないと幅と高さのどちらに追従しているかを分けられない`,
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
  if (!Array.isArray(elements)) throw new UsageError(`${label}.elements が配列でない`);
  const windowKeys = new Set(windows.map(windowKey));
  /** @type {Map<string, { page: string, element: string, rects: Map<string, Record<string, number> | null> }>} */
  const index = new Map();
  elements.forEach((e, i) => {
    const at = `${label}.elements[${i}]`;
    // キーの材料を先に弾く（欠落を "undefined" という有効なキーへ化けさせない）
    if (!isPlainObject(e) || !nonEmptyString(e.page) || !nonEmptyString(e.element)) {
      throw new UsageError(`${at} の page / element が空でない文字列でない`);
    }
    const key = JSON.stringify([e.page, e.element]);
    if (index.has(key)) {
      throw new UsageError(`${at} の (page, element) = (${e.page}, ${e.element}) が重複している`);
    }
    if (!Array.isArray(e.rects)) throw new UsageError(`${at}.rects が配列でない`);
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
      if (r.rect === null) {
        rects.set(wk, null);
        return;
      }
      if (!isPlainObject(r.rect) || !PROPERTIES.every((p) => finite(r.rect[p]))) {
        throw new UsageError(
          `${at}.rects[${j}].rect が x / y / width / height の有限数を持たない（表示されない窓は null と書く）`,
        );
      }
      rects.set(wk, /** @type {Record<string, number>} */ (r.rect));
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
  const fits = [];
  const unfit = [];
  for (const { page, element, rects } of index.values()) {
    for (const property of PROPERTIES) {
      const hidden = windows.filter((w) => rects.get(windowKey(w)) === null).map(windowKey);
      if (hidden.length > 0) {
        unfit.push({
          page,
          element,
          property,
          residual: null,
          reason: `hidden_in_windows: ${hidden.join(", ")}`,
        });
        continue;
      }
      const points = windows.map((w) => ({
        W: w.width,
        H: w.height,
        v: /** @type {Record<string, number>} */ (rects.get(windowKey(w)))[property],
      }));
      const f = fitPlane(points);
      const residual = round(f.residual, 4);
      if (f.residual > opts.tolerance) {
        unfit.push({ page, element, property, residual, reason: "residual_exceeds_tolerance" });
      } else {
        fits.push({
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
  return {
    status: "measured",
    tool: "dimension-fit",
    tool_version: VERSION,
    tolerance: opts.tolerance,
    measured_at: windows,
    samples_fingerprint: fingerprint(opts.samplesText),
    fits,
    unfit,
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
  if (!isPlainObject(cc) || !Array.isArray(cc.viewports) || cc.viewports.length === 0) {
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
    !Array.isArray(traits.elements) ||
    traits.elements.length === 0 ||
    !traits.elements.every(nonEmptyString)
  ) {
    throw new UsageError(
      "metadata.json の traits.elements が空でない文字列の配列でない（特性を採る論理名を確定してから通す）",
    );
  }
  const cc = /** @type {Record<string, unknown>} */ (
    /** @type {Record<string, unknown>} */ (metadata).capture_conditions
  );
  if (
    !Array.isArray(cc.pages) ||
    cc.pages.length === 0 ||
    !cc.pages.every((p) => isPlainObject(p) && nonEmptyString(p.name))
  ) {
    throw new UsageError("metadata.json の capture_conditions.pages[].name が空でない配列でない");
  }
  // 同名のページを 1 つの集合キーへ潰さない（1 つ目のページを測っただけで 2 つ目の測り漏れが通る）
  const names = cc.pages.map((p) => /** @type {string} */ (p.name));
  const duplicated = names.filter((n, i) => names.indexOf(n) !== i);
  if (duplicated.length > 0) {
    throw new UsageError(
      `capture_conditions.pages[].name が重複している: ${[...new Set(duplicated)].join(", ")}`,
    );
  }
  return {
    traitElements: /** @type {string[]} */ (traits.elements),
    pages: cc.pages.map((p) => /** @type {string} */ (p.name)),
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
 * 新側の samples を現側の dimension_model と突き合わせる。
 * @param {unknown} metadata - 現側 metadata.json
 * @param {() => unknown} loadSamples - 新側 samples（measured のときだけ読む）
 */
export function checkModel(metadata, loadSamples) {
  const viewports = readViewports(metadata);
  const cc = /** @type {Record<string, unknown>} */ (
    /** @type {Record<string, unknown>} */ (metadata).capture_conditions
  );
  // キーの欠落は免除にしない（判定しない経路は理由付きの not_measured / not_required に閉じる）
  if (!Object.hasOwn(cc, "dimension_model")) {
    throw new UsageError(
      "capture_conditions.dimension_model が無い。parity-suite で fit を通すか、測れないなら status: not_measured と reason を書く（キーを省略したまま判定を免除しない）",
    );
  }
  const dm = cc.dimension_model;
  if (!isPlainObject(dm) || !STATUSES.includes(/** @type {string} */ (dm.status))) {
    throw new UsageError(`dimension_model.status が ${STATUSES.join(" / ")} のいずれでもない`);
  }
  // 判定しない経路は閉じた集合（not_measured / not_required）に限り、理由を必須にする
  if (dm.status !== "measured") {
    if (!nonEmptyString(dm.reason)) {
      throw new UsageError(`dimension_model.status: ${dm.status} に reason が無い`);
    }
    if (dm.status === "not_required" && viewports.length < 2) {
      throw new UsageError(
        "ビューポートが 1 つの撮影で dimension_model.status: not_required は使えない（1 点の px を並べた版組が 3 経路で緑になる）",
      );
    }
    return { judged: false, reason: `dimension_model.status: ${dm.status}（${dm.reason}）` };
  }
  if (dm.tool_version !== VERSION) {
    throw new UsageError(
      `dimension_model.tool_version が ${String(dm.tool_version)}（ツールは ${VERSION}）。parity-suite で現側を採り直す`,
    );
  }
  if (!finite(dm.tolerance) || /** @type {number} */ (dm.tolerance) < 0) {
    throw new UsageError("dimension_model.tolerance が 0 以上の数でない");
  }
  const windows = validateWindows(dm.measured_at, "dimension_model.measured_at");
  const measuredKeys = new Set(windows.map(windowKey));
  if (!viewports.some((v) => measuredKeys.has(windowKey(v)))) {
    throw new UsageError(
      "dimension_model.measured_at が capture_conditions.viewports のどれも含まない（撮影したビューポートで照合されない）。parity-suite で採り直す",
    );
  }
  const targets = readTargets(metadata);
  if (!Array.isArray(dm.fits) || !Array.isArray(dm.unfit)) {
    throw new UsageError("dimension_model.fits / unfit が配列でない");
  }
  if (dm.fits.length + dm.unfit.length === 0) {
    throw new UsageError("dimension_model.fits と unfit がどちらも空（測った要素が無い）");
  }
  const seenFit = new Set();
  const fits = dm.fits.map((f, i) => {
    if (
      !isPlainObject(f) ||
      !nonEmptyString(f.page) ||
      !nonEmptyString(f.element) ||
      !PROPERTIES.includes(/** @type {string} */ (f.property)) ||
      !isPlainObject(f.ratio) ||
      !finite(f.ratio.width) ||
      !finite(f.ratio.height) ||
      !finite(f.offset)
    ) {
      throw new UsageError(`dimension_model.fits[${i}] の形が崩れている`);
    }
    const key = JSON.stringify([f.page, f.element, f.property]);
    if (seenFit.has(key)) throw new UsageError(`dimension_model.fits[${i}] が重複している`);
    seenFit.add(key);
    return /** @type {{ page: string, element: string, property: string, ratio: { width: number, height: number }, offset: number }} */ (
      f
    );
  });
  // unfit も fits と同じくキーの材料を検証する（崩れた記録を中身の無い note に化けさせない）
  const seenUnfit = new Set();
  const unfit = dm.unfit.map((u, i) => {
    if (
      !isPlainObject(u) ||
      !nonEmptyString(u.page) ||
      !nonEmptyString(u.element) ||
      !PROPERTIES.includes(/** @type {string} */ (u.property)) ||
      !nonEmptyString(u.reason)
    ) {
      throw new UsageError(`dimension_model.unfit[${i}] の形が崩れている`);
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
  // 記録された (page, element) は 4 軸すべてを fits か unfit のどちらかにちょうど 1 回持つこと
  // （軸を消した記録で、消した軸の照合を黙って飛ばさない）
  /** @type {Map<string, { page: string, element: string, properties: Set<string> }>} */
  const byElement = new Map();
  for (const e of [...fits, ...unfit]) {
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
  assertCoverage([...byElement.values()], targets, "dimension_model");
  const samples = loadSamples();
  if (!isPlainObject(samples)) throw new UsageError("新側 samples が JSON オブジェクトでない");
  const sampleWindows = validateWindows(samples.windows, "新側 samples.windows");
  const sampleKeys = new Set(sampleWindows.map(windowKey));
  const lacking = windows.filter((w) => !sampleKeys.has(windowKey(w))).map(windowKey);
  if (lacking.length > 0) {
    throw new UsageError(
      `新側 samples.windows に現側の測定窓 ${lacking.join(", ")} が無い（同じ窓で測る）`,
    );
  }
  const index = indexElements(samples.elements, sampleWindows, "新側 samples");
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
      const rect = entry.rects.get(windowKey(w));
      if (rect === null || rect === undefined) {
        failures.push({
          page: f.page,
          element: f.element,
          property: f.property,
          window: w,
          reason: "hidden",
        });
        continue;
      }
      const expected = f.ratio.width * w.width + f.ratio.height * w.height + f.offset;
      const deviation = Math.abs(rect[f.property] - expected);
      // 記録した係数の丸め（1e-6 px 未満）だけを飲む。fits の残差は tolerance 以下なので、現側と同一の矩形は通る
      if (deviation > /** @type {number} */ (dm.tolerance) + ROUNDING_SLACK) {
        failures.push({
          page: f.page,
          element: f.element,
          property: f.property,
          window: w,
          reason: "deviation_exceeds_tolerance",
          expected: round(expected, 4),
          actual: rect[f.property],
          deviation: round(deviation, 4),
        });
      }
    }
  }
  return {
    judged: true,
    reason: null,
    ok: failures.length === 0,
    checked,
    failures,
    // 式が読めなかった軸。新側で写したかをスクリプトは判定できないので、porting.md へ明示させる
    unfit_to_note: unfit,
  };
}

/**
 * @param {string[]} argv - process.argv.slice(2)
 * @param {{ readFile?: (p: string) => string, writeFile?: (p: string, s: string) => void, cwd?: string }} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const readFile = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
  const writeFile = deps.writeFile ?? ((p, s) => writeFileSync(p, s));
  const cwd = deps.cwd ?? process.cwd();
  const usage = [
    "usage: dimension-fit.mjs fit --samples <現側 samples.json> --metadata <metadata.json> [--tolerance <px>] [--write]",
    "       dimension-fit.mjs check --metadata <現側 metadata.json> --samples <新側 samples.json> [--write <replace-metadata.json>]",
  ].join("\n");
  const out = (obj) =>
    process.stdout.write(
      `${JSON.stringify({ tool: "dimension-fit", version: VERSION, ...obj }, null, 2)}\n`,
    );
  const [mode, ...rest] = argv;
  /**
   * check --write の書き込み先。引数の解析より先に全て拾う（後続の引数の不備で exit 2 になっても前回の合格を上書きできるように）。
   * --write が複数あれば解析で exit 2 にするが、どれにも古い合格を残さないよう失敗の記録は全ての先へ書く。
   * @type {string[]}
   */
  const checkWritePaths = [];
  if (mode === "check") {
    rest.forEach((a, i) => {
      const v = rest[i + 1];
      if (a === "--write" && nonEmptyString(v) && !v.startsWith("--")) {
        checkWritePaths.push(resolve(cwd, v));
      }
    });
  }
  /** @type {string | null} */
  let newSamplesText = null;
  /** @type {string | null} */
  let modelFingerprint = null;
  /** @param {Record<string, unknown>} record */
  const writeCheck = (record, path) => {
    const replaceMetadata = JSON.parse(readFile(path));
    if (!isPlainObject(replaceMetadata)) {
      throw new UsageError("--write の先が JSON オブジェクトでない");
    }
    replaceMetadata.dimension_check = {
      tool: "dimension-fit",
      tool_version: VERSION,
      ...record,
      // どの式とどの新側 samples を照合した記録か（採り直した後に古い記録を見分ける）
      model_fingerprint: modelFingerprint,
      samples_fingerprint: newSamplesText === null ? null : fingerprint(newSamplesText),
    };
    writeFile(path, `${JSON.stringify(replaceMetadata, null, 2)}\n`);
  };
  try {
    if (mode !== "fit" && mode !== "check") throw new UsageError("先頭に fit か check を書く");
    /** @type {Record<string, string | true>} */
    const opts = {};
    for (let i = 0; i < rest.length; i += 1) {
      const a = rest[i];
      const takesValue =
        a === "--samples" ||
        a === "--metadata" ||
        a === "--tolerance" ||
        (a === "--write" && mode === "check");
      if (a === "--write" && mode === "fit") {
        if (opts.write === true) throw new UsageError("--write が重複している");
        opts.write = true;
      } else if (takesValue) {
        const v = rest[i + 1];
        if (!nonEmptyString(v) || v.startsWith("--")) throw new UsageError(`${a} に値が無い`);
        // 同じオプションの重複は後勝ちにしない（どちらの値で動いたかが曖昧になる）
        if (Object.hasOwn(opts, a.slice(2))) throw new UsageError(`${a} が重複している`);
        opts[a.slice(2)] = v;
        i += 1;
      } else {
        throw new UsageError(`不明な引数 ${a}`);
      }
    }
    if (typeof opts.metadata !== "string") throw new UsageError("--metadata が無い");
    const metadataPath = resolve(cwd, opts.metadata);
    const metadata = JSON.parse(readFile(metadataPath));

    if (mode === "fit") {
      if (typeof opts.samples !== "string") throw new UsageError("--samples が無い");
      let tolerance = DEFAULT_TOLERANCE;
      if (typeof opts.tolerance === "string") {
        tolerance = Number(opts.tolerance);
        if (!Number.isFinite(tolerance) || tolerance < 0) {
          throw new UsageError("--tolerance が 0 以上の数でない");
        }
      }
      const viewports = readViewports(metadata);
      const targets = readTargets(metadata);
      const samplesText = readFile(resolve(cwd, opts.samples));
      const model = fitModel(JSON.parse(samplesText), {
        viewports,
        targets,
        tolerance,
        samplesText,
      });
      if (opts.write === true) {
        metadata.capture_conditions.dimension_model = model;
        writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
      }
      out({ mode, fits: model.fits.length, unfit: model.unfit.length, dimension_model: model });
      return 0;
    }

    const cc = isPlainObject(metadata) ? metadata.capture_conditions : undefined;
    if (isPlainObject(cc) && Object.hasOwn(cc, "dimension_model")) {
      modelFingerprint = fingerprint(JSON.stringify(cc.dimension_model));
    }
    if (opts.tolerance !== undefined) {
      throw new UsageError("check に --tolerance は渡せない（現側に記録した tolerance を使う）");
    }
    const result = checkModel(metadata, () => {
      if (typeof opts.samples !== "string") {
        throw new UsageError("dimension_model.status: measured の照合には --samples（新側）が要る");
      }
      newSamplesText = readFile(resolve(cwd, opts.samples));
      return JSON.parse(newSamplesText);
    });
    for (const path of checkWritePaths) {
      writeCheck(
        {
          judged: result.judged,
          reason: result.reason,
          ok: result.judged ? result.ok : null,
          checked: result.judged ? result.checked : 0,
          failures: result.judged ? result.failures.length : 0,
          unfit_to_note: result.judged ? result.unfit_to_note : [],
          error: null,
        },
        path,
      );
    }
    out({ mode, ...result });
    if (result.judged && !result.ok) {
      for (const f of result.failures) process.stderr.write(`warn: ${JSON.stringify(f)}\n`);
      process.stderr.write(
        `error: 寸法の決まり方が現側と合わない ${result.failures.length} 件 — 1 点の px ではなく式で写す\n`,
      );
      return 1;
    }
    return 0;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(`error: ${message}\n${usage}\n`);
    // 前回の ok: true を残したまま exit 2 で終わらせない（記録から古い合格と見分けられなくなる）
    for (const path of mode === "check" ? checkWritePaths : []) {
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
        process.stderr.write(
          `error: 失敗の記録も書けない（${path}）: ${writeError instanceof Error ? writeError.message : writeError}\n`,
        );
      }
    }
    return 2;
  }
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
  // process.exit は書き込み中の stdout を捨てる（パイプ越しに 64KB を超える JSON が切れる）。終了コードだけを設定して自然終了させる
  process.exitCode = main(process.argv.slice(2));
}
