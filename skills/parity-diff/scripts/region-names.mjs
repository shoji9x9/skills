// 画素の差分の領域に、重なる論理名を対応づける（原本）。
// 原本はこのスキルの中にあり、スキルのディレクトリから直接実行する。プロジェクトへはコピーしない。
//
// 入力は、pixel-crops.mjs の出力（regions[] と strict_only_regions[] の bbox）と、同じページ・状態・ビューポートで
// 現側と新側が採った traits.json（論理名ごとの rect）である。領域の bbox と rect の交わりの面積で、重なる論理名を決める。
// 対応づけは決定論的に行い、LLM には任せない。分類する人とモデルは、この結果を crop 対に添えて読む。
//
// 重なりの定義: 交わりの面積が 0 より大きいこと。辺や角が接するだけ（面積 0）は重ならない。
// 面積の閾値は置かない。小さな重なりを閾値で消すと、名前の付いた要素の差を「名前なし」として読ませてしまう。
// 代わりに、論理名ごとに region_coverage（交わり / 領域の面積）と element_coverage（交わり / 要素の面積）を出し、
// region_coverage の大きい順に並べる。ページ全体を包む要素のような広い論理名は、element_coverage が小さく出る。
//
// 座標: bbox は画像の画素、rect は CSS の px（getBoundingClientRect）である。rect に --scale（撮影の deviceScaleFactor）を
// 掛けてから比べる。rect はビューポートを基準にした座標なので、全画面（fullPage）をスクロールした状態で撮った組では
// 画像の座標とずれる。このスクリプトはスクロールの位置を知らないので、そのずれを検出しない（references/detect.md に書く）。
//
// マスクの論理名の位置は、側ごとに次の順で決める。
// 1. その側の mask-rects.json（撮影のときにマスクを当てた矩形の記録）がその名前を記録していれば、記録した矩形を使う。
//    記録した rects が空か、面積が 0 の矩形だけなら、その側ではマスクが何も塗らなかったと分かる（位置は決まる）。
// 2. 記録していなければ（mask-rects.json が無いと宣言した側を含む）、その側の traits.json の rect から探す。
// mask-rects.json の矩形は、撮影した画像での位置で、単位は CSS の px である（全画面の撮影ではスクロールの量を足してある）。
// 縁を CSS の px の整数に四捨五入してから、rect と同じく --scale を掛けて比べる。Playwright の Chromium の mask は、
// 縁を四捨五入した位置を塗る（実測。deviceScaleFactor が 1・2・3 で一致し、1.5 では 1 画素以内でずれた）。
// 四捨五入しないと、小数の縁が 1 画素より細い帯を作り、塗られた縁の画素の領域が覆われていないと判定される。
//
// 判定できない領域を「重なる論理名なし」にしない。
// - traits.json が無い側がある組で、どの論理名とも重ならない領域は status: "unknown" にする
// - マスクの論理名の位置を決められない組（mask-rects.json に記録が無く、traits.json に名前が無いか面積が 0）で、
//   どの論理名とも重ならない領域も status: "unknown" にする
// - 現側でも新側でも、その側のマスクの矩形の和に領域の全体が覆われるなら status: "masked" にする。
//   覆うかは側ごとに判定するので、片側でしか位置を確かめられなかったマスクの論理名では masked にならない
// 終了コードは、0 がすべての領域を判定できた、1 が判定できない領域がある、2 が入力の誤りである。
// 乱数と現在時刻に依存しない。入力が同じなら出力も同じになる。TypeScript の構文は使わない（型は JSDoc で書く）。

import { readFileSync } from "node:fs";
import { isCliEntry } from "./lib/cli.mjs";
import { parseFlags } from "./lib/flags.mjs";
import { isPlainObject, nonEmptyString } from "./lib/guards.mjs";
import { isArray } from "./lib/is-array.mjs";

/**
 * ツールのバージョン（原本）。重なりの定義や出力の形を変えたら上げる。
 * @type {string}
 */
export const VERSION = "2";

