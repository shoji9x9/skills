// 構成図の作図ルールのうち、図の形（ノードとグループの矩形、エッジの線分、ラベルの位置）から計算できる観点を検査する。
// 観点の記号（a〜j）と、どれを検査し、どれを目で見るかは、スキルのガイド（references/conventions.md）にある。
// 違反を返すだけで、配置は直さない。座標はエンジン（diagram-engine.mjs）と同じ計算で求める。
//
// 使い方: `checkDiagram(spec)` を呼ぶ。違反の配列（観点の記号と、場所を含むメッセージ）を返す。違反が無ければ空の配列である。
import { box, edgeLabelRect, nodeLabelRect, routeEdges } from "./diagram-engine.mjs";

/**
 * @typedef {import("./diagram-engine.mjs").DiagramSpec} DiagramSpec
 * @typedef {import("./diagram-engine.mjs").DiagramEdge} DiagramEdge
 * @typedef {import("./diagram-engine.mjs").DiagramNode} DiagramNode
 * @typedef {import("./diagram-engine.mjs").DiagramGroup} DiagramGroup
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ left: number, right: number, top: number, bottom: number }} Rect
 * @typedef {{ ei: number, e: DiagramEdge, a: Point, b: Point, vertical: boolean, at: number, lo: number, hi: number }} Segment
 * @typedef {{ rule: string, message: string }} Violation
 */

const GROUP_PADDING = 32; // ノードのアイコンとグループの枠の間に取る余白（アイコンの半分）
const PARALLEL_GAP = 20; // 平行な線どうし、線と枠線の間に取る間隔
const CANVAS_MARGIN = 50; // 最も外側の枠とキャンバスの端の間に取る余白
// 同じノードに入る線の端どうしの間隔の下限。矢印の頭（markerWidth 7 × stroke-width 1.8 ≈ 12.6px）が重ならない幅にする。
const ARROW_GAP = 13;

/** @param {Point} p */
const pt = (p) => `(${p.x},${p.y})`;
/** @param {DiagramEdge} e */
const edgeName = (e) => `${e.from}->${e.to}`;
/** @param {Segment} s */
const segName = (s) => `${edgeName(s.e)} の区間 ${pt(s.a)}-${pt(s.b)}`;
/** @param {DiagramGroup} g */
const groupRect = (g) => ({ left: g.x, right: g.x + g.w, top: g.y, bottom: g.y + g.h });

/**
 * @param {{ ei: number, e: DiagramEdge }} edge
 * @param {Point} a
 * @param {Point} b
 * @returns {Segment}
 */
function segment({ ei, e }, a, b) {
  const vertical = a.x === b.x;
  return {
    ei,
    e,
    a,
    b,
    vertical,
    at: vertical ? a.x : a.y,
    lo: vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x),
    hi: vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x),
  };
}

// エンジンが線を描く単位の区間。長さ 0 の区間（自動の L 字で屈曲が要らないときにできる）は、どの観点にも関係しないので除く。
/** @param {{ e: DiagramEdge, pts: Point[] }[]} routed */
function rawSegmentsOf(routed) {
  return routed.flatMap(({ e, pts }, ei) =>
    pts
      .slice(0, -1)
      .map((a, i) => ({ a, b: pts[i + 1] }))
      .filter(({ a, b }) => a.x !== b.x || a.y !== b.y)
      .map(({ a, b }) => segment({ ei, e }, a, b)),
  );
}

/** @param {Segment} s */
const direction = (s) => Math.sign(s.vertical ? s.b.y - s.a.y : s.b.x - s.a.x);

// 同じエッジで続けて同じ向きに進む区間を 1 本にまとめる。自動の L 字は直線を 2 つの区間に分けるので、
// まとめないと 1 つの違反を 2 回報告する。折り返す区間（同じ直線の上で向きが逆になる）はまとめない。
/** @param {Segment[]} raw */
function mergeCollinear(raw) {
  /** @type {Segment[]} */
  const out = [];
  for (const s of raw) {
    const last = out[out.length - 1];
    const continues =
      last !== undefined &&
      last.ei === s.ei &&
      last.vertical === s.vertical &&
      last.at === s.at &&
      last.b.x === s.a.x &&
      last.b.y === s.a.y &&
      direction(last) === direction(s);
    if (last && continues) {
      out[out.length - 1] = segment(s, last.a, s.b);
    } else {
      out.push(s);
    }
  }
  return out;
}

// 区間が矩形の内側を通るか（辺に触れるだけなら通らない）。
/**
 * @param {Segment} s
 * @param {Rect} r
 */
