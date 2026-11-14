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
// 判定できない領域を「重なる論理名なし」にしない。
// - traits.json が無い側がある組で、どの論理名とも重ならない領域は status: "unknown" にする
// - マスクの論理名を traits.json で見つけられない組で、どの論理名とも重ならない領域も status: "unknown" にする
// - 領域がすべてマスクの中にある（マスクの矩形の和に覆われる）なら status: "masked" にする。
//   片側でしか位置を確かめられなかったマスクの論理名は、この矩形の和に入れない
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
export const VERSION = "1";

/** @typedef {{ x:number, y:number, width:number, height:number }} Rect */
/** @typedef {"current" | "new"} Side */
/** @typedef {{ name:string, rect:Rect }} NamedRect */
/** @typedef {{ id:(string|number), kind:("threshold"|"strict_only"), bbox:Rect }} Region */
/**
 * 側ごとの traits.json。missing は、ファイルが無いことを表す（読めない・形の誤りは入力の誤りにする）。
 * @typedef {{ side:Side, missing:true } | { side:Side, missing:false, entries:NamedRect[] }} SideTraits
 */
/**
 * マスクの矩形。partial は、マスクの論理名の位置を片側でしか確かめられなかったこと（その側の traits.json が無いか、
 * その側の traits.json に名前が無い）を表す。片側の位置だけでは、もう片側でマスクが当たったかを判定できない。
 * @typedef {{ label:string, rects:Rect[], partial?:boolean }} MaskArea
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
 * マスクの論理名を、各側の traits.json で矩形に直す。traits.json がある側で見つからない名前は unlocated に入れる。
 * @param {string[]} names
 * @param {{ sides:SideTraits[], scale:number }} input
 * @returns {{ areas:MaskArea[], unlocated:Array<{ name:string, side:Side }> }}
 */
export function locateMaskNames(names, { sides, scale }) {
  /** @type {MaskArea[]} */
  const areas = [];
  /** @type {Array<{ name:string, side:Side }>} */
  const unlocated = [];
  for (const name of names) {
    /** @type {Rect[]} */
    const rects = [];
    let partial = false;
    for (const s of sides) {
      if (s.missing) {
        partial = true;
        continue;
      }
      const found = s.entries.filter(
        (e) => e.name === name && e.rect.width > 0 && e.rect.height > 0,
      );
      if (found.length === 0) {
        unlocated.push({ name, side: s.side });
        partial = true;
      }
      rects.push(...found.map((e) => scaleRect(e.rect, scale)));
    }
    if (rects.length > 0) areas.push({ label: name, rects, partial });
  }
  return { areas, unlocated };
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
    m.rects.some((r) => intersectionArea(region.bbox, r) > 0),
  );
  // 片側でしか位置を確かめられなかったマスクは、覆うかの判定に使わない（もう片側の差をマスクの中として隠さない）。
  const masked = coveredByUnion(
    region.bbox,
    touchedMasks.filter((m) => !m.partial).flatMap((m) => m.rects),
  );
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
 * JSON のファイルを読む。ファイルが無ければ missing を返し、読めない・JSON でなければ理由を返す。
 * @param {string} path
 * @returns {{ missing:true } | { error:string } | { json:unknown }}
 */
function readJsonFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if (isPlainObject(err) && err.code === "ENOENT") return { missing: true };
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
 * 1 つの側の traits.json を読む。
 * @param {string} path
 * @param {Side} side
 * @returns {{ error:string } | SideTraits}
 */
function loadSide(path, side) {
  const read = readJsonFile(path);
  if ("missing" in read) return { side, missing: true };
  if ("error" in read) return read;
  const parsed = readTraits(read.json, side);
  if ("error" in parsed) return parsed;
  return { side, missing: false, entries: parsed.entries };
}

const USAGE =
  "usage: node region-names.mjs <pixel-crops.json> --current-traits <traits.json> --new-traits <traits.json> --scale <deviceScaleFactor> [--mask-name <logical name>]... [--mask-bbox <x,y,w,h>]...\n";

