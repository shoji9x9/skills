// AWS 構成図の描画エンジン（複数環境の図で共用する純関数）。
// spec を受け取り、SVG の文字列を返す。GUI が要らず、テキストの差分で管理できる。
// 作図のルールと品質の確認は、スキルのガイド（references/conventions.md）にある。
//
// spec の形は次のとおりである（`?` を付けたキーは省略できる）。
//
// - `{ W, H, title, nodes, edges, groups, notes? }`
// - node は `{ id, icon, label: [行...], x, y, lp, dim? }` の形にする。
//   - `icon` はアイコンのディレクトリからの相対パス（拡張子なし。例 `"aws-icons/lambda"`）。`null` なら無地の箱を描く。
//   - `lp` はラベルの位置（`"top"`・`"bottom"`・`"left"`・`"right"`）。線の出ていない辺に寄せる。
//   - `dim` が `true` なら淡い色で描く（環境の差分で「使わない」ことを表す）。
// - edge は `{ from, to, label?, labelAt?, dashed?, waypoints?, dim? }` の形にする。
//   - `waypoints`（`[[x, y]...]`）は直交する線の経由点。無ければ L 字の線を自動で引く。
//   - `labelAt`（`[x, y]`）はラベルの中心の座標。省略すると、屈曲点を避けて自動で置く。
// - group は `{ label, x, y, w, h, color }` の形にする。背景の枠で、座標は左上を基準にする。
// - notes は `[{ x, y, w, title, lines: [...] }]` の形にする。凡例と注記の箱である。
//
// 使い方: `renderDiagram(spec, { iconDir })` を呼ぶ。`iconDir` にはアイコンを置いたディレクトリのルートを渡す。
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { serializeIconBody, validateIconSvg } from "./lib/validate-icon-svg.mjs";

const ICON = 64; // アイコン一辺 (px)
const HOP = 5; // 交差の飛び越し（line jump）半径
const FONT =
  '-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif';

/**
 * @typedef {{ id: string, icon?: string | null, label?: string[], x: number, y: number, lp?: string, dim?: boolean }} DiagramNode
 * @typedef {{ from: string, to: string, label?: string, labelAt?: number[], dashed?: boolean, waypoints?: number[][], dim?: boolean }} DiagramEdge
 * @typedef {{ label: string, x: number, y: number, w: number, h: number, color: string }} DiagramGroup
 * @typedef {{ x: number, y: number, w: number, title: string, lines: string[] }} DiagramNote
 * @typedef {{ W: number, H: number, title: string, nodes?: DiagramNode[], edges?: DiagramEdge[], groups?: DiagramGroup[], notes?: DiagramNote[] }} DiagramSpec
 * @typedef {{ x: number, y: number }} Point
 * @typedef {import("./lib/validate-icon-svg.mjs").IconNode} IconNode
 * @typedef {{ ei: number, x: number, lo: number, hi: number }} Vertical
 */

/**
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// ラベルなどを SVG のテキストに埋め込むときの XML エスケープ（`&`・`<`・`>` で SVG が不正にならないように）。
/** @param {unknown} s */
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ノード間の矢印は最大 1 本。重複した from→to はここで弾く（配置ミスの早期検出）。
/** @param {DiagramEdge[]} edges */
function assertUniqueEdges(edges) {
  /** @type {Set<string>} */
  const seenEdge = new Set();
  for (const e of edges) {
    const key = `${e.from}->${e.to}`;
    if (seenEdge.has(key)) throw new Error(`重複エッジ: ${key}（ノード間の矢印は最大 1 本）`);
    seenEdge.add(key);
  }
}

/**
 * id からノードを引く関数を返す。未知の id はエラーにする。
 * @param {DiagramNode[]} nodes
 */
export function nodeLookup(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  /** @param {string} id */
  return (id) => {
    const n = byId.get(id);
    if (!n) throw new Error(`未知のノード: ${id}`);
    return n;
  };
}

// アイコンのファイルの実体パスを返す。iconDir の外（.. や絶対パス）は読み込ませない。
/**
 * @param {string} iconDir
 * @param {() => string} getIconDirReal iconDir の実体パス（symlink 解決後）を返す
 * @param {string} name
 */