function crossesRect(s, r) {
  const [aLo, aHi, bLo, bHi] = s.vertical
    ? [r.left, r.right, r.top, r.bottom]
    : [r.top, r.bottom, r.left, r.right];
  return aLo < s.at && s.at < aHi && Math.max(s.lo, bLo) < Math.min(s.hi, bHi);
}

/**
 * @param {Rect} r
 * @param {Point} p
 */
const containsPoint = (r, p) => r.left <= p.x && p.x <= r.right && r.top <= p.y && p.y <= r.bottom;

/**
 * @param {DiagramEdge} e1
 * @param {DiagramEdge} e2
 */
const sharesEnd = (e1, e2) => e1.from === e2.from || e1.to === e2.to;

// (a) ノードのアイコンが、グループの枠にかかっていないか、枠の内側の余白が足りているか。
/**
 * @param {DiagramNode[]} nodes
 * @param {DiagramGroup[]} groups
 * @returns {Violation[]}
 */
function checkNodesInGroups(nodes, groups) {
  /** @type {Violation[]} */
  const out = [];
  for (const n of nodes) {
    const b = box(n);
    for (const g of groups) {
      const r = groupRect(g);
      const outside =
        b.right <= r.left || r.right <= b.left || b.bottom <= r.top || r.bottom <= b.top;
      const inside =
        r.left + GROUP_PADDING <= b.left &&
        b.right <= r.right - GROUP_PADDING &&
        r.top + GROUP_PADDING <= b.top &&
        b.bottom <= r.bottom - GROUP_PADDING;
      if (!outside && !inside) {
        out.push({
          rule: "a",
          message: `ノード ${n.id} がグループ「${g.label}」の枠にかかっているか、枠の内側の余白が ${GROUP_PADDING}px 未満`,
        });
      }
    }
  }
  return out;
}

// (b) 線が、端点でないノードのアイコンを貫いていないか。
/**
 * @param {Segment[]} segs
 * @param {DiagramNode[]} nodes
 * @returns {Violation[]}
 */
function checkSegmentsThroughIcons(segs, nodes) {
  return segs.flatMap((s) =>
    nodes
      .filter((n) => n.id !== s.e.from && n.id !== s.e.to && crossesRect(s, box(n)))
      .map((n) => ({
        rule: "b",
        message: `${segName(s)} がノード ${n.id} のアイコンを貫いている`,
      })),
  );
}

// (c) 別のエッジの平行な区間が、20px 未満の間隔で並んでいないか。
// 端点を共有するエッジ（同じ依存元から出る幹線・同じ先へ入る線）が同じ座標で重なるのは、1 本の幹線として描く意図なので除く。
// 同じ先へ同じ点で入る線は、(f) が検査する。
/** @param {Segment[]} segs */
function checkParallelGaps(segs) {
  /** @type {Violation[]} */
  const out = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i];
      const t = segs[j];
      if (s.ei === t.ei || s.vertical !== t.vertical) continue;
      const gap = Math.abs(s.at - t.at);
      if (gap >= PARALLEL_GAP || Math.max(s.lo, t.lo) >= Math.min(s.hi, t.hi)) continue;
      if (gap === 0 && sharesEnd(s.e, t.e)) continue;
      out.push({
        rule: "c",
        message: `${segName(s)} と ${segName(t)} の間隔が ${gap}px（${PARALLEL_GAP}px 未満）`,
      });
    }
  }
  return out;
}

// (d) 線が、ノードのラベルと、他のエッジのラベルを貫いていないか。ラベルの幅はエンジンの概算で求める。
/**
 * @param {Segment[]} segs
 * @param {DiagramNode[]} nodes
 * @param {{ e: DiagramEdge, pts: Point[] }[]} routed
 * @returns {Violation[]}
 */
