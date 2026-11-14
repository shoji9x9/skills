// 承認する人が見る HTML のレポートを作る（原本）。
// 原本はこのスキルの中にあり、スキルのディレクトリから直接実行する。プロジェクトへはコピーしない。
//
// レポートは diff.md と diff-metadata.json から作る表示である。分類と承認の記録ではない。
// 分類と承認は、diff.md・diff-metadata.json・承認の記録（component-diff-exceptions.md など）に残る。
// レポートを書き換えても記録は変わらず、記録を直したらレポートを作り直す。
//
// 組（ページ・状態・ビューポート）ごとに、現行と新側のスクリーンショットを並べ、region-names.mjs の出力の
// 領域の bbox を画像の上に描く。diff.md の差分一覧の行のうち、比較方法が「画素」で組が同じ行を選ぶ。
// そのうち位置の欄に「x,y,w,h」で書いた bbox が一致する行を、その領域に結ぶ。結んだ行の ID を画像の上に出し、
// ID から分類と根拠の行へ移れるようにする。結べなかった行と領域は、別の表に出す（警告なしに捨てない）。
//
// 画像は data: URI で埋め込み、外部の資源を読み込まない。スクリプトは書かず、CSP で読み込みを止める。
// 画像以外の文字（論理名・分類・根拠・パス）は、すべて HTML の文字参照にしてから埋め込む。
// 依存は Node.js だけである（PNG の寸法は IHDR を読んで取る）。TypeScript の構文は使わない（型は JSDoc で書く）。

import { readFileSync, writeFileSync } from "node:fs";
import { isCliEntry } from "./lib/cli.mjs";
import { parseFlags } from "./lib/flags.mjs";
import { isPlainObject, nonEmptyString } from "./lib/guards.mjs";
import { isArray } from "./lib/is-array.mjs";

/**
 * ツールのバージョン（原本）。結び方や出力の形を変えたら上げる。
 * @type {string}
 */
export const VERSION = "1";

/** @typedef {{ x:number, y:number, width:number, height:number }} Rect */
/**
 * diff.md の差分一覧の 1 行。
 * @typedef {{ id:string, method:string, page:string, state:string, viewport:string, position:string,
 *   content:string, normalized:string, classification:string, evidence:string }} DiffRow
 */
/**
 * region-names.mjs の出力の 1 領域。
 * @typedef {{ id:string, kind:string, bbox:Rect, status:string,
 *   names:Array<{ name:string, region_coverage:number, element_coverage:number }>,
 *   masks:string[], unresolved:string[] }} MappedRegion
 */
/** @typedef {{ page:string, state:string, viewport:string, current:string, new:string, regions:string }} PairSpec */
/** @typedef {{ slug:string, target:string, converged:string, results:string }} MetaSummary */

/** 差分一覧の列（見出しの先頭の語 → 行の欄）。 */
const COLUMNS = /** @type {const} */ ([
  ["ID", "id"],
  ["比較方法", "method"],
  ["ページ", "page"],
  ["状態", "state"],
  ["ビューポート", "viewport"],
  ["位置", "position"],
  ["内容", "content"],
  ["正規化結果", "normalized"],
  ["分類", "classification"],
  ["根拠", "evidence"],
]);

const STATUSES = new Set(["named", "unnamed", "masked", "unknown"]);

/**
 * HTML の文字参照にする。本文と属性の値のどちらにも使える。
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Markdown の表の 1 行を欄に分ける。`\|` は区切りにしない。
 * @param {string} line
 * @returns {string[]}
 */
export function splitTableRow(line) {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);
  /** @type {string[]} */
  const cells = [];
  let cell = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "\\" && body[i + 1] === "|") {
      cell += "|";
      i += 1;
    } else if (ch === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

/**
 * 差分一覧の節の本文を返す。節の見出しは「差分一覧」を含む `## ` の行で、次の `## ` の行の前までが本文である。
 * HTML コメントは、行の単位ではなく本文の文字列から先に取り除く。行の単位で読み飛ばすと、`-->` の後ろに続く表の行を捨てる。
 * 閉じていないコメントは、どこまでがコメントかを決められないので誤りにする。
 * @param {string} markdown
 * @returns {{ error:string } | { lines:string[] }}
 */
function sectionBody(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s/.test(l) && l.includes("差分一覧"));
  if (start < 0) return { error: "diff.md has no section heading with 差分一覧" };
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  const text = (end < 0 ? rest : rest.slice(0, end)).join("\n").replace(/<!--[\s\S]*?-->/g, "");
  if (text.includes("<!--"))
    return { error: "diff.md section 差分一覧 has an unclosed HTML comment" };
  return { lines: text.split("\n") };
}