function resolveIconFile(iconDir, getIconDirReal, name) {
  const file = join(iconDir, `${name}.svg`);
  // 1) 字面のチェック（spec の name に `..` や絶対パスが含まれていても拒否する）。
  const rel = relative(iconDir, file);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error(`アイコンパスが iconDir の外を指しています: ${name}`);
  // 2) 実体（symlink 解決後）が iconDir 配下かを検証（iconDir 内の外向き symlink 対策）。
  const iconDirReal = getIconDirReal();
  let fileReal;
  try {
    fileReal = realpathSync(file);
  } catch {
    throw new Error(`アイコンが見つかりません: ${name}`);
  }
  const relReal = relative(iconDirReal, fileReal);
  if (relReal.startsWith("..") || isAbsolute(relReal))
    throw new Error(`アイコンパスが iconDir の外を指しています（symlink 経由）: ${name}`);
  return fileReal;
}

// アイコン SVG の中身を取り出し、元の viewBox と一緒に返す。
// 取得元（AWS パッケージ）や自作アイコンが、許可した要素・属性・構文の外にあれば、書き換えずにエラーにする。
// script を実行させる内容（<script>・on* ハンドラ・javascript: の URL・<foreignObject> など）は、許可リストに無いので図に入らない
// （lib/validate-icon-svg.mjs）。
/**
 * @param {string} raw
 * @param {string} name
 * @returns {{ viewBox: string, children: IconNode[] }}
 */
function parseIconSvg(raw, name) {
  let icon;
  try {
    icon = validateIconSvg(raw);
  } catch (error) {
    throw new Error(
      `アイコン SVG が不正（${error instanceof Error ? error.message : String(error)}）: ${name}`,
    );
  }
  const viewBox = icon.attributes.get("viewBox") ?? "0 0 80 80";
  return { viewBox, children: icon.children };
}

// アイコン SVG を <svg> ネストとして取り込み、元の viewBox を引き継ぐ関数を返す。
/** @param {string} iconDir */
function createIconEmbedder(iconDir) {
  /** @type {Map<string, { viewBox: string, children: IconNode[] }>} */
  const iconCache = new Map();
  /** @type {string | undefined} */
  let iconDirReal; // iconDir の実体パス（symlink 解決後）。初回に一度だけ解決する。
  let iconSeq = 0; // 埋め込みごとに内部 id を名前空間化するための連番。
  const getIconDirReal = () => (iconDirReal ??= realpathSync(iconDir));
  /**
   * @param {string} name
   * @param {number} x
   * @param {number} y
   */
  return (name, x, y) => {
    let inner = iconCache.get(name);
    if (inner === undefined) {
      const fileReal = resolveIconFile(iconDir, getIconDirReal, name);
      inner = parseIconSvg(readFileSync(fileReal, "utf8"), name);
      iconCache.set(name, inner);
    }
    // 同じ図に同じアイコンを複数埋めると内部の id（clipPath・gradient など）が重なり、参照が別のアイコンの要素を指す。
    // 埋め込みごとに一意の接頭辞を、id とその参照に付ける（lib/validate-icon-svg.mjs の serializeIconBody）。
    const body = serializeIconBody(inner.children, `ic${iconSeq++}-`);
    return `<svg x="${x}" y="${y}" width="${ICON}" height="${ICON}" viewBox="${inner.viewBox}" overflow="visible">${body}</svg>`;
  };
}

// ノードのアイコンの矩形。検査（diagram-checks.mjs）も同じ矩形を使う。
/** @param {DiagramNode} n */
export const box = (n) => {
  const h = ICON / 2;
  return { left: n.x - h, right: n.x + h, top: n.y - h, bottom: n.y + h };
};

// ノード境界上の接続点。最も近い辺を選び、辺に平行な座標は接近点(px,py)へ合わせる。
// これにより waypoint を動かすと辺上の進入位置を制御できる（複数線の進入をずらす）。
/**
 * @param {DiagramNode} n
 * @param {number} px
 * @param {number} py
 * @returns {Point}
 */
const anchor = (n, px, py) => {
  const b = box(n);
  const PAD = 12;
  if (Math.abs(px - n.x) >= Math.abs(py - n.y)) {
    return { x: px >= n.x ? b.right : b.left, y: clamp(py, b.top + PAD, b.bottom - PAD) };
  }
  return { x: clamp(px, b.left + PAD, b.right - PAD), y: py >= n.y ? b.bottom : b.top };
};