function checkSegmentsThroughLabels(segs, nodes, routed) {
  /** @type {{ name: string, r: Rect, ei: number, e: DiagramEdge | null }[]} */
  const nodeLabels = nodes.flatMap((n) => {
    const r = nodeLabelRect(n);
    return r ? [{ name: `ノード ${n.id} のラベル`, r, ei: -1, e: null }] : [];
  });
  const edgeLabels = routed.flatMap((re, ei) => {
    const r = edgeLabelRect(re);
    return r ? [{ name: `エッジ ${edgeName(re.e)} のラベル`, r, ei, e: re.e }] : [];
  });
  const labels = [...nodeLabels, ...edgeLabels];
  // 端点を共有するエッジが同じ座標で重なる幹線（(c) で除く形）では、1 本の線に見えるので、
  // 幹線の上に置いた一方のラベルを他方が通っても違反にしない。垂直に交わって貫く形は違反にする。
  /**
   * @param {Segment} s
   * @param {{ ei: number, e: DiagramEdge | null }} l
   */
  const onSharedTrunk = (s, l) =>
    l.e !== null &&
    sharesEnd(s.e, l.e) &&
    segs.some(
      (t) =>
        t.ei === l.ei &&
        t.vertical === s.vertical &&
        t.at === s.at &&
        Math.max(t.lo, s.lo) < Math.min(t.hi, s.hi),
    );
  return segs.flatMap((s) =>
    labels
      .filter((l) => l.ei !== s.ei && crossesRect(s, l.r) && !onSharedTrunk(s, l))
      .map((l) => ({ rule: "d", message: `${segName(s)} が${l.name}を貫いている` })),
  );
}

// (f) 同じノードに入る線の端が、他の線の端と区別できる間隔（矢印の頭の幅）で離れているか。
// 同じノードから出る線どうしは、幹線として同じ点から出してよいので比べない。
/**
 * @param {DiagramNode[]} nodes
 * @param {{ e: DiagramEdge, pts: Point[] }[]} routed
 * @returns {Violation[]}
 */
function checkEntryPoints(nodes, routed) {
  return nodes.flatMap((n) =>
    pairs(endsAt(n.id, routed))
      .filter(
        ([u, v]) =>
          u.ei !== v.ei &&
          (u.incoming || v.incoming) &&
          Math.hypot(u.p.x - v.p.x, u.p.y - v.p.y) < ARROW_GAP,
      )
      .map(([u, v]) => ({
        rule: "f",
        message: `ノード ${n.id} で ${edgeName(u.e)} の端 ${pt(u.p)} と ${edgeName(v.e)} の端 ${pt(v.p)} が ${ARROW_GAP}px 未満で、入る位置を区別できない`,
      })),
  );
}

// ノードにつながる線の端（入る線は最後の点、出る線は最初の点）。
/**
 * @param {string} id
 * @param {{ e: DiagramEdge, pts: Point[] }[]} routed
 */
function endsAt(id, routed) {
  return routed.flatMap(({ e, pts }, ei) => [
    ...(e.to === id ? [{ ei, e, p: pts[pts.length - 1], incoming: true }] : []),
    ...(e.from === id ? [{ ei, e, p: pts[0], incoming: false }] : []),
  ]);
}

// 配列の要素の 2 つ組（順序を区別しない）。
/**
 * @template T
 * @param {T[]} list
 * @returns {[T, T][]}
 */
function pairs(list) {
  /** @type {[T, T][]} */
  const out = [];
  list.forEach((u, i) => {
    for (const v of list.slice(i + 1)) out.push([u, v]);
  });
  return out;
}

// (g) 線が、端点のノードを含まないグループの内側を通っていないか。
/**
 * @param {Segment[]} segs
 * @param {DiagramGroup[]} groups
 * @param {(id: string) => DiagramNode} node
 * @returns {Violation[]}
 */
function checkSegmentsThroughGroups(segs, groups, node) {
  return segs.flatMap((s) =>
    groups
      .filter((g) => {
        const r = groupRect(g);
        const related = containsPoint(r, node(s.e.from)) || containsPoint(r, node(s.e.to));
        return !related && crossesRect(s, r);
      })
      .map((g) => ({
        rule: "g",
        message: `${segName(s)} が、端点を含まないグループ「${g.label}」を貫いている`,
      })),
  );
}

// (h) 線が、グループの枠線に 20px 未満の間隔で沿っていないか。
/**
 * @param {Segment[]} segs
 * @param {DiagramGroup[]} groups
 * @returns {Violation[]}
 */
function checkSegmentsAlongFrames(segs, groups) {
  return segs.flatMap((s) =>
    groups.flatMap((g) => {
      const near = nearFrame(s, g);
      return near === undefined
        ? []
        : [
            {
              rule: "h",
              message: `${segName(s)} がグループ「${g.label}」の枠線（${s.vertical ? "x" : "y"}=${near}）に ${PARALLEL_GAP}px 未満で沿っている`,
            },
          ];
    }),
  );
}

// 区間と平行で、20px 未満の間隔にある枠線の座標。区間と枠線の範囲が重ならなければ、沿っていないとして undefined を返す。
/**
 * @param {Segment} s
 * @param {DiagramGroup} g
 * @returns {number | undefined}
 */
