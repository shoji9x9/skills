#!/usr/bin/env node
// 部品の寸法を、基準とカタログの見本で突き合わせる（判定の仕方はこのスクリプトで定義する）。
//
// 何のためか: 画素の比較（parity-suite の pixel-strict-count.mjs）は、PNG の寸法が違うと比べずにエラーで止まる。
// 特性の照合（trait-compare.mjs）は要素の対の関係だけを比べ、要素 1 つの幅や高さの差を出さない。
// そのため、部品の幅や高さだけが違うと、差分の一覧に 1 件も載らない。画素の比較が止まったことを、
// 許容として扱って先へ進んだ例もある。このツールは、寸法の差を 1 件ずつの差分として出す。
//
// 比べるもの: 比較の母集合（metadata.json の instances[] × capture.states から、宣言済みの
// unreachable_states を除いた組）のすべてについて、次の 2 つの element.shot.json を読む。
//   - 基準: <部品の成果物ディレクトリ>/baseline/<instance>/<state>/element.shot.json
//   - 見本: <カタログの採取ディレクトリ>/<instance>/<state>/element.shot.json
// 判定は png.width と png.height の完全一致で行う。画素の比較が要るのはこの一致だからである。
// page_rect（最上位の座標の矩形。element-shot.mjs はこれを丸めて切り抜く）の幅と高さは、
// 差の大きさ（1px 未満の差が丸めで 1px になったのか、など）を読むための診断として添える。
//
// 判定できない入力は、合格として扱わずに exit 2 にする。
//   - metadata.json を読めない、instances か capture.states が空、id と状態名がパスの 1 セグメントとして不正、id の重複
//   - unreachable_states の宣言が { state, reason }（reason は空でない）の形でない、capture.states に無い状態を宣言している
//   - 組の element.shot.json が片側に無い・読めない、png の幅と高さが正の整数でない、tool_version が無いか両側で違う
//   - 母集合に無い組の見本がカタログの側にある（基準の無い見本）、カタログの一覧を読めない
//   - カタログの採取ディレクトリが基準の baseline/ そのものか、その中を指す（基準を基準と比べて一致してしまう）
// 寸法の差（size-mismatch）は、exit 2 のときも出力に含める。直す箇所を、構造の誤りを直す前に読めるようにするためである。
// 比べた組が 0 件のときも exit 2 にする（nothing-compared）。0 件になる入力は、上の metadata.json の検査
// （どのインスタンスでも到達できない状態を含む）が先に止めるので、この分岐は 0 件を合格にしないための防御である。
//
// 決定論的: 乱数・現在時刻・ネットワークに依存しない。読むのは JSON とディレクトリの一覧だけである。
//
// 使い方: node shot-size-compare.mjs --baseline <部品の成果物ディレクトリ> --catalog <カタログの採取ディレクトリ>
// 終了コード: 0 ＝ すべての組で寸法が一致、1 ＝ 寸法の差がある、2 ＝ 使い方の誤り・判定できない入力。

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { cliIo, usageFailer, writeCheckResult } from "./lib/check-cli.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import { parseFlags } from "./lib/flags.mjs";
import { field, isFiniteNumber, nonEmptyString, safeSegment } from "./lib/guards.mjs";
import { isArray } from "./lib/is-array.mjs";

/** ツールのバージョン（このスクリプトで定義する）。判定の規則・出力の形を変えたら上げる。 */
export const VERSION = "1";

/** 撮影の記録のファイル名（parity-suite の element-shot.mjs が PNG の隣に書く）。 */
const SHOT_FILE = "element.shot.json";

/**
 * 指摘 1 件。code は必ずあり、ほかの欄は code ごとに付く。
 * @typedef {{
 *   code: string,
 *   detail?: string,
 *   instance?: string,
 *   state?: string,
 *   side?: "baseline" | "catalog",
 *   axis?: "width" | "height",
 *   baseline?: number,
 *   catalog?: number,
 *   page_rect?: { baseline: RectSize | null, catalog: RectSize | null },
 * }} SizeFinding
 */