// 線の座標の列。waypoints があればそこを経由し、無ければ直交する L 字の線を自動で作る。
/**
 * @param {DiagramNode} a
 * @param {DiagramNode} b
 * @param {DiagramEdge} e
 * @returns {Point[]}
 */
const route = (a, b, e) => {
  if (e.waypoints?.length) {
    const first = e.waypoints[0];
    const last = e.waypoints[e.waypoints.length - 1];
    return [
      anchor(a, first[0], first[1]),
      ...e.waypoints.map(([x, y]) => ({ x, y })),
      anchor(b, last[0], last[1]),
    ];
  }
  const s = anchor(a, b.x, b.y);
  const t = anchor(b, a.x, a.y);
  if (Math.abs(a.x - b.x) >= Math.abs(a.y - b.y)) {
    const mx = (s.x + t.x) / 2;
    return [s, { x: mx, y: s.y }, { x: mx, y: t.y }, t];
  }
  const my = (s.y + t.y) / 2;
  return [s, { x: s.x, y: my }, { x: t.x, y: my }, t];
};

// ラベルの 1 行目の座標と揃え。lp が指す辺の外側に置く。
/**
 * @param {DiagramNode} n
 * @param {number} lineCount
 * @param {number} lh
 */
function labelOrigin(n, lineCount, lh) {
  const b = box(n);
  if (n.lp === "top") return { x: n.x, align: "middle", y: b.top - 8 - (lineCount - 1) * lh };
  if (n.lp === "left")
    return { x: b.left - 8, align: "end", y: n.y - ((lineCount - 1) * lh) / 2 + 4 };
  if (n.lp === "right")
    return { x: b.right + 8, align: "start", y: n.y - ((lineCount - 1) * lh) / 2 + 4 };
  return { x: n.x, align: "middle", y: b.bottom + 16 };
}

const NODE_LABEL_LH = 14; // ノードのラベルの行の間隔
const NODE_LABEL_FONT = 12;

// 文字列の幅の概算（px）。全角（CJK 等の非 Latin-1）は ASCII より広いので、文字ごとに出し分ける。
// フォントで実際の幅は変わるので、検査とラベルの背景はこの概算で揃える。
/**
 * @param {string} s
 * @param {number} latin Latin-1 の 1 文字の幅
 * @param {number} wide それ以外の 1 文字の幅
 */
const textWidth = (s, latin, wide) =>
  Array.from(s).reduce((a, ch) => a + (/[\x20-\xff]/.test(ch) ? latin : wide), 0);

// ノードのラベルが占める矩形（幅は textWidth の概算）。検査（diagram-checks.mjs）が使う。
/**
 * @param {DiagramNode} n
 * @returns {{ left: number, right: number, top: number, bottom: number } | null}
 */
export function nodeLabelRect(n) {
  const lines = n.label ?? [];
  if (!lines.length) return null;
  const { x, y, align } = labelOrigin(n, lines.length, NODE_LABEL_LH);
  // font-size 12 での概算（Latin-1 ≈ 7px / 全角 ≈ 12px）
  const w = Math.max(...lines.map((line) => textWidth(line, 7, NODE_LABEL_FONT)));
  const left = align === "middle" ? x - w / 2 : align === "end" ? x - w : x;
  return {
    left,
    right: left + w,
    top: y - NODE_LABEL_FONT,
    bottom: y + (lines.length - 1) * NODE_LABEL_LH + 4,
  };
}

// ラベルを線の出ていない辺へ配置。
/** @param {DiagramNode} n */
const label = (n) => {
  const lines = n.label ?? [];
  const lh = NODE_LABEL_LH;
  const { x, y, align } = labelOrigin(n, lines.length, lh);
  return lines
    .map(
      (line, i) =>
        `<text x="${x}" y="${y + i * lh}" text-anchor="${align}" font-family='${FONT}' font-size="12" fill="#16191F">${esc(line)}</text>`,
    )
    .join("\n  ");
};