/** @typedef {{ x:number, y:number, width:number, height:number }} Rect */
/** @typedef {"current" | "new"} Side */
/** @typedef {{ name:string, rect:Rect }} NamedRect */
/** @typedef {{ id:(string|number), kind:("threshold"|"strict_only"), bbox:Rect }} Region */
/**
 * 側ごとの traits.json。missing は、`--<side>-traits-missing` で無いと宣言した側である。
 * @typedef {{ side:Side, missing:true } | { side:Side, missing:false, entries:NamedRect[] }} SideTraits
 */
/**
 * 側ごとの mask-rects.json。missing は、`--<side>-mask-rects-missing` で無いと宣言したか、どちらの引数も渡さなかった側である。
 * byName は、記録したマスクの論理名から、ロケータが当たったすべての要素の矩形への対応である。
 * @typedef {{ side:Side, missing:true } | { side:Side, missing:false, byName:Map<string, Rect[]> }} SideMaskRects
 */
/**
 * マスクの矩形。bySide は側ごとの矩形で、bbox で渡したマスクは両側に同じ矩形を持つ。
 * 位置の違う 2 つの側の矩形を 1 つの和にまとめて覆うかを判定すると、片側のマスクしか覆っていない領域（もう片側では
 * マスクされていない要素が描かれている）まで masked になる。そのため、覆うかは側ごとに判定する。
 * 片側でしか位置を確かめられなかったマスクは、もう片側の矩形が空なので、側ごとの判定で masked にならない。
 * 位置を確かめられないのは、その側の mask-rects.json に記録が無く、traits.json が無いか、名前が無いか面積が 0 のときである。
 * @typedef {{ label:string, bySide:Record<Side, Rect[]> }} MaskArea
 */

const SIDES = /** @type {const} */ (["current", "new"]);

/**
 * 有限の数か。
 * @param {unknown} v
 * @returns {v is number}
 */
function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * rect の形（有限の x・y と、0 以上の width・height）か。
 * @param {unknown} v
 * @returns {v is Rect}
 */
export function isRect(v) {
  if (!isPlainObject(v)) return false;
  const { x, y, width, height } = v;
  return (
    isFiniteNumber(x) &&
    isFiniteNumber(y) &&
    isFiniteNumber(width) &&
    isFiniteNumber(height) &&
    width >= 0 &&
    height >= 0
  );
}

/**
 * 画素の bbox の形（0 以上の整数の x・y と、1 以上の整数の width・height）か。
 * @param {unknown} v
 * @returns {v is Rect}
 */
function isPixelBbox(v) {
  if (!isRect(v)) return false;
  return (
    [v.x, v.y, v.width, v.height].every(Number.isInteger) &&
    v.x >= 0 &&
    v.y >= 0 &&
    v.width > 0 &&
    v.height > 0
  );
}

/**
 * 2 つの矩形の交わりの面積。辺や角が接するだけなら 0 を返す。
 * @param {Rect} a
 * @param {Rect} b
 * @returns {number}
 */