/** @typedef {{ width: number, height: number }} RectSize */

/**
 * 読んだ撮影の記録のうち、判定と診断に使う値。
 * @typedef {{ png: { width: number, height: number }, pageRect: RectSize | null, toolVersion: string }} Shot
 */

/**
 * 正の整数か（PNG の画素数として読める値か）。
 * @param {unknown} v
 * @returns {v is number}
 */
function isPositiveInteger(v) {
  return isFiniteNumber(v) && Number.isInteger(v) && v > 0;
}

/**
 * child が parent の中（parent 自身を含めない）か。両辺とも実パスで渡す。
 * @param {string} parent
 * @param {string} child
 */
function isStrictlyInside(parent, child) {
  const rel = relative(parent, child);
  return !(rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

/**
 * 根の下のファイルを読む関数を作る。解決後のパスが根の外を指せば投げる（リンク経由で外のファイルを読ませない）。
 * 根の実パスは、最初に読むときに 1 回だけ解決する。
 * @param {string} root
 * @returns {(segments: string[]) => string} ファイルの中身を返す
 */
function insideReader(root) {
  /** @type {string | undefined} */
  let realRoot;
  return (segments) => {
    realRoot ??= realpathSync(root);
    const realPath = realpathSync(resolve(root, ...segments));
    if (!isStrictlyInside(realRoot, realPath)) {
      throw new Error(`採取物のパスが ${root} の外を指す: ${realPath}`);
    }
    return readFileSync(realPath, "utf8");
  };
}

/**
 * 撮影の記録 1 件を読んで形を確かめる。読めないか形が違えば、理由の文を返す。
 * @param {(segments: string[]) => string} read insideReader が作った関数
 * @param {string} instance
 * @param {string} state
 * @returns {Shot | string}
 */
function readShot(read, instance, state) {
  let record;
  try {
    record = JSON.parse(read([instance, state, SHOT_FILE]));
  } catch (error) {
    return `${SHOT_FILE} を読めない: ${String(field(error, "message"))}`;
  }
  const png = field(record, "png");
  const width = field(png, "width");
  const height = field(png, "height");
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
    return `png の width と height が正の整数でない（${JSON.stringify(png)}）`;
  }
  const toolVersion = field(record, "tool_version");
  if (!nonEmptyString(toolVersion)) return "tool_version が無い";
  return { png: { width, height }, pageRect: rectSize(field(record, "page_rect")), toolVersion };
}

/**
 * 診断に添える page_rect の幅と高さ。読めなければ null（判定には使わない）。
 * @param {unknown} rect
 * @returns {RectSize | null}
 */
function rectSize(rect) {
  const width = field(rect, "width");
  const height = field(rect, "height");
  return isFiniteNumber(width) && isFiniteNumber(height) ? { width, height } : null;
}

/**
 * 1 つのインスタンスの unreachable_states から、宣言された状態の名前を読む。形が違う宣言は指摘に積む。
 * @param {{ instance: unknown, id: string, states: string[], findings: SizeFinding[] }} arg
 * @returns {Set<string>}
 */
function declaredUnreachable({ instance, id, states, findings }) {
  /** @type {Set<string>} */
  const names = new Set();
  const declared = field(instance, "unreachable_states");
  if (declared === undefined) return names;
  if (!isArray(declared)) {
    findings.push({ code: "unreachable-invalid", instance: id, detail: "配列でない" });
    return names;
  }
  for (const d of declared) {
    const state = field(d, "state");
    if (!nonEmptyString(state) || !nonEmptyString(field(d, "reason"))) {
      findings.push({
        code: "unreachable-invalid",
        instance: id,
        detail: "{ state, reason } の形でない（reason は空でない文字列）",
      });
    } else if (!states.includes(state)) {
      findings.push({
        code: "unreachable-unknown-state",
        instance: id,
        state,
        detail: "capture.states に無い状態を宣言している",
      });
    } else names.add(state);
  }
  return names;
}

/**
 * metadata.json から比較の母集合を作る。判定できない形は指摘に積む。
 * @param {unknown} metadata
 * @param {SizeFinding[]} findings
 * @returns {{ pairs: { instance: string, state: string }[], excluded: { instance: string, state: string }[] }}
 */
function population(metadata, findings) {
  const declaredStates = field(field(metadata, "capture"), "states");
  const declaredInstances = field(metadata, "instances");
  const states = isArray(declaredStates) ? declaredStates : [];
  const instances = isArray(declaredInstances) ? declaredInstances : [];
  if (states.length === 0) findings.push({ code: "states-empty", detail: "capture.states が空" });
  if (instances.length === 0) findings.push({ code: "instances-empty", detail: "instances が空" });
  const stateNames = readStateNames(states, findings);
  /** @type {{ instance: string, state: string }[]} */
  const pairs = [];
  /** @type {{ instance: string, state: string }[]} */
  const excluded = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const instance of instances) {
    const id = field(instance, "id");
    if (!safeSegment(id) || seen.has(id)) {
      findings.push({ code: "instance-invalid", detail: `id が不正か重複: ${JSON.stringify(id)}` });
      continue;
    }
    seen.add(id);
    const unreachable = declaredUnreachable({ instance, id, states: stateNames, findings });
    for (const state of stateNames) {
      (unreachable.has(state) ? excluded : pairs).push({ instance: id, state });
    }
  }
  checkUnreachableEverywhere({ stateNames, pairs, excluded, findings });
  return { pairs, excluded };
}

