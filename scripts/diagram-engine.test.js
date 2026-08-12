// aws-architecture-diagram の描画エンジンの回帰テスト。
//
// 対象は目視では守り切れない 2 点（Issue #196）:
//   1. エッジラベルが屈曲点に乗ると白背景が角を覆い、「線が折れていること」が図から消える。
//      自動 L 字は常に 4 点なので、中央インデックス固定だと必ず屈曲点に乗っていた。
//   2. 斜めのエッジ（直交配線違反）は目視で見落とすため、エンジンが描画前にエラーで止める。
//
// アイコンは埋め込みを避けるため icon: null（無地の箱）で描く。配置・経路の計算は
// アイコンの有無に依存しない（ICON は固定サイズ）ため、幾何の検証には影響しない。

import { test, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillDir = join(repoRoot, "skills/aws-architecture-diagram");
const { renderDiagram } = await import(join(skillDir, "assets/engine/diagram-engine.mjs"));
const iconDir = join(skillDir, "assets/starter/icons");

const render = (spec) => renderDiagram(spec, { iconDir });
const noIcons = (spec) => ({ ...spec, nodes: spec.nodes.map((n) => ({ ...n, icon: null })) });

/** 描かれたエッジ経路の点列（line jump のアーチは含めず M/L の頂点だけ）。 */
function pathPoints(svg) {
  const d = svg.match(/<path d="([^"]+)" fill="none"/)[1];
  return [...d.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: +m[1], y: +m[2] }));
}

/** 前後の点と向きが変わる点（＝屈曲点）。 */
function bends(pts) {
  return pts.filter((p, i) => {
    if (i === 0 || i === pts.length - 1) return false;
    const a = pts[i - 1];
    const c = pts[i + 1];
    return !((a.x === p.x && p.x === c.x) || (a.y === p.y && p.y === c.y));
  });
}

/** エッジラベルの背景矩形（rx="3" はエッジラベル背景だけが使う）。 */
function labelBox(svg) {
  const m = svg.match(
    /<rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="3"/,
  );
  const [x, y, w, h] = m.slice(1).map(Number);
  return { left: x, right: x + w, top: y, bottom: y + h };
}

/** ラベルの基準点（背景矩形は基準点から x に -w/2、y に -10 ずらして描かれる）。 */
function labelAnchor(svg) {
  const box = labelBox(svg);
  return { x: (box.left + box.right) / 2, y: box.top + 10 };
}

/** 斜めに配置した 2 ノード + ラベル付きエッジ（Issue #196 の再現 spec）。 */
const diagonalPair = {
  W: 600,
  H: 400,
  title: "label",
  nodes: [
    { id: "a", icon: null, label: ["A"], x: 100, y: 100, lp: "top" },
    { id: "b", icon: null, label: ["B"], x: 500, y: 300, lp: "top" },
  ],
  edges: [{ from: "a", to: "b", label: "LABEL" }],
  groups: [],
};

test("自動 L 字のエッジラベルが屈曲点を覆わない", () => {
  const svg = render(diagonalPair);
  const pts = pathPoints(svg);
  const corners = bends(pts);
  // 屈曲の無い経路で検査すると素通りするため、検査対象が屈曲していることを先に固定する。
  expect(corners.length).toBeGreaterThan(0);

  const box = labelBox(svg);
  for (const c of corners) {
    expect(
      c.x >= box.left && c.x <= box.right && c.y >= box.top && c.y <= box.bottom,
      `屈曲点 (${c.x},${c.y}) がラベル背景 ${JSON.stringify(box)} に覆われている`,
    ).toBe(false);
  }
});

test("ラベルは直線区間の上に置かれる", () => {
  const svg = render(diagonalPair);
  const pts = pathPoints(svg);
  const { x: cx, y: cy } = labelAnchor(svg);
  // 基準点が経路のいずれかの直線区間上（両端の間）にあること。
  const onSegment = pts.slice(0, -1).some((a, i) => {
    const b = pts[i + 1];
    if (a.x === b.x) return cx === a.x && cy > Math.min(a.y, b.y) && cy < Math.max(a.y, b.y);
    return cy === a.y && cx > Math.min(a.x, b.x) && cx < Math.max(a.x, b.x);
  });
  expect(onSegment).toBe(true);
});

test("直線経路のラベル位置は中央のまま（既存の図を動かさない）", () => {
  const svg = render({
    ...diagonalPair,
    nodes: diagonalPair.nodes.map((n) => ({ ...n, y: 200 })),
  });
  const pts = pathPoints(svg);
  expect(labelAnchor(svg).x).toBe((pts[0].x + pts[pts.length - 1].x) / 2);
});

test("labelAt でラベル位置を明示できる", () => {
  const svg = render({
    ...diagonalPair,
    edges: [{ from: "a", to: "b", label: "LABEL", labelAt: [200, 150] }],
  });
  expect(labelAnchor(svg)).toEqual({ x: 200, y: 150 });
});

test("waypoints が斜めの区間を作るとエラーで止まる", () => {
  expect(() =>
    render({
      ...diagonalPair,
      edges: [
        {
          from: "a",
          to: "b",
          waypoints: [
            [300, 100],
            [400, 300], // 前の点と x も y も共有していない = 斜め
          ],
        },
      ],
    }),
  ).toThrow(/斜めのエッジ: a->b/);
});

test("ノード境界のアンカー丸めで生じる斜めも検出する", () => {
  // waypoint 同士は直交しているが、最初の waypoint が a の中心から y 方向に 20px 超
  // 離れているため、辺上のアンカーが丸められて最初の区間が斜めになる。
  expect(() =>
    render({
      ...diagonalPair,
      edges: [
        {
          from: "a",
          to: "b",
          waypoints: [
            [300, 200],
            [300, 300],
          ],
        },
      ],
    }),
  ).toThrow(/斜めのエッジ: a->b/);
});

test("同梱テンプレート（starter）の全環境が直交検査を通る", async () => {
  const { environments, baseSpec } = await import(
    join(skillDir, "assets/starter/environments.mjs")
  );
  const names = Object.keys(environments);
  // 環境が空だと素通りするため、母集合が空でないことを先に固定する。
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) {
    const env = environments[name];
    const spec = env.transform ? env.transform(structuredClone(baseSpec)) : baseSpec;
    // エッジが 0 本だと直交検査に何も掛からず素通りするため、検査対象があることも固定する。
    expect(spec.edges?.length ?? 0, `環境 ${name} のエッジ`).toBeGreaterThan(0);
    expect(() => render(noIcons(spec)), `環境 ${name}`).not.toThrow();
  }
});

test("直交検査は starter の spec に対しても働く（陽性コントロール）", async () => {
  const { environments, baseSpec } = await import(
    join(skillDir, "assets/starter/environments.mjs")
  );
  const name = Object.keys(environments)[0];
  const env = environments[name];
  const spec = noIcons(env.transform ? env.transform(structuredClone(baseSpec)) : baseSpec);
  // 1 本だけ斜めに壊した spec は必ず落ちること（＝上のテストの green が「検査が
  // 走っていない」ではなく「違反が無い」ことを意味すると示す）。
  const target = spec.edges[0];
  const from = spec.nodes.find((n) => n.id === target.from);
  const broken = {
    ...spec,
    edges: [{ ...target, waypoints: [[from.x + 200, from.y + 200]] }],
  };
  expect(() => render(broken)).toThrow(/斜めのエッジ/);
});