export function intersectionArea(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * CSS の px の rect を、画像の画素の座標に直す。
 * @param {Rect} rect
 * @param {number} scale
 * @returns {Rect}
 */
export function scaleRect(rect, scale) {
  return {
    x: rect.x * scale,
    y: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

/**
 * 領域が矩形の和にすべて覆われるか。座標を圧縮した格子の各セルの中心が、どれかの矩形の内側にあるかで決める。
 * @param {Rect} region
 * @param {Rect[]} rects
 * @returns {boolean}
 */
export function coveredByUnion(region, rects) {
  const inside = rects.filter((r) => intersectionArea(region, r) > 0);
  if (inside.length === 0) return false;
  const x2 = region.x + region.width;
  const y2 = region.y + region.height;
  const cuts = (
    /** @type {number[]} */ edges,
    /** @type {number} */ lo,
    /** @type {number} */ hi,
  ) => [...new Set([lo, hi, ...edges.filter((e) => e > lo && e < hi)])].sort((p, q) => p - q);
  const xs = cuts(
    inside.flatMap((r) => [r.x, r.x + r.width]),
    region.x,
    x2,
  );
  const ys = cuts(
    inside.flatMap((r) => [r.y, r.y + r.height]),
    region.y,
    y2,
  );
  for (let i = 0; i + 1 < xs.length; i += 1) {
    for (let j = 0; j + 1 < ys.length; j += 1) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cy = (ys[j] + ys[j + 1]) / 2;
      const hit = inside.some(
        (r) => cx > r.x && cx < r.x + r.width && cy > r.y && cy < r.y + r.height,
      );
      if (!hit) return false;
    }
  }
  return true;
}

/**
 * 小数を 4 桁に丸める（出力を読みやすくするため。判定には丸める前の値を使う）。
 * @param {number} v
 * @returns {number}
 */
function round4(v) {
  return Math.round(v * 10000) / 10000;
}

/**
 * 1 つの側の traits.json から、領域に重なる論理名を集める。マスクの論理名は除く（塗りつぶされているため）。
 * @param {Rect} bbox
 * @param {{ side:Side, entries:NamedRect[], scale:number, maskNames:Set<string> }} input
 * @param {Map<string, { name:string, sides:Side[], overlap_px:number, region_coverage:number, element_coverage:number }>} acc
 */
function collectSideOverlaps(bbox, { side, entries, scale, maskNames }, acc) {
  const regionArea = bbox.width * bbox.height;
  for (const entry of entries) {
    if (maskNames.has(entry.name)) continue;
    const rect = scaleRect(entry.rect, scale);
    const area = intersectionArea(bbox, rect);
    if (area <= 0) continue;
    const elementCoverage = area / (rect.width * rect.height);
    const prev = acc.get(entry.name);
    if (!prev) {
      acc.set(entry.name, {
        name: entry.name,
        sides: [side],
        overlap_px: area,
        region_coverage: area / regionArea,
        element_coverage: elementCoverage,
      });
      continue;
    }
    if (!prev.sides.includes(side)) prev.sides.push(side);
    if (area > prev.overlap_px) {
      prev.overlap_px = area;
      prev.region_coverage = area / regionArea;
      prev.element_coverage = elementCoverage;
    }
  }
}

/**
 * 領域に重なる論理名を、region_coverage の大きい順（同じなら element_coverage の大きい順、名前の順）に並べて返す。
 * @param {Rect} bbox
 * @param {{ sides:SideTraits[], scale:number, maskNames:Set<string> }} input
 */
export function overlappingNames(bbox, { sides, scale, maskNames }) {
  /** @type {Map<string, { name:string, sides:Side[], overlap_px:number, region_coverage:number, element_coverage:number }>} */
  const acc = new Map();
  for (const s of sides) {
    if (s.missing) continue;
    collectSideOverlaps(bbox, { side: s.side, entries: s.entries, scale, maskNames }, acc);
  }
  return [...acc.values()]
    .sort(
      (a, b) =>
        b.region_coverage - a.region_coverage ||
        b.element_coverage - a.element_coverage ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    )
    .map((n) => ({
      name: n.name,
      sides: SIDES.filter((side) => n.sides.includes(side)),
      overlap_px: round4(n.overlap_px),
      region_coverage: round4(n.region_coverage),
      element_coverage: round4(n.element_coverage),
    }));
}

/**
 * 面積が正の矩形か（幅も高さも 0 より大きい）。マスクは面積が 0 の要素を塗らない。
 * @param {Rect} r
 * @returns {boolean}
 */
function hasArea(r) {
  return r.width > 0 && r.height > 0;
}

/**
 * 記録したマスクの矩形の縁を、CSS の px の整数に四捨五入する（mask が塗る画素に合わせる）。
 * @param {Rect} r
 * @returns {Rect}
 */
export function snapMaskRect(r) {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  return {
    x,
    y,
    width: Math.round(r.x + r.width) - x,
    height: Math.round(r.y + r.height) - y,
  };
}

/**
 * その側の mask-rects.json が記録した、マスクの論理名の矩形。記録が無ければ null を返す（空の配列とは区別する）。
 * @param {SideMaskRects[]} maskRects
 * @param {Side} side
 * @param {string} name
 * @returns {Rect[] | null}
 */
function recordedMaskRects(maskRects, side, name) {
  const record = maskRects.find((m) => m.side === side);
  if (!record || record.missing) return null;
  return record.byName.get(name) ?? null;
}

/**
 * 1 つの側で、マスクの論理名を画像の画素の矩形に直す。先にその側の mask-rects.json の記録を使い、記録が無ければ traits.json から探す。
 * 位置を決められなければ、reason に理由（名前が無い absent・名前はあるが面積が 0 の zero_area）を入れる。
 * その側の traits.json が無く記録も無いときは、理由を入れない（traits_missing が判定できない理由になる）。
 * @param {string} name
 * @param {SideTraits} s
 * @param {{ scale:number, maskRects:SideMaskRects[] }} input
 * @returns {{ rects:Rect[], reason:("absent"|"zero_area"|null) }}
 */
function locateOnSide(name, s, { scale, maskRects }) {
  const recorded = recordedMaskRects(maskRects, s.side, name);
  if (recorded !== null) {
    const painted = recorded.map(snapMaskRect).filter(hasArea);
    return { rects: painted.map((r) => scaleRect(r, scale)), reason: null };
  }
  if (s.missing) return { rects: [], reason: null };
  const named = s.entries.filter((e) => e.name === name);
  const found = named.filter((e) => hasArea(e.rect));
  if (found.length === 0) return { rects: [], reason: named.length > 0 ? "zero_area" : "absent" };
  return { rects: found.map((e) => scaleRect(e.rect, scale)), reason: null };
}

/**
 * マスクの論理名を、側ごとに矩形に直す（locateOnSide）。位置を決められない名前と側は unlocated に入れる。
 * @param {string[]} names
 * @param {{ sides:SideTraits[], scale:number, maskRects?:SideMaskRects[] }} input
 * @returns {{ areas:MaskArea[], unlocated:Array<{ name:string, side:Side, reason:("absent"|"zero_area") }> }}
 */
export function locateMaskNames(names, { sides, scale, maskRects = [] }) {
  /** @type {MaskArea[]} */
  const areas = [];
  /** @type {Array<{ name:string, side:Side, reason:("absent"|"zero_area") }>} */
  const unlocated = [];
  for (const name of names) {
    /** @type {Record<Side, Rect[]>} */
    const bySide = { current: [], new: [] };
    for (const s of sides) {
      const { rects, reason } = locateOnSide(name, s, { scale, maskRects });
      if (reason !== null) unlocated.push({ name, side: s.side, reason });
      bySide[s.side].push(...rects);
    }
    if (bySide.current.length + bySide.new.length > 0) areas.push({ label: name, bySide });
  }
  return { areas, unlocated };
}

/**
 * 領域がマスクの中か。両側のどちらでも、その側のマスクの矩形の和に全体が覆われるときだけ真にする。
 * 片側のマスクだけで覆われた領域を masked にすると、もう片側の差をマスクの中として隠すからである。
 * @param {Rect} bbox
 * @param {MaskArea[]} masks
 * @returns {boolean}
 */
export function maskedOnBothSides(bbox, masks) {
  return SIDES.every((side) =>
    coveredByUnion(
      bbox,
      masks.flatMap((m) => m.bySide[side]),
    ),
  );
}

/**
 * 判定できない理由を挙げる（traits.json が無い側・見つからないマスクの論理名）。
 * @param {SideTraits[]} sides
 * @param {Array<{ name:string, side:Side }>} unlocated
 * @returns {string[]}
 */
function unresolvedReasons(sides, unlocated) {
  return [
    ...sides.filter((s) => s.missing).map((s) => `traits_missing:${s.side}`),
    ...unlocated.map((u) => `mask_unlocated:${u.side}:${u.name}`),
  ];
}

/**
 * 1 つの領域の状態を決める。
 * @param {Region} region
 * @param {{ sides:SideTraits[], scale:number, masks:MaskArea[], maskNames:Set<string>, reasons:string[] }} input
 */
export function classifyRegion(region, { sides, scale, masks, maskNames, reasons }) {
  const names = overlappingNames(region.bbox, { sides, scale, maskNames });
  const touchedMasks = masks.filter((m) =>
    SIDES.some((side) => m.bySide[side].some((r) => intersectionArea(region.bbox, r) > 0)),
  );
  const masked = maskedOnBothSides(region.bbox, touchedMasks);
  /** @type {"masked" | "named" | "unknown" | "unnamed"} */
  let status = "unnamed";
  if (masked) status = "masked";
  else if (names.length > 0) status = "named";
  else if (reasons.length > 0) status = "unknown";
  return {
    id: region.id,
    kind: region.kind,
    bbox: region.bbox,
    status,
    names,
    masks: touchedMasks.map((m) => m.label),
    unresolved: reasons,
  };
}

/**
 * pixel-crops.mjs の出力から領域を読む。形が違えば理由を返す。
 * @param {unknown} json
 * @returns {{ error:string } | { regions:Region[] }}
 */
export function readRegions(json) {
  if (!isPlainObject(json) || !isArray(json.regions) || !isArray(json.strict_only_regions)) {
    return {
      error: "regions json must have regions[] and strict_only_regions[] (pixel-crops.mjs output)",
    };
  }
  const threshold = readRegionList(json.regions, { kind: "threshold", key: "regions" });
  if ("error" in threshold) return threshold;
  const strict = readRegionList(json.strict_only_regions, {
    kind: "strict_only",
    key: "strict_only_regions",
  });
  if ("error" in strict) return strict;
  return { regions: [...threshold.regions, ...strict.regions] };
}

/**
 * pixel-crops.mjs の出力の 1 つの配列（regions か strict_only_regions）を読む。
 * @param {unknown[]} list
 * @param {{ kind:("threshold"|"strict_only"), key:string }} where
 * @returns {{ error:string } | { regions:Region[] }}
 */
function readRegionList(list, { kind, key }) {
  /** @type {Region[]} */
  const regions = [];
  for (const [i, r] of list.entries()) {
    if (!isPlainObject(r) || !isPixelBbox(r.bbox)) {
      return { error: `${key}[${i}].bbox must be integer x,y >= 0 and width,height >= 1` };
    }
    const id = r.id;
    if (!(typeof id === "number" || nonEmptyString(id))) {
      return { error: `${key}[${i}].id is missing` };
    }
    regions.push({ id, kind, bbox: r.bbox });
  }
  return { regions };
}

/**
 * traits.json の中身を読む。形が違えば理由を返す。
 * @param {unknown} json
 * @param {Side} side
 * @returns {{ error:string } | { entries:NamedRect[] }}
 */
export function readTraits(json, side) {
  if (!isArray(json)) return { error: `${side} traits must be an array (traits.json)` };
  /** @type {NamedRect[]} */
  const entries = [];
  for (const [i, e] of json.entries()) {
    if (!isPlainObject(e) || !nonEmptyString(e.name) || !isRect(e.rect)) {
      return {
        error: `${side} traits[${i}] must have a non-empty name and rect {x,y,width,height}`,
      };
    }
    entries.push({ name: e.name, rect: e.rect });
  }
  return { entries };
}

/**
 * mask-rects.json の中身を読む。形は `[{ name, rects }]` で、rects は矩形の配列である。形が違えば理由を返す。
 * 同じ名前を 2 回記録したものは、どちらの矩形を使うか決まらないので誤りにする。
 * @param {unknown} json
 * @param {Side} side
 * @returns {{ error:string } | { byName:Map<string, Rect[]> }}
 */
export function readMaskRects(json, side) {
  if (!isArray(json)) return { error: `${side} mask rects must be an array (mask-rects.json)` };
  /** @type {Map<string, Rect[]>} */
  const byName = new Map();
  for (const [i, e] of json.entries()) {
    if (!isPlainObject(e) || !nonEmptyString(e.name) || !isArray(e.rects)) {
      return { error: `${side} mask rects[${i}] must have a non-empty name and rects[]` };
    }
    const rects = e.rects;
    if (!rects.every(isRect)) {
      return {
        error: `${side} mask rects[${i}].rects must be {x,y,width,height} with width,height >= 0`,
      };
    }
    if (byName.has(e.name)) {
      return { error: `${side} mask rects[${i}]: "${e.name}" is recorded twice` };
    }
    byName.set(e.name, rects);
  }
  return { byName };
}

/**
 * "x,y,w,h" を画素の矩形に直す。
 * @param {string} text
 * @returns {Rect | null}
 */
export function parseBbox(text) {
  const m = /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/.exec(text);
  if (!m) return null;
  const [x, y, width, height] = m.slice(1).map(Number);
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/**
 * JSON のファイルを読む。読めない（ファイルが無いときを含む）・JSON でなければ理由を返す。
 * ファイルが無いことを traits.json の無い組として扱わない。パスの誤りと区別できないからである。
 * 無い側は、呼び出し元が `--current-traits-missing` か `--new-traits-missing` で宣言する。
 * @param {string} path
 * @returns {{ error:string } | { json:unknown }}
 */
function readJsonFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `cannot read ${path}: ${message}` };
  }
  try {
    return { json: JSON.parse(text) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `cannot parse ${path}: ${message}` };
  }
}