/**
 * capture.states から状態名を読む。パスの 1 セグメントとして不正な名前と、重複した名前は指摘に積んで除く。
 * 重複を通すと、同じ組を 2 回比べて、比べた組の数が母集合の組の数と合わなくなる。
 * @param {unknown[]} states
 * @param {SizeFinding[]} findings
 * @returns {string[]}
 */
function readStateNames(states, findings) {
  /** @type {string[]} */
  const names = [];
  for (const st of states) {
    if (!safeSegment(st)) {
      findings.push({ code: "state-invalid", detail: `状態名が不正: ${JSON.stringify(st)}` });
    } else if (names.includes(st)) {
      findings.push({ code: "state-invalid", detail: `状態名が重複している: ${st}` });
    } else names.push(st);
  }
  return names;
}

/**
 * すべてのインスタンスが到達できないと宣言した状態を指摘に積む。
 * その状態は比較の母集合に 1 組も残らないので、採取条件から外すべき状態か、状態名の誤りである
 * （axis-diff.mjs も同じ形を問題として止める）。除外として通さない。
 * @param {{ stateNames: string[], pairs: { state: string }[], excluded: { state: string }[], findings: SizeFinding[] }} arg
 */
function checkUnreachableEverywhere({ stateNames, pairs, excluded, findings }) {
  for (const state of stateNames) {
    if (excluded.some((e) => e.state === state) && !pairs.some((p) => p.state === state)) {
      findings.push({
        code: "unreachable-everywhere",
        state,
        detail:
          "どのインスタンスでも到達できないと宣言されている。採取条件から外すか、状態名を確かめる",
      });
    }
  }
}

/**
 * カタログの側にある組（<instance>/<state>/ のディレクトリ）を一覧にする。
 * element.shot.json の有無では絞らない。element.png や traits.json だけを置いた余分な見本も、組として数える。
 * 一覧を読めない（リンク先が無い・権限が無い）ときは投げる。呼び出し側が判定できない入力として扱う。
 * @param {string} catalogRoot
 * @returns {{ instance: string, state: string }[]}
 */