/**
 * 引数を読み、値を確かめる。誤りは stderr に出す文で返す。
 * @param {string[]} argv
 * @returns {{ error:string } | { regionsPath:string, currentTraits:string, newTraits:string, scale:number,
 *   maskBboxes:Rect[], maskNames:string[] }}
 */
function parseArgs(argv) {
  const parsed = parseFlags(argv, {
    values: ["--current-traits", "--new-traits", "--scale", "--mask-name", "--mask-bbox"],
    repeat: ["--mask-name", "--mask-bbox"],
    positionals: 1,
  });
  if (parsed.error !== undefined) return { error: `error: ${parsed.error}\n${USAGE}` };
  const regionsPath = parsed.positionals[0];
  const currentTraits = parsed.strings["--current-traits"];
  const newTraits = parsed.strings["--new-traits"];
  const scaleText = parsed.strings["--scale"];
  if (!regionsPath || !currentTraits || !newTraits || scaleText === undefined)
    return { error: USAGE };
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
  return { regionsPath, currentTraits, newTraits, scale, maskBboxes, maskNames };
}

/**
 * 入力のファイルを読む。誤りは stderr に出す文で返す。
 * @param {{ regionsPath:string, currentTraits:string, newTraits:string }} paths
 * @returns {{ error:string } | { regions:Region[], sides:SideTraits[] }}
 */
function loadInputs({ regionsPath, currentTraits, newTraits }) {
  const read = readJsonFile(regionsPath);
  if ("missing" in read) return { error: `error: cannot read ${regionsPath}: not found\n` };
  if ("error" in read) return { error: `error: ${read.error}\n` };
  const regions = readRegions(read.json);
  if ("error" in regions) return { error: `error: ${regions.error}\n` };
  /** @type {SideTraits[]} */
  const sides = [];
  /** @type {Array<[Side, string]>} */
  const files = [
    ["current", currentTraits],
    ["new", newTraits],
  ];
  for (const [side, path] of files) {
    const loaded = loadSide(path, side);
    if ("error" in loaded) return { error: `error: ${loaded.error}\n` };
    sides.push(loaded);
  }
  return { regions: regions.regions, sides };
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
 * 判定できなかったことを stderr に出す。
 * @param {SideTraits[]} sides
 * @param {Array<{ name:string, side:Side }>} unlocated
 * @param {number} unknown
 */
function warnUnresolved(sides, unlocated, unknown) {
  for (const s of sides) {
    if (s.missing) {
      process.stderr.write(
        `warning: ${s.side} traits.json is missing; regions that overlap no name on the other side are reported as unknown, not as unnamed\n`,
      );
    }
  }
  for (const u of unlocated) {
    process.stderr.write(
      `warning: mask "${u.name}" is not in the ${u.side} traits.json; regions that overlap no name are reported as unknown\n`,
    );
  }
  if (unknown > 0)
    process.stderr.write(`warning: ${unknown} region(s) could not be mapped (status: unknown)\n`);
}

/**
 * CLI エントリ。stdout に結果の JSON（キーは version・scale・traits・masks・summary・regions）を出す。
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
  const { regions, sides } = inputs;
  const { scale } = args;
  const located = locateMaskNames(args.maskNames, { sides, scale });
  /** @type {MaskArea[]} */
  const masks = [
    ...located.areas,
    ...args.maskBboxes.map((b) => ({ label: `${b.x},${b.y},${b.width},${b.height}`, rects: [b] })),
  ];
  const reasons = unresolvedReasons(sides, located.unlocated);
  const maskNames = new Set(args.maskNames);
  const results = regions.map((r) =>
    classifyRegion(r, { sides, scale, masks, maskNames, reasons }),
  );
  const summary = summarize(results);
  warnUnresolved(sides, located.unlocated, summary.unknown);
  const out = {
    version: VERSION,
    scale,
    traits: Object.fromEntries(sides.map((s) => [s.side, s.missing ? "missing" : "present"])),
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