/**
 * 1 つの側の traits.json を読む。path が null なら、その側の traits.json が無いと宣言されている。
 * 渡したパスのファイルが無い・読めない（readJsonFile）ときと、形が違う（readTraits）ときは、missing にせず入力の誤りを返す。
 * @param {string | null} path
 * @param {Side} side
 * @returns {{ error:string } | { value:SideTraits }}
 */
function loadSide(path, side) {
  if (path === null) return { value: { side, missing: true } };
  const read = readJsonFile(path);
  if ("error" in read) return read;
  const parsed = readTraits(read.json, side);
  if ("error" in parsed) return parsed;
  return { value: { side, missing: false, entries: parsed.entries } };
}

/**
 * 1 つの側の mask-rects.json を読む。path が null なら、その側の記録が無いと宣言されている。
 * 渡したパスのファイルが無い・読めない・形が違うときは、missing にせず入力の誤りを返す。
 * @param {string | null} path
 * @param {Side} side
 * @returns {{ error:string } | { value:SideMaskRects }}
 */
function loadMaskRectsSide(path, side) {
  if (path === null) return { value: { side, missing: true } };
  const read = readJsonFile(path);
  if ("error" in read) return read;
  const parsed = readMaskRects(read.json, side);
  if ("error" in parsed) return parsed;
  return { value: { side, missing: false, byName: parsed.byName } };
}