function catalogPairs(catalogRoot) {
  const found = [];
  for (const instance of readdirSync(catalogRoot)) {
    const instanceDir = join(catalogRoot, instance);
    if (!statSync(instanceDir).isDirectory()) continue;
    for (const state of readdirSync(instanceDir)) {
      if (statSync(join(instanceDir, state)).isDirectory()) found.push({ instance, state });
    }
  }
  return found;
}

/**
 * カタログの側の組のうち、比較の母集合に無いものを指摘に積む。一覧を読めなければ、それも指摘に積む。
 * @param {{ catalogDir: string, pairs: { instance: string, state: string }[], findings: SizeFinding[] }} arg
 */
function checkCatalogExtras({ catalogDir, pairs, findings }) {
  // 到達不能と宣言した組には見本を作らない（references/catalog.md）ので、その組の見本も母集合の外として数える。
  const keys = new Set(pairs.map((p) => `${p.instance}/${p.state}`));
  let found;
  try {
    found = catalogPairs(catalogDir);
  } catch (error) {
    const detail = `カタログの側の一覧を読めない: ${String(field(error, "message"))}`;
    findings.push({ code: "catalog-unreadable", detail });
    return;
  }
  for (const extra of found) {
    if (!keys.has(`${extra.instance}/${extra.state}`)) {
      findings.push({
        code: "sample-without-baseline",
        ...extra,
        detail: "比較の母集合に無い組の見本がある（基準の無い見本か、到達不能と宣言した組）",
      });
    }
  }
}

/**
 * 1 つの組について、両側の記録を読んで寸法を比べる。
 * @param {{ pair: { instance: string, state: string }, readers: { baseline: (segments: string[]) => string, catalog: (segments: string[]) => string }, findings: SizeFinding[] }} arg
 * @returns {boolean} 判定できる記録が両側にそろったか
 */
function comparePair({ pair, readers, findings }) {
  const { instance, state } = pair;
  const baseline = readShot(readers.baseline, instance, state);
  const catalog = readShot(readers.catalog, instance, state);
  /** @type {Array<["baseline" | "catalog", Shot | string]>} */
  const sides = [
    ["baseline", baseline],
    ["catalog", catalog],
  ];
  for (const [side, shot] of sides) {
    if (typeof shot === "string")
      findings.push({ code: "shot-unreadable", instance, state, side, detail: shot });
  }
  if (typeof baseline === "string" || typeof catalog === "string") return false;
  if (baseline.toolVersion !== catalog.toolVersion) {
    findings.push({
      code: "shot-version-mismatch",
      instance,
      state,
      detail: `element-shot の tool_version が違う（基準 ${baseline.toolVersion}、見本 ${catalog.toolVersion}）`,
    });
    return false;
  }
  /** @type {Array<"width" | "height">} */
  const axes = ["width", "height"];
  for (const axis of axes) {
    if (baseline.png[axis] !== catalog.png[axis]) {
      findings.push({
        code: "size-mismatch",
        instance,
        state,
        axis,
        baseline: baseline.png[axis],
        catalog: catalog.png[axis],
        page_rect: { baseline: baseline.pageRect, catalog: catalog.pageRect },
      });
    }
  }
  return true;
}

/**
 * カタログの採取ディレクトリが、基準の baseline/ そのものか、その中を指していれば指摘に積む。
 * 取り違えると、基準を基準自身と比べて全組が一致し、見本を 1 件も撮っていないのに exit 0 になる。
 * 実パスを解決できなければ確かめない。基準の baseline/ が無ければ、どの組も記録を読めず shot-unreadable で止まる。
 * カタログの側は、main がディレクトリが在ることを確かめてから渡す。
 * @param {{ baselineRoot: string, catalogDir: string, findings: SizeFinding[] }} arg
 */