// 線が直交していること（conventions.md の確認観点 (b)）を機械的に強制する。
// 斜めの線は目視で見落としやすく、`waypoints` の座標を 1 つ間違えるだけで生じるので、ここで止める。
// 両端の区間もチェックする。ノードの側の接続点は、相手の側の waypoint に合わせて辺の上を動く。
// ただし、辺の範囲（中心から ±20px）を超える指定は丸められるので、斜めになる。
/** @param {{ e: DiagramEdge, pts: Point[] }[]} routed */
function assertOrthogonal(routed) {
  for (const { e, pts } of routed) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a.x !== b.x && a.y !== b.y) {
        throw new Error(
          `斜めのエッジ: ${e.from}->${e.to} の区間 (${a.x},${a.y})-(${b.x},${b.y})` +
            `（直交する線で結ぶ必要がある。waypoints は前後の点と x か y を共有させ、` +
            `最初/最後の waypoint は接続先ノードの中心と x か y を ±20px 以内で揃える）`,
        );
      }
    }
  }
}

// 垂直の区間の一覧を作る（交差を飛び越すかの判定に使う）。
/**
 * @param {{ pts: Point[] }[]} routed
 * @returns {Vertical[]}
 */
function collectVerticals(routed) {
  /** @type {Vertical[]} */
  const verticals = [];
  routed.forEach(({ pts }, ei) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a.x === b.x && a.y !== b.y)
        verticals.push({ ei, x: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
    }
  });
  return verticals;
}

// エッジラベルの中心座標。`labelAt` があればそれを使う。省略時は点列の中央を採るが、
// そこが屈曲点だとラベルの白背景が角を覆い「線が折れていること」を隠す（自動 L 字は
// 常に 4 点なので中央インデックスは必ず屈曲点になる）。屈曲点・端点に当たったら、
// 隣接する直線区間の長い方の中点へ寄せる（線の形は変えずラベルだけ動かす）。
/**
 * @param {Point[]} pts
 * @param {DiagramEdge} e
 * @returns {Point}
 */
const labelPoint = (pts, e) => {
  if (e.labelAt) return { x: e.labelAt[0], y: e.labelAt[1] };
  const i = Math.floor(pts.length / 2);
  const p = pts[i];
  const prev = pts[i - 1];
  const next = pts[i + 1];
  const straight =
    prev && next && ((prev.x === p.x && p.x === next.x) || (prev.y === p.y && p.y === next.y));
  if (straight) return p;
  const segs = [prev && [prev, p], next && [p, next]].filter(Boolean);
  if (!segs.length) return p;
  /** @param {Point[]} seg */
  const len = ([a, b]) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const [a, b] = segs.reduce((best, s) => (len(s) > len(best) ? s : best));
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
};

// 水平の区間（y の上を x の lo〜hi）が、垂直の区間（x の上を y の lo〜hi）を内側で横切り、飛び越しを付けるか。
// 端から 1px 以内で接するだけの形（T 字・L 字）には付けない。検査（diagram-checks.mjs）も同じ条件で判定する。
/**
 * @param {{ y: number, lo: number, hi: number }} h
 * @param {{ x: number, lo: number, hi: number }} v
 */
export const hopsOver = (h, v) =>
  v.x > h.lo + 1 && v.x < h.hi - 1 && v.lo < h.y - 1 && v.hi > h.y + 1;

// 水平の区間 a→b と交わる、他のエッジの垂直の区間の x 座標（進む向きの順）。
/**
 * @param {{ a: Point, b: Point, ei: number }} seg
 * @param {Vertical[]} verticals
 * @param {number} dir
 */
function hopXs({ a, b, ei }, verticals, dir) {
  const h = { y: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) };
  return [...new Set(verticals.filter((v) => v.ei !== ei && hopsOver(h, v)).map((v) => v.x))].sort(
    (p, q) => (dir > 0 ? p - q : q - p),
  );
}

// 水平セグメントが他エッジの垂直セグメントと交わる点で半円アーチ（∩）を描く。
/**
 * @param {Point[]} pts
 * @param {number} ei
 * @param {Vertical[]} verticals
 */
const pathD = (pts, ei, verticals) => {
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a.y === b.y && a.x !== b.x) {
      const dir = b.x > a.x ? 1 : -1;
      const y = a.y;
      for (const cx of hopXs({ a, b, ei }, verticals, dir)) {
        d += ` L ${cx - dir * HOP} ${y} A ${HOP} ${HOP} 0 0 ${dir > 0 ? 1 : 0} ${cx + dir * HOP} ${y}`;
      }
      d += ` L ${b.x} ${b.y}`;
    } else {
      d += ` L ${b.x} ${b.y}`;
    }
  }
  return d;
};