const USAGE =
  "usage: node region-names.mjs <pixel-crops.json> (--current-traits <traits.json> | --current-traits-missing) (--new-traits <traits.json> | --new-traits-missing) --scale <deviceScaleFactor> [--current-mask-rects <mask-rects.json> | --current-mask-rects-missing] [--new-mask-rects <mask-rects.json> | --new-mask-rects-missing] [--mask-name <logical name>]... [--mask-bbox <x,y,w,h>]...\n";

/**
 * 1 つの側のファイル（traits.json か mask-rects.json）の指定を読む。パスと無いことの宣言の両方は受け付けない。
 * required なら、どちらか 1 つを求める（traits.json）。required でなければ、どちらも無い側を無いと宣言した側として扱う
 * （mask-rects.json。この引数を渡さない呼び出し元でも、traits.json だけで判定するため）。
 * @param {{ strings:Record<string, string>, bools:Record<string, true> }} parsed
 * @param {Side} side
 * @param {{ file:("traits"|"mask-rects"), required:boolean }} spec
 * @returns {{ error:string } | { path:(string|null) }}
 */
function sideFileArg(parsed, side, { file, required }) {
  const flag = `--${side}-${file}`;
  const path = parsed.strings[flag];
  const missing = parsed.bools[`${flag}-missing`] === true;
  if (path !== undefined && missing) {
    const count = required ? "exactly" : "at most";
    return { error: `error: give ${count} one of ${flag} and ${flag}-missing\n${USAGE}` };
  }
  if (required && path === undefined && !missing) {
    return { error: `error: give exactly one of ${flag} and ${flag}-missing\n${USAGE}` };
  }
  // 標準入力は読まない。
  if (path === "-") return { error: `error: ${flag} must be a file path (stdin is not read)\n` };
  return { path: path ?? null };
}