function checkCatalogNotBaseline({ baselineRoot, catalogDir, findings }) {
  let realBaseline;
  let realCatalog;
  try {
    realBaseline = realpathSync(baselineRoot);
    realCatalog = realpathSync(catalogDir);
  } catch {
    return;
  }
  if (realCatalog === realBaseline || isStrictlyInside(realBaseline, realCatalog)) {
    findings.push({
      code: "catalog-is-baseline",
      detail: `カタログの採取ディレクトリが基準の baseline/ を指す: ${catalogDir}`,
    });
  }
}

/**
 * 基準とカタログの寸法を突き合わせる。
 * @param {{ baselineDir: string, catalogDir: string }} dirs
 * @returns {{ structural: boolean, findings: SizeFinding[], compared: number, excluded: { instance: string, state: string }[] }}
 */
export function compareShotSizes({ baselineDir, catalogDir }) {
  /** @type {SizeFinding[]} */
  const structuralFindings = [];
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(join(baselineDir, "metadata.json"), "utf8"));
  } catch (error) {
    const detail = `metadata.json を読めない: ${String(field(error, "message"))}`;
    return {
      structural: true,
      findings: [{ code: "metadata-unreadable", detail }],
      compared: 0,
      excluded: [],
    };
  }
  const { pairs, excluded } = population(metadata, structuralFindings);
  const baselineRoot = join(baselineDir, "baseline");
  checkCatalogNotBaseline({ baselineRoot, catalogDir, findings: structuralFindings });
  checkCatalogExtras({ catalogDir, pairs, findings: structuralFindings });
  /** @type {SizeFinding[]} */
  const sizeFindings = [];
  const readers = { baseline: insideReader(baselineRoot), catalog: insideReader(catalogDir) };
  let compared = 0;
  for (const pair of pairs) {
    /** @type {SizeFinding[]} */
    const shotFindings = [];
    if (comparePair({ pair, readers, findings: shotFindings })) compared += 1;
    for (const f of shotFindings)
      (f.code === "size-mismatch" ? sizeFindings : structuralFindings).push(f);
  }
  if (structuralFindings.length === 0 && compared === 0) {
    structuralFindings.push({ code: "nothing-compared", detail: "比べた組が 0 件" });
  }
  if (structuralFindings.length > 0) {
    // 寸法の差も一緒に出す。構造の誤りを直す前に、比べ終えた組の差を読めるようにする（終了コードは 2 のまま）。
    return {
      structural: true,
      findings: [...structuralFindings, ...sizeFindings],
      compared,
      excluded,
    };
  }
  return { structural: false, findings: sizeFindings, compared, excluded };
}

/**
 * ディレクトリとして在るか。
 * @param {string} path
 */
function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * CLI 本体。
 * @param {string[]} argv
 * @param {{ cwd?: string, write?: (s: string) => void, writeErr?: (s: string) => void }} [io]
 * @returns {number} 終了コード
 */
export function main(argv, io = {}) {
  const { cwd, write, writeErr } = cliIo(io);
  const fail = usageFailer(
    writeErr,
    "usage: shot-size-compare.mjs --baseline <部品の成果物ディレクトリ> --catalog <カタログの採取ディレクトリ>",
  );
  const parsed = parseFlags(argv, { values: ["--baseline", "--catalog"] });
  if (parsed.error !== undefined) return fail(parsed.error);
  const baseline = parsed.strings["--baseline"];
  const catalog = parsed.strings["--catalog"];
  if (baseline === undefined || catalog === undefined) {
    return fail("--baseline と --catalog は必須");
  }
  const baselineDir = resolve(cwd, baseline);
  const catalogDir = resolve(cwd, catalog);
  for (const [name, dir] of [
    ["--baseline", baselineDir],
    ["--catalog", catalogDir],
  ]) {
    if (!isDirectory(dir)) return fail(`${name} のディレクトリが無い: ${dir}`);
  }
  const result = compareShotSizes({ baselineDir, catalogDir });
  return writeCheckResult(write, result, {
    tool: "shot-size-compare",
    version: VERSION,
    fields: { compared: result.compared, excluded: result.excluded },
  });
}

if (isCliEntry(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