// グループ枠（最背面）。
/** @param {DiagramGroup[]} groups */
function renderGroups(groups) {
  return groups.flatMap((g) => [
    `<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="10" fill="${g.color}" fill-opacity="0.04" stroke="${g.color}" stroke-width="2"/>`,
    `<text x="${g.x + 12}" y="${g.y + 24}" font-family='${FONT}' font-size="14" font-weight="600" fill="${g.color}">${esc(g.label)}</text>`,
  ]);
}

// エッジ 1 本（線とラベル）。dim は淡色。
/**
 * @param {{ e: DiagramEdge, pts: Point[] }} routedEdge
 * @param {number} ei
 * @param {Vertical[]} verticals
 */
function renderEdge({ e, pts }, ei, verticals) {
  const stroke = e.dim ? "#B9C2CE" : "#5A6B86";
  const marker = e.dim ? "arrowDim" : "arrow";
  const out = [
    `<path d="${pathD(pts, ei, verticals)}" fill="none" stroke="${stroke}" stroke-width="1.8" marker-end="url(#${marker})"${e.dashed ? ' stroke-dasharray="6,4"' : ""}/>`,
  ];
  const rect = edgeLabelRect({ e, pts });
  if (rect) {
    out.push(
      `<rect x="${rect.left}" y="${rect.top}" width="${rect.right - rect.left}" height="${rect.bottom - rect.top}" rx="3" fill="#FFFFFF" fill-opacity="0.92"/>`,
      `<text x="${rect.x}" y="${rect.y + 3}" text-anchor="middle" font-family='${FONT}' font-size="11" fill="#5A6B86">${esc(rect.text)}</text>`,
    );
  }
  return out;
}

// エッジのラベルの文字列・中心・背景の矩形。ラベルが無ければ null。検査（diagram-checks.mjs）も同じ矩形を使う。
/**
 * @param {{ e: DiagramEdge, pts: Point[] }} routedEdge
 * @returns {{ text: string, x: number, y: number, left: number, right: number, top: number, bottom: number } | null}
 */
export function edgeLabelRect({ e, pts }) {
  if (!e.label) return null;
  const mid = labelPoint(pts, e);
  // 背景がラベルより狭くならないよう、文字の幅を出し分ける（font-size 11 での概算: Latin-1 ≈ 6.5px / 全角 ≈ 11px）。
  const w = Math.ceil(textWidth(e.label, 6.5, 11)) + 12;
  return {
    text: e.label,
    x: mid.x,
    y: mid.y,
    left: mid.x - w / 2,
    right: mid.x + w / 2,
    top: mid.y - 10,
    bottom: mid.y + 8,
  };
}

// ノード（アイコン + ラベル）。
/**
 * @param {DiagramNode} n
 * @param {(name: string, x: number, y: number) => string} embedIcon
 */
function renderNode(n, embedIcon) {
  const b = box(n);
  const icon = n.icon
    ? embedIcon(n.icon, b.left, b.top)
    : `<rect x="${b.left}" y="${b.top}" width="${ICON}" height="${ICON}" rx="6" fill="#EAEDED" stroke="#5A6B86" stroke-width="1.5"/>`;
  const body = `${icon}\n  ${label(n)}`;
  return n.dim ? `<g opacity="0.32">${body}</g>` : body;
}

// 注記/凡例ボックス（最前面）。
/** @param {DiagramNote} note */
function renderNote(note) {
  const h = 30 + note.lines.length * 16 + 6;
  return [
    `<rect x="${note.x}" y="${note.y}" width="${note.w}" height="${h}" rx="8" fill="#F4F6F8" stroke="#C2CAD4" stroke-width="1"/>`,
    `<text x="${note.x + 14}" y="${note.y + 22}" font-family='${FONT}' font-size="13" font-weight="700" fill="#16191F">${esc(note.title)}</text>`,
    ...note.lines.map(
      (line, i) =>
        `<text x="${note.x + 14}" y="${note.y + 42 + i * 16}" font-family='${FONT}' font-size="12" fill="#3A4452">${esc(line)}</text>`,
    ),
  ];
}