/** 受け付ける引数。 */
const FLAG_SPEC = {
  values: [
    "--current-traits",
    "--new-traits",
    "--scale",
    "--mask-name",
    "--mask-bbox",
    "--current-mask-rects",
    "--new-mask-rects",
  ],
  repeat: ["--mask-name", "--mask-bbox"],
  bools: [
    "--current-traits-missing",
    "--new-traits-missing",
    "--current-mask-rects-missing",
    "--new-mask-rects-missing",
  ],
  positionals: 1,
  // 標準入力は読まないので、`-` を位置引数として受け付けない。
  stdin: false,
};

/**
 * 引数を読み、値を確かめる。誤りは stderr に出す文で返す。
 * @param {string[]} argv
 * @returns {{ error:string } | { regionsPath:string, currentTraits:(string|null), newTraits:(string|null), scale:number,
 *   maskBboxes:Rect[], maskNames:string[], currentMaskRects:(string|null), newMaskRects:(string|null) }}
 */
function parseArgs(argv) {
  const parsed = parseFlags(argv, FLAG_SPEC);
  if (parsed.error !== undefined) return { error: `error: ${parsed.error}\n${USAGE}` };
  const regionsPath = parsed.positionals[0];
  const scaleText = parsed.strings["--scale"];
  if (!regionsPath || scaleText === undefined) return { error: USAGE };
  /** @type {{ file:"traits", required:boolean }} */
  const traits = { file: "traits", required: true };
  /** @type {{ file:"mask-rects", required:boolean }} */
  const maskRecords = { file: "mask-rects", required: false };
  const current = sideFileArg(parsed, "current", traits);
  if ("error" in current) return current;
  const next = sideFileArg(parsed, "new", traits);
  if ("error" in next) return next;
  const currentMask = sideFileArg(parsed, "current", maskRecords);
  if ("error" in currentMask) return currentMask;
  const nextMask = sideFileArg(parsed, "new", maskRecords);
  if ("error" in nextMask) return nextMask;
  const scale = Number(scaleText);
  if (!Number.isFinite(scale) || scale <= 0)
    return { error: "error: --scale must be a number > 0\n" };
  /** @type {Rect[]} */
  const maskBboxes = [];
  for (const text of parsed.lists["--mask-bbox"] ?? []) {
    const bbox = parseBbox(text);
    if (!bbox)
      return {
        error: `error: --mask-bbox must be x,y,w,h with w,h >= 1 (got ${JSON.stringify(text)})\n`,
      };
    maskBboxes.push(bbox);
  }
  const maskNames = parsed.lists["--mask-name"] ?? [];
  return {
    regionsPath,
    currentTraits: current.path,
    newTraits: next.path,
    scale,
    maskBboxes,
    maskNames,
    currentMaskRects: currentMask.path,
    newMaskRects: nextMask.path,
  };
}