function nearFrame(s, g) {
  const r = groupRect(g);
  const [borders, lo, hi] = s.vertical
    ? [[r.left, r.right], r.top, r.bottom]
    : [[r.top, r.bottom], r.left, r.right];
  if (Math.max(s.lo, lo) >= Math.min(s.hi, hi)) return undefined;
  return borders.find((at) => Math.abs(s.at - at) < PARALLEL_GAP);
}

// (i) グループの枠とキャンバスの端の間に、50px 以上の余白があるか。
/**
 * @param {DiagramSpec} spec
 * @returns {Violation[]}
 */
function checkCanvasMargin(spec) {
  const { W, H, groups = [] } = spec;
  return groups
    .filter((g) => {
      const r = groupRect(g);
      return (
        r.left < CANVAS_MARGIN ||
        r.top < CANVAS_MARGIN ||
        r.right > W - CANVAS_MARGIN ||
        r.bottom > H - CANVAS_MARGIN
      );
    })
    .map((g) => ({
      rule: "i",
      message: `グループ「${g.label}」とキャンバス（${W}x${H}）の端の間の余白が ${CANVAS_MARGIN}px 未満`,
    }));
}

// (j) 別のエッジの線が、飛び越し（line jump）の付かない形で接していないか。
// エンジンは、水平の区間が他のエッジの垂直の区間を内側で横切るときだけ飛び越しを付ける。
// 一方の線の端や屈曲点が他方の線の上に乗る形（T 字・L 字）は飛び越しが付かず、接続と区別できない。
// 飛び越しを付けるかは、エンジンが線を描く単位の区間で決まる。自動の L 字が直線を分けた点で交わると、
// どちらの区間も相手を内側で横切らないので、飛び越しが付かない。そのため、付くかはまとめる前の区間で判定する。
// 端点を共有するエッジ（幹線の分岐と合流）は、接して見えるのが意図なので除く。
/**
 * @param {Segment[]} segs まとめた区間
 * @param {Segment[]} raw エンジンが描く単位の区間
 */
function checkJunctions(segs, raw) {
  // エンジンの飛び越しの条件（diagram-engine.mjs の hopXs）と同じ。
  /**
   * @param {Segment} h
   * @param {Segment} v
   */
  const hops = (h, v) => h.lo + 1 < v.at && v.at < h.hi - 1 && v.lo < h.at - 1 && v.hi > h.at + 1;
  /**
   * @param {Segment} h
   * @param {Segment} v
   */
  const hopped = (h, v) =>
    raw.some(
      (rh) =>
        rh.ei === h.ei &&
        !rh.vertical &&
        rh.at === h.at &&
        raw.some((rv) => rv.ei === v.ei && rv.vertical && rv.at === v.at && hops(rh, rv)),
    );
  /** @type {Violation[]} */
  const out = [];
  const verticals = segs.filter((s) => s.vertical);
  for (const h of segs.filter((s) => !s.vertical)) {
    for (const v of verticals) {
      if (h.ei === v.ei || sharesEnd(h.e, v.e)) continue;
      const touches = h.lo <= v.at && v.at <= h.hi && v.lo <= h.at && h.at <= v.hi;
      if (touches && !hopped(h, v)) {
        out.push({
          rule: "j",
          message: `${segName(h)} と ${segName(v)} が (${v.at},${h.at}) で飛び越しなしに接し、接続と区別できない`,
        });
      }
    }
  }
  return out;
}

/**
 * @param {DiagramSpec} spec
 * @returns {Violation[]}
 */
export function checkDiagram(spec) {
  const { nodes = [], groups = [] } = spec;
  const routed = routeEdges(spec);
  const raw = rawSegmentsOf(routed);
  const segs = mergeCollinear(raw);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  /** @param {string} id */
  const node = (id) => {
    const n = byId.get(id);
    // routeEdges が未知のノードを先にエラーにするので、ここには来ない
    if (!n) throw new Error(`未知のノード: ${id}`);
    return n;
  };
  const all = [
    ...checkNodesInGroups(nodes, groups),
    ...checkSegmentsThroughIcons(segs, nodes),
    ...checkParallelGaps(segs),
    ...checkSegmentsThroughLabels(segs, nodes, routed),
    ...checkEntryPoints(nodes, routed),
    ...checkSegmentsThroughGroups(segs, groups, node),
    ...checkSegmentsAlongFrames(segs, groups),
    ...checkCanvasMargin(spec),
    ...checkJunctions(segs, raw),
  ];
  return all.sort((p, q) => (p.rule < q.rule ? -1 : p.rule > q.rule ? 1 : 0));
}