/**
 * @param {number} W
 * @param {number} H
 * @param {string[]} out
 */
function svgDocument(W, H, out) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family='${FONT}'>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#5A6B86"/>
    </marker>
    <marker id="arrowDim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#B9C2CE"/>
    </marker>
  </defs>
  ${out.join("\n  ")}
</svg>
`;
}

// 全エッジの線の座標の列を確定する。描画（renderDiagram）と検査（diagram-checks.mjs）が同じ線を使う。
// spec の形の誤り（キャンバスの大きさが数でない・重複したエッジ・未知のノード・斜めの線）は、ここでエラーにする。
// キャンバスの大きさが数でないと、SVG の width が NaN になり、検査の (i) の比較もすべて偽になって合格として扱われる。
/**
 * @param {DiagramSpec} spec
 * @returns {{ e: DiagramEdge, pts: Point[] }[]}
 */
export function routeEdges(spec) {
  const { nodes = [], edges = [] } = spec;
  assertCanvas(spec);
  assertUniqueEdges(edges);
  const node = nodeLookup(nodes);
  const routed = edges.map((e) => ({ e, pts: route(node(e.from), node(e.to), e) }));
  assertOrthogonal(routed);
  return routed;
}

/** @param {DiagramSpec} spec */
function assertCanvas({ W, H }) {
  if (!Number.isFinite(W) || !Number.isFinite(H)) {
    throw new Error(`spec の W と H は数で書く（W=${W}, H=${H}）`);
  }
}

// 描画と検査が使う線。routed を渡されなければ routeEdges で計算する。
// 渡されたら、routeEdges と同じ形の検査（キャンバスの大きさ・重複したエッジ・斜めの線）を当て、
// routed が spec のエッジと本数・並び（同じオブジェクト）で対応するかを確かめる。
// routed を計算した後に spec をその場で書き換えた（ノードを動かした・waypoints を変えた）ことは、ここでは検出できない。
// そのため、routed は spec を確定した直後に計算し、その後に spec を書き換えない呼び出し元だけが渡す。
/**
 * @param {DiagramSpec} spec
 * @param {{ e: DiagramEdge, pts: Point[] }[] | undefined} routed
 * @returns {{ e: DiagramEdge, pts: Point[] }[]}
 */
export function routedFor(spec, routed) {
  if (!routed) return routeEdges(spec);
  assertCanvas(spec);
  const { edges = [] } = spec;
  assertUniqueEdges(edges);
  if (routed.length !== edges.length || routed.some((r, i) => r.e !== edges[i])) {
    throw new Error(
      "routed が spec のエッジと対応しない（同じ spec を routeEdges に渡した結果を渡す）",
    );
  }
  assertOrthogonal(routed);
  return routed;
}

// options.routed には、同じ spec を routeEdges で計算した結果を渡せる（検査と同じ線で描き、計算を 1 回で済ませる）。
// 渡せる条件は routedFor にある。
/**
 * @param {DiagramSpec} spec
 * @param {{ iconDir?: string, routed?: { e: DiagramEdge, pts: Point[] }[] }} [options]
 * @returns {string}
 */
export function renderDiagram(spec, options = {}) {
  const { W, H, title, nodes = [], groups = [], notes = [] } = spec;
  const { iconDir } = options;
  if (!iconDir) throw new Error("renderDiagram: options.iconDir が必要です");

  const embedIcon = createIconEmbedder(iconDir);

  // 全エッジの線を先に確定し、垂直の区間の一覧を作る（交差を飛び越すかの判定に使う）。
  const routed = routedFor(spec, options.routed);
  const verticals = collectVerticals(routed);

  const out = [
    `<rect x="0" y="0" width="${W}" height="${H}" fill="#FFFFFF"/>`,
    `<text x="28" y="44" font-family='${FONT}' font-size="22" font-weight="700" fill="#16191F">${esc(title)}</text>`,
    ...renderGroups(groups),
    // エッジ（ノードより先に描いて背面へ）。
    ...routed.flatMap((r, ei) => renderEdge(r, ei, verticals)),
    ...nodes.map((n) => renderNode(n, embedIcon)),
    ...notes.flatMap(renderNote),
  ];
  return svgDocument(W, H, out);
}