/**
 * 現側と新側のファイルを、同じ読み込みの関数で読む。誤りは stderr に出す文で返す。
 * @template T
 * @param {[string | null, string | null]} paths - 現側と新側のパス（null は無いと宣言した側）
 * @param {(path:(string|null), side:Side) => ({ error:string } | { value:T })} load
 * @returns {{ error:string } | { loaded:T[] }}
 */
function loadBothSides(paths, load) {
  /** @type {T[]} */
  const loaded = [];
  for (const [i, side] of SIDES.entries()) {
    const result = load(paths[i], side);
    if ("error" in result) return { error: `error: ${result.error}\n` };
    loaded.push(result.value);
  }
  return { loaded };
}

/**
 * 入力のファイルを読む。誤りは stderr に出す文で返す。
 * @param {{ regionsPath:string, currentTraits:(string|null), newTraits:(string|null),
 *   currentMaskRects:(string|null), newMaskRects:(string|null) }} paths
 * @returns {{ error:string } | { regions:Region[], sides:SideTraits[], maskRects:SideMaskRects[] }}
 */
function loadInputs({ regionsPath, currentTraits, newTraits, currentMaskRects, newMaskRects }) {
  const read = readJsonFile(regionsPath);
  if ("error" in read) return { error: `error: ${read.error}\n` };
  const regions = readRegions(read.json);
  if ("error" in regions) return { error: `error: ${regions.error}\n` };
  const sides = loadBothSides([currentTraits, newTraits], loadSide);
  if ("error" in sides) return sides;
  const maskRects = loadBothSides([currentMaskRects, newMaskRects], loadMaskRectsSide);
  if ("error" in maskRects) return maskRects;
  return { regions: regions.regions, sides: sides.loaded, maskRects: maskRects.loaded };
}

/**
 * 領域ごとの結果を数える。
 * @param {Array<{ status:("named" | "unnamed" | "masked" | "unknown") }>} results
 */