/**
 * 差分一覧の節の表の行を返す。空行は読み飛ばし、表の途中にあっても後の行を読む（警告なしに後半の行を捨てない）。
 * 表が始まった後に表でも空行でもない文があり、その後にまた表の行があれば、どの表の行かを決められないので誤りにする。
 * @param {string} markdown
 * @returns {{ error:string } | { lines:string[] }}
 */
function sectionTableLines(markdown) {
  const body = sectionBody(markdown);
  if ("error" in body) return body;
  /** @type {string[]} */
  const table = [];
  let interrupted = false;
  for (const line of body.lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (!trimmed.startsWith("|")) {
      if (table.length > 0) interrupted = true;
      continue;
    }
    if (interrupted) return { error: "diff.md section 差分一覧 has table rows after other text" };
    table.push(line);
  }
  if (table.length < 2) return { error: "diff.md section 差分一覧 has no table" };
  return { lines: table };
}

/**
 * 表の区切りの行（どの欄も `-` を 1 つ以上持ち、`:` と `-` だけでできている）か。すべての欄が空の行は区切りではない。
 * @param {string} line
 * @returns {boolean}
 */
export function isSeparatorRow(line) {
  return splitTableRow(line).every((cell) => /^:?-+:?$/.test(cell));
}

/**
 * 欄の前後のバッククォート（コードの書式）を外す。ページ・状態・ビューポートを組と比べるときに使う。
 * @param {string} text
 * @returns {string}
 */