function summarize(results) {
  /** @type {Record<"named" | "unnamed" | "masked" | "unknown", number>} */
  const counts = { named: 0, unnamed: 0, masked: 0, unknown: 0 };
  for (const r of results) counts[r.status] += 1;
  return { regions: results.length, ...counts };
}

/**
 * mask-rects.json が記録したのに --mask-name に渡していない名前を、マスクとして使わなかったことを stderr に出す。
 * @param {SideMaskRects[]} maskRects
 * @param {string[]} maskNames
 */
function warnUnusedRecords(maskRects, maskNames) {
  const passed = new Set(maskNames);
  for (const m of maskRects) {
    if (m.missing) continue;
    const unused = [...m.byName.keys()].filter((name) => !passed.has(name));
    for (const name of unused) {
      process.stderr.write(
        `warning: ${m.side} mask-rects.json records "${name}", which is not given with --mask-name; it is not used as a mask\n`,
      );
    }
  }
}

/**
 * 判定できなかったことを stderr に出す。
 * @param {{ sides:SideTraits[], maskRects:SideMaskRects[] }} inputs
 * @param {Array<{ name:string, side:Side, reason:("absent"|"zero_area") }>} unlocated
 * @param {number} unknown
 */
function warnUnresolved({ sides, maskRects }, unlocated, unknown) {
  for (const s of sides) {
    if (s.missing) {
      process.stderr.write(
        `warning: ${s.side} traits.json is missing; regions that overlap no name on the other side are reported as unknown, not as unnamed\n`,
      );
    }
  }
  const recordedSides = new Set(maskRects.filter((m) => !m.missing).map((m) => m.side));
  for (const u of unlocated) {
    const notRecorded = recordedSides.has(u.side)
      ? ` (not recorded in the ${u.side} mask-rects.json)`
      : "";
    const where =
      u.reason === "zero_area"
        ? `has no area (width or height 0) in the ${u.side} traits.json${notRecorded}`
        : `is not in the ${u.side} traits.json${notRecorded}`;
    process.stderr.write(
      `warning: mask "${u.name}" ${where}; regions that overlap no name are reported as unknown\n`,
    );
  }
  if (unknown > 0)
    process.stderr.write(`warning: ${unknown} region(s) could not be mapped (status: unknown)\n`);
}

/**
 * --mask-bbox で渡した画素の矩形を、両側に同じ矩形を当てるマスクにする。
 * @param {Rect} b
 * @returns {MaskArea}
 */
function bboxMask(b) {
  return { label: `${b.x},${b.y},${b.width},${b.height}`, bySide: { current: [b], new: [b] } };
}

/**
 * CLI エントリ。stdout に結果の JSON（キーは version・scale・traits・mask_rects・masks・summary・regions）を出す。
 * @param {string[]} argv
 * @returns {number} exit code
 */
export function main(argv) {
  const args = parseArgs(argv);
  if ("error" in args) {
    process.stderr.write(args.error);
    return 2;
  }
  const inputs = loadInputs(args);
  if ("error" in inputs) {
    process.stderr.write(inputs.error);
    return 2;
  }
  const { regions, sides, maskRects } = inputs;
  const { scale } = args;
  const located = locateMaskNames(args.maskNames, { sides, scale, maskRects });
  /** @type {MaskArea[]} */
  const masks = [...located.areas, ...args.maskBboxes.map(bboxMask)];
  const reasons = unresolvedReasons(sides, located.unlocated);
  const maskNames = new Set(args.maskNames);
  const results = regions.map((r) =>
    classifyRegion(r, { sides, scale, masks, maskNames, reasons }),
  );
  const summary = summarize(results);
  warnUnusedRecords(maskRects, args.maskNames);
  warnUnresolved({ sides, maskRects }, located.unlocated, summary.unknown);
  const out = {
    version: VERSION,
    scale,
    traits: Object.fromEntries(sides.map((s) => [s.side, s.missing ? "missing" : "present"])),
    mask_rects: Object.fromEntries(
      maskRects.map((m) => [m.side, m.missing ? "missing" : "present"]),
    ),
    masks: {
      names: args.maskNames,
      bboxes: args.maskBboxes,
      unlocated: located.unlocated,
    },
    summary,
    regions: results,
  };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  return summary.unknown > 0 ? 1 : 0;
}

if (isCliEntry(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