function stripCode(text) {
  const m = /^`([^`]*)`$/.exec(text);
  return m ? m[1].trim() : text;
}

/**
 * 見出しの欄から、列の位置を決める。足りない列があれば理由を返す。
 * @param {string[]} header
 * @returns {{ error:string } | { index:Map<keyof DiffRow, number> }}
 */
function columnIndex(header) {
  /** @type {Map<keyof DiffRow, number>} */
  const index = new Map();
  for (const [label, key] of COLUMNS) {
    const i = header.findIndex((h) => h.startsWith(label));
    if (i < 0) return { error: `diff.md 差分一覧 has no column ${label}` };
    index.set(key, i);
  }
  return { index };
}

/**
 * diff.md の差分一覧の行を読む。
 * @param {string} markdown
 * @returns {{ error:string } | { rows:DiffRow[] }}
 */
export function parseDiffRows(markdown) {
  const section = sectionTableLines(markdown);
  if ("error" in section) return section;
  const [headerLine, separator, ...body] = section.lines;
  if (!isSeparatorRow(separator)) {
    return { error: "diff.md 差分一覧 table has no separator row" };
  }
  const columns = columnIndex(splitTableRow(headerLine));
  if ("error" in columns) return columns;
  // 空行やコメントの後に、別の表の見出しと区切りの行が続いていれば、その表の行を差分一覧の行として読まない。
  if (body.some((line) => isSeparatorRow(line))) {
    return { error: "diff.md section 差分一覧 has more than one table" };
  }
  const rows = body.map((line) => {
    const cells = splitTableRow(line);
    const cell = (/** @type {keyof DiffRow} */ key) => cells[columns.index.get(key) ?? -1] ?? "";
    /** @type {DiffRow} */
    const row = {
      id: cell("id"),
      method: cell("method"),
      page: stripCode(cell("page")),
      state: stripCode(cell("state")),
      viewport: stripCode(cell("viewport")),
      position: cell("position"),
      content: cell("content"),
      normalized: cell("normalized"),
      classification: cell("classification"),
      evidence: cell("evidence"),
    };
    return row;
  });
  return { rows };
}

/**
 * 位置の欄に書いた bbox（「x,y,w,h」の形）をすべて返す。
 * 小数の一部は bbox の数として読まない。例えば「40.5」の 5 と「30.5」の 30 は読まない。
 * @param {string} text
 * @returns {Rect[]}
 */
export function bboxesInText(text) {
  const pattern = /(?<![\d.])(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?!\.?\d)/g;
  return [...text.matchAll(pattern)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    width: Number(m[3]),
    height: Number(m[4]),
  }));
}

/**
 * 行がその組のその領域を指すか。
 * @param {DiffRow} row
 * @param {{ page:string, state:string, viewport:string }} pair
 * @param {Rect} bbox
 * @returns {boolean}
 */
export function rowMatchesRegion(row, pair, bbox) {
  if (!row.method.includes("画素")) return false;
  if (row.page !== pair.page || row.state !== pair.state || row.viewport !== pair.viewport) {
    return false;
  }
  return bboxesInText(row.position).some(
    (b) => b.x === bbox.x && b.y === bbox.y && b.width === bbox.width && b.height === bbox.height,
  );
}

/**
 * PNG の寸法を IHDR から読む。PNG でなければ null を返す。
 * @param {Uint8Array} bytes
 * @returns {{ width:number, height:number } | null}
 */
export function pngSize(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || !signature.every((b, i) => bytes[i] === b)) return null;
  const ihdr = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (ihdr !== "IHDR") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) return null;
  return { width, height };
}

/**
 * region-names.mjs の出力の 1 領域を確かめる。
 * @param {unknown} r
 * @returns {r is MappedRegion}
 */
function isMappedRegion(r) {
  if (!isPlainObject(r) || !isPlainObject(r.bbox)) return false;
  const { x, y, width, height } = r.bbox;
  const bboxOk =
    [x, y, width, height].every((v) => Number.isInteger(v)) &&
    Number(width) > 0 &&
    Number(height) > 0;
  return (
    bboxOk &&
    (typeof r.id === "number" || nonEmptyString(r.id)) &&
    typeof r.kind === "string" &&
    typeof r.status === "string" &&
    STATUSES.has(r.status) &&
    isArray(r.names) &&
    r.names.every(
      (n) =>
        isPlainObject(n) &&
        nonEmptyString(n.name) &&
        Number.isFinite(n.region_coverage) &&
        Number.isFinite(n.element_coverage),
    ) &&
    isArray(r.masks) &&
    isArray(r.unresolved)
  );
}

/**
 * region-names.mjs の出力を読む。
 * @param {unknown} json
 * @param {{ width:number, height:number }} size - 画像の寸法（bbox が画像の中にあるかを確かめる）
 * @returns {{ error:string } | { regions:MappedRegion[] }}
 */
export function readMappedRegions(json, size) {
  if (!isPlainObject(json) || !isArray(json.regions)) {
    return { error: "region names json must have regions[] (region-names.mjs output)" };
  }
  /** @type {MappedRegion[]} */
  const regions = [];
  for (const [i, r] of json.regions.entries()) {
    if (!isMappedRegion(r)) return { error: `regions[${i}] is not a region-names.mjs region` };
    const { bbox } = r;
    if (
      bbox.x < 0 ||
      bbox.y < 0 ||
      bbox.x + bbox.width > size.width ||
      bbox.y + bbox.height > size.height
    ) {
      return {
        error: `regions[${i}].bbox is outside the ${size.width}x${size.height} image (wrong pair?)`,
      };
    }
    regions.push({ ...r, id: String(r.id) });
  }
  return { regions };
}

/**
 * pairs.json を読む。
 * @param {unknown} json
 * @returns {{ error:string } | { pairs:PairSpec[] }}
 */
export function readPairs(json) {
  if (!isArray(json) || json.length === 0) return { error: "pairs json must be a non-empty array" };
  /** @type {PairSpec[]} */
  const pairs = [];
  const keys = /** @type {const} */ (["page", "state", "viewport", "current", "new", "regions"]);
  /** @type {Set<string>} */
  const seen = new Set();
  for (const [i, p] of json.entries()) {
    if (!isPlainObject(p) || !keys.every((k) => nonEmptyString(p[k]))) {
      return { error: `pairs[${i}] must have non-empty ${keys.join(", ")}` };
    }
    // 同じ組が 2 回あると、同じ行を 2 つの節に結び、件数も 2 重に数える。
    const key = JSON.stringify([p.page, p.state, p.viewport]);
    if (seen.has(key)) {
      return { error: `pairs[${i}] repeats the page, state and viewport ${key}` };
    }
    seen.add(key);
    // 上の検査で、どの欄も空でない文字列であることを確かめてある。
    const str = (/** @type {unknown} */ v) => (typeof v === "string" ? v : "");
    pairs.push({
      page: str(p.page),
      state: str(p.state),
      viewport: str(p.viewport),
      current: str(p.current),
      new: str(p.new),
      regions: str(p.regions),
    });
  }
  return { pairs };
}

/**
 * ファイルを読む。誤りは理由で返す。
 * @param {string} path
 * @returns {{ error:string } | { bytes:Buffer }}
 */
function readBytes(path) {
  try {
    return { bytes: readFileSync(path) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `cannot read ${path}: ${message}` };
  }
}

/**
 * JSON のファイルを読む。誤りは理由で返す。
 * @param {string} path
 * @returns {{ error:string } | { json:unknown }}
 */
function readJson(path) {
  const read = readBytes(path);
  if ("error" in read) return read;
  try {
    return { json: JSON.parse(read.bytes.toString("utf8")) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `cannot parse ${path}: ${message}` };
  }
}

/**
 * PNG のファイルを読み、寸法と data: URI を返す。
 * @param {string} path
 * @returns {{ error:string } | { size:{ width:number, height:number }, uri:string }}
 */
function readPng(path) {
  const read = readBytes(path);
  if ("error" in read) return read;
  const size = pngSize(read.bytes);
  if (!size) return { error: `${path} is not a PNG` };
  return { size, uri: `data:image/png;base64,${read.bytes.toString("base64")}` };
}

/**
 * 1 つの組の入力を読む。
 * @param {PairSpec} spec
 */
function loadPair(spec) {
  const current = readPng(spec.current);
  if ("error" in current) return current;
  const next = readPng(spec.new);
  if ("error" in next) return next;
  if (current.size.width !== next.size.width || current.size.height !== next.size.height) {
    return {
      error: `${spec.page}|${spec.state}|${spec.viewport}: image sizes differ (current ${current.size.width}x${current.size.height}, new ${next.size.width}x${next.size.height})`,
    };
  }
  const json = readJson(spec.regions);
  if ("error" in json) return json;
  const mapped = readMappedRegions(json.json, current.size);
  if ("error" in mapped) return { error: `${spec.regions}: ${mapped.error}` };
  return { spec, current, next, regions: mapped.regions };
}

/** @typedef {Exclude<ReturnType<typeof loadPair>, { error:string }>} LoadedPair */

/**
 * 領域を指す行を結ぶ。
 * @param {LoadedPair[]} pairs
 * @param {DiffRow[]} rows
 */
export function linkRows(pairs, rows) {
  /** @type {Set<DiffRow>} */
  const used = new Set();
  const linked = pairs.map((pair) =>
    pair.regions.map((region) => {
      const matched = rows.filter((row) => rowMatchesRegion(row, pair.spec, region.bbox));
      for (const row of matched) used.add(row);
      return { region, rows: matched };
    }),
  );
  const rest = rows.filter((row) => !used.has(row));
  return { linked, rest };
}

/**
 * 画像の上に描く領域のラベル。結んだ行の ID、無ければ領域の id。
 * @param {{ region:MappedRegion, rows:DiffRow[] }} item
 * @returns {string}
 */
function regionLabel({ region, rows }) {
  if (rows.length > 0) return rows.map((r) => r.id).join(", ");
  return `領域 ${region.kind === "threshold" ? "r" : ""}${region.id}`;
}

/** 状態の表示名。 */
/** @type {Record<string, string>} */
const STATUS_LABELS = {
  named: "論理名あり",
  unnamed: "名前を付けていない要素",
  masked: "マスクの中",
  unknown: "判定できない",
};

/**
 * 画像 1 枚と、その上に描く領域の SVG。
 * @param {{ uri:string, size:{ width:number, height:number }, caption:string,
 *   items:Array<{ region:MappedRegion, rows:DiffRow[], anchor:string }> }} input
 * @returns {string}
 */
function renderFigure({ uri, size, caption, items }) {
  const font = Math.max(12, Math.round(size.width / 90));
  const boxes = items
    .map(({ region, rows, anchor }) => {
      const { x, y, width, height } = region.bbox;
      const label = escapeHtml(regionLabel({ region, rows }));
      const ty = y - 4 < font ? y + height + font : y - 4;
      return (
        `<a href="#${anchor}" aria-label="${label} ${escapeHtml(STATUS_LABELS[region.status])}"><rect class="box ${escapeHtml(region.status)}" x="${x}" y="${y}" width="${width}" height="${height}" vector-effect="non-scaling-stroke"/>` +
        `<text class="label" x="${x}" y="${ty}" font-size="${font}">${label}</text></a>`
      );
    })
    .join("");
  return (
    `<figure><figcaption>${escapeHtml(caption)}</figcaption><div class="shot">` +
    `<img src="${uri}" width="${size.width}" height="${size.height}" alt="${escapeHtml(caption)}">` +
    `<svg viewBox="0 0 ${size.width} ${size.height}" preserveAspectRatio="none">${boxes}</svg>` +
    `</div></figure>`
  );
}

/**
 * 重なる論理名の欄。
 * @param {MappedRegion} region
 * @returns {string}
 */
function renderNames(region) {
  const head = `<span class="status ${escapeHtml(region.status)}">${escapeHtml(STATUS_LABELS[region.status])}</span>`;
  const names = region.names
    .map(
      (n) =>
        `<li>${escapeHtml(n.name)} <small>（領域の ${escapeHtml(Math.round(n.region_coverage * 100))}%・要素の ${escapeHtml(Math.round(n.element_coverage * 100))}%）</small></li>`,
    )
    .join("");
  const masks =
    region.masks.length > 0 ? `<p>マスク: ${region.masks.map(escapeHtml).join(", ")}</p>` : "";
  const unresolved =
    region.unresolved.length > 0
      ? `<p>判定できない理由: ${region.unresolved.map(escapeHtml).join(", ")}</p>`
      : "";
  return `${head}${names ? `<ul>${names}</ul>` : ""}${masks}${unresolved}`;
}

/**
 * 行の欄（比較方法・正規化結果・分類・根拠・内容）。行が無ければ、その旨を出す。
 * @param {DiffRow | undefined} row
 * @returns {string}
 */
function renderRowCells(row) {
  if (!row)
    return `<td colspan="5" class="missing">diff.md に、この bbox を位置に書いた行が無い</td>`;
  return [row.method, row.normalized, row.classification, row.evidence, row.content]
    .map((v) => `<td>${escapeHtml(v)}</td>`)
    .join("");
}

/**
 * 1 つの組の節。
 * @param {LoadedPair} pair
 * @param {Array<{ region:MappedRegion, rows:DiffRow[] }>} items
 * @param {number} pi
 * @returns {string}
 */
function renderPair(pair, items, pi) {
  const anchored = items.map((item, ri) => ({ ...item, anchor: `p${pi}-r${ri}` }));
  const title = `${pair.spec.page} / ${pair.spec.state} / ${pair.spec.viewport}`;
  const figures =
    renderFigure({
      uri: pair.current.uri,
      size: pair.current.size,
      caption: `現行: ${pair.spec.current}`,
      items: anchored,
    }) +
    renderFigure({
      uri: pair.next.uri,
      size: pair.next.size,
      caption: `新側: ${pair.spec.new}`,
      items: anchored,
    });
  const body = anchored
    .flatMap(({ region, rows, anchor }) => {
      const list = rows.length > 0 ? rows : [undefined];
      return list.map(
        (row, k) =>
          `<tr${k === 0 ? ` id="${anchor}"` : ""}><th scope="row">${escapeHtml(row ? row.id : "—")}</th>` +
          `<td>${escapeHtml(region.kind)} ${escapeHtml(region.id)}<br><code>${escapeHtml(`${region.bbox.x},${region.bbox.y},${region.bbox.width},${region.bbox.height}`)}</code></td>` +
          `<td>${renderNames(region)}</td>${renderRowCells(row)}</tr>`,
      );
    })
    .join("");
  const table =
    anchored.length === 0
      ? "<p>この組に画素の差分の領域は無い。</p>"
      : `<table><thead><tr><th>ID</th><th>領域（種類・id・bbox）</th><th>重なる論理名</th><th>比較方法</th><th>正規化結果</th><th>分類</th><th>根拠</th><th>内容</th></tr></thead><tbody>${body}</tbody></table>`;
  return `<section><h2>${escapeHtml(title)}</h2><div class="pair">${figures}</div>${table}</section>`;
}

/**
 * 画像に結べなかった行の節。
 * @param {DiffRow[]} rest
 * @returns {string}
 */
function renderRest(rest) {
  if (rest.length === 0) return "";
  const rows = rest
    .map(
      (r) =>
        `<tr><th scope="row">${escapeHtml(r.id)}</th>${[
          r.method,
          r.page,
          r.state,
          r.viewport,
          r.position,
          r.normalized,
          r.classification,
          r.evidence,
          r.content,
        ]
          .map((v) => `<td>${escapeHtml(v)}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return (
    `<section><h2>画像の領域に結べなかった行</h2>` +
    `<p>画素以外の比較方法の行と、位置の bbox がどの組の領域とも一致しない画素の行である。</p>` +
    `<table><thead><tr><th>ID</th><th>比較方法</th><th>ページ</th><th>状態</th><th>ビューポート</th><th>位置</th><th>正規化結果</th><th>分類</th><th>根拠</th><th>内容</th></tr></thead><tbody>${rows}</tbody></table></section>`
  );
}

/**
 * diff-metadata.json から、レポートの冒頭に出す値を取る。
 * 値が無いか、文字列・数・真偽値でなければ「（記録なし）」を返す。
 * @param {unknown} json
 * @returns {{ error:string } | MetaSummary}
 */
export function readMetadataSummary(json) {
  if (!isPlainObject(json)) return { error: "diff-metadata.json must be an object" };
  const scalar = (/** @type {unknown} */ v) =>
    typeof v === "string" || typeof v === "number" || typeof v === "boolean"
      ? String(v)
      : "（記録なし）";
  return {
    slug: scalar(json.slug),
    target: scalar(isPlainObject(json.new) ? json.new.target : undefined),
    converged: scalar(json.converged),
    results: isPlainObject(json.results) ? JSON.stringify(json.results) : "（記録なし）",
  };
}

const STYLE = `
:root{--bg:#fff;--fg:#1b1b1b;--muted:#5c5c5c;--line:#d0d0d0;--named:#c62828;--unnamed:#1565c0;--masked:#6d6d6d;--unknown:#e65100}
@media (prefers-color-scheme: dark){:root{--bg:#1a1a1a;--fg:#ececec;--muted:#a8a8a8;--line:#3a3a3a;--named:#ef5350;--unnamed:#64b5f6;--masked:#9e9e9e;--unknown:#ffa726}}
body{margin:0 auto;padding:16px;max-width:1600px;background:var(--bg);color:var(--fg);font:14px/1.6 system-ui,sans-serif}
.notice{border:1px solid var(--line);padding:8px 12px}
.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
figure{margin:0}figcaption{color:var(--muted);overflow-wrap:anywhere}
.shot{position:relative;line-height:0}.shot img{width:100%;height:auto}
.shot svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.box{fill:none;stroke-width:2}.box.named{stroke:var(--named)}.box.unnamed{stroke:var(--unnamed)}.box.masked{stroke:var(--masked)}.box.unknown{stroke:var(--unknown);stroke-dasharray:6 3}
.label{fill:var(--fg);paint-order:stroke;stroke:var(--bg);stroke-width:3px;font-family:system-ui,sans-serif}
table{border-collapse:collapse;width:100%;margin-top:12px;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:4px 8px;vertical-align:top;text-align:left}
tr:target{outline:3px solid var(--named)}
.status.named{color:var(--named)}.status.unnamed{color:var(--unnamed)}.status.masked{color:var(--masked)}.status.unknown{color:var(--unknown)}
.missing{color:var(--unknown)}ul{margin:4px 0;padding-left:20px}
`;

/**
 * HTML の全体を組み立てる。
 * @param {{ meta:{ slug:string, target:string, converged:string, results:string },
 *   pairs:LoadedPair[], linked:Array<Array<{ region:MappedRegion, rows:DiffRow[] }>>, rest:DiffRow[],
 *   sources:{ diffMd:string, diffMetadata:string } }} input
 * @returns {string}
 */
export function renderHtml({ meta, pairs, linked, rest, sources }) {
  const sections = pairs.map((pair, pi) => renderPair(pair, linked[pi], pi)).join("");
  return (
    `<!doctype html><html lang="ja"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>差分レポート ${escapeHtml(meta.slug)} ${escapeHtml(meta.target)}</title><style>${STYLE}</style></head><body>` +
    `<h1>差分レポート</h1>` +
    `<p class="notice">このページは ${escapeHtml(sources.diffMd)} と ${escapeHtml(sources.diffMetadata)} から作った表示である。分類と承認の記録ではない。` +
    `分類と承認は diff.md・diff-metadata.json・承認の記録にあり、このページを直しても記録は変わらない。</p>` +
    `<dl><dt>slug</dt><dd>${escapeHtml(meta.slug)}</dd><dt>target</dt><dd>${escapeHtml(meta.target)}</dd>` +
    `<dt>converged</dt><dd>${escapeHtml(meta.converged)}</dd><dt>results</dt><dd><code>${escapeHtml(meta.results)}</code></dd></dl>` +
    `<p>枠の色: <span class="status named">論理名あり</span>・<span class="status unnamed">名前を付けていない要素</span>・` +
    `<span class="status masked">マスクの中</span>・<span class="status unknown">判定できない（破線）</span></p>` +
    `${sections}${renderRest(rest)}<p><small>diff-report.mjs ${VERSION}</small></p></body></html>\n`
  );
}

const USAGE =
  "usage: node diff-report.mjs --diff-md <diff.md> --diff-metadata <diff-metadata.json> --pairs <pairs.json> --out <report.html>\n";

/**
 * 入力を読む。誤りは stderr に出す文で返す。
 * @param {string[]} argv
 * @returns {{ error:string } | { rows:DiffRow[], meta:MetaSummary, pairs:LoadedPair[], out:string,
 *   sources:{ diffMd:string, diffMetadata:string } }}
 */
function loadAll(argv) {
  const parsed = parseFlags(argv, { values: ["--diff-md", "--diff-metadata", "--pairs", "--out"] });
  if (parsed.error !== undefined) return { error: `error: ${parsed.error}\n${USAGE}` };
  const diffMd = parsed.strings["--diff-md"];
  const diffMetadata = parsed.strings["--diff-metadata"];
  const pairsPath = parsed.strings["--pairs"];
  const out = parsed.strings["--out"];
  if (!diffMd || !diffMetadata || !pairsPath || !out) return { error: USAGE };
  const md = readBytes(diffMd);
  if ("error" in md) return { error: `error: ${md.error}\n` };
  const rows = parseDiffRows(md.bytes.toString("utf8"));
  if ("error" in rows) return { error: `error: ${rows.error}\n` };
  const metaJson = readJson(diffMetadata);
  if ("error" in metaJson) return { error: `error: ${metaJson.error}\n` };
  const meta = readMetadataSummary(metaJson.json);
  if ("error" in meta) return { error: `error: ${meta.error}\n` };
  const pairsJson = readJson(pairsPath);
  if ("error" in pairsJson) return { error: `error: ${pairsJson.error}\n` };
  const specs = readPairs(pairsJson.json);
  if ("error" in specs) return { error: `error: ${specs.error}\n` };
  /** @type {LoadedPair[]} */
  const pairs = [];
  for (const spec of specs.pairs) {
    const loaded = loadPair(spec);
    if ("error" in loaded) return { error: `error: ${loaded.error}\n` };
    pairs.push(loaded);
  }
  return { rows: rows.rows, meta, pairs, out, sources: { diffMd, diffMetadata } };
}

/**
 * CLI エントリ。HTML を --out に書き、stdout に件数を出す。
 * @param {string[]} argv
 * @returns {number} exit code
 */
export function main(argv) {
  const inputs = loadAll(argv);
  if ("error" in inputs) {
    process.stderr.write(inputs.error);
    return 2;
  }
  const { rows, meta, pairs, out, sources } = inputs;
  const { linked, rest } = linkRows(pairs, rows);
  try {
    writeFileSync(out, renderHtml({ meta, pairs, linked, rest, sources }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: cannot write ${out}: ${message}\n`);
    return 2;
  }
  const items = linked.flat();
  const regionsWithoutRow = items.filter((i) => i.rows.length === 0).length;
  const pixelRowsUnlinked = rest.filter((r) => r.method.includes("画素")).length;
  if (regionsWithoutRow > 0) {
    process.stderr.write(
      `warning: ${regionsWithoutRow} region(s) have no diff.md row with the same page, state, viewport and bbox\n`,
    );
  }
  if (pixelRowsUnlinked > 0) {
    process.stderr.write(
      `warning: ${pixelRowsUnlinked} pixel row(s) in diff.md match no region; listed under 画像の領域に結べなかった行\n`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({ version: VERSION, out, pairs: pairs.length, regions: items.length, regions_without_row: regionsWithoutRow, pixel_rows_unlinked: pixelRowsUnlinked, rows_not_on_images: rest.length }, null, 2)}\n`,
  );
  return 0;
}

if (isCliEntry(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
