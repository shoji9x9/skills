// aws-architecture-diagram の作図ルールの検査（diagram-checks.mjs）のテスト（Issue #931）。
//
// 検査する観点ごとに、違反を 1 つだけ置いた spec でその観点だけが出ること、
// 違反の無い spec（境界の値を含む）で何も出ないことを確かめる。検査する観点は、(e) を除く 9 つである。
// 観点 (e)（矢印の向き）はエンジンが作り方で保証する（marker-end を常に to の側に付ける）ので、検査しない。
// 同梱の見本（starter の全環境・the-simple-webservice）は違反が 0 件であることも確かめる。

import { expect, test } from "vitest";
import { checkDiagram } from "../../../skills/aws-architecture-diagram/scripts/diagram-checks.mjs";
import {
  renderDiagram,
  routeEdges,
} from "../../../skills/aws-architecture-diagram/scripts/diagram-engine.mjs";
import type {
  DiagramEdge,
  DiagramGroup,
  DiagramNode,
  DiagramSpec,
} from "../../../skills/aws-architecture-diagram/scripts/diagram-engine.mjs";
import * as starter from "../../../skills/aws-architecture-diagram/assets/starter/environments.mjs";
import * as simple from "../../../skills/aws-architecture-diagram/assets/samples/the-simple-webservice/environments.mjs";

/** 無地の箱のノード。ラベルの位置などを変えるときは、返り値に足す（`{ ...node("c", 0, 0), lp: "top" }`）。 */
const node = (id: string, x: number, y: number): DiagramNode => ({
  id,
  icon: null,
  label: [id.toUpperCase()],
  x,
  y,
});

/** 600x400 のキャンバスの spec。 */
const spec = (
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  groups: DiagramGroup[] = [],
): DiagramSpec => ({
  W: 600,
  H: 400,
  title: "T",
  nodes,
  edges,
  groups,
});

const rules = (s: DiagramSpec) => checkDiagram(s).map((v) => v.rule);

// a(200,200) と b(400,200) を水平につなぎ、両方を余白 32px 以上で囲むグループに入れる（違反の無い基準）。
const group = (extra: Partial<DiagramGroup> = {}): DiagramGroup => ({
  label: "G",
  x: 100,
  y: 80,
  w: 400,
  h: 260,
  color: "#000",
  ...extra,
});
const a = node("a", 200, 200);
const b = node("b", 400, 200);
const ab: DiagramEdge = { from: "a", to: "b" };

test("違反の無い基準の spec では、何も出さない", () => {
  expect(checkDiagram(spec([a, b], [ab], [group()]))).toEqual([]);
});

test.each([
  ["枠の内側の余白が 8px", node("a", 140, 200)],
  ["アイコンが枠線をまたぐ", node("a", 110, 200)],
])("(a) ノードの%sとき、(a) を出す", (_label, moved) => {
  const v = checkDiagram(spec([moved, b], [ab], [group()]));
  expect(v.map((x) => x.rule)).toEqual(["a"]);
  expect(v[0].message).toContain("ノード a がグループ「G」");
});

test.each([
  ["枠の内側の余白がちょうど 32px", node("a", 164, 200)],
  ["枠の外にあり、枠線から 8px 離れている", node("c", 540, 200)],
])("(a) ノードの%sとき、出さない", (_label, extra) => {
  expect(rules(spec([a, b, extra], [ab], [group()]))).toEqual([]);
});

test("(b) 線が端点でないノードのアイコンを貫くと、(b) を出す", () => {
  const v = checkDiagram(spec([a, b, node("c", 300, 200)], [ab], [group()]));
  expect(v.map((x) => x.rule)).toEqual(["b"]);
  expect(v[0].message).toContain("a->b の区間");
  expect(v[0].message).toContain("ノード c のアイコン");
});

test("(b) 線がアイコンの辺に触れるだけなら、出さない", () => {
  expect(rules(spec([a, b, node("c", 300, 232)], [ab], [group()]))).toEqual([]);
});

// c(200,260) から d(400,260) へ、a->b の線の近くを通って戻る。
const detour = (y: number): DiagramEdge => ({
  from: "c",
  to: "d",
  waypoints: [
    [260, 260],
    [260, y],
    [340, y],
    [340, 260],
  ],
});
const a160 = node("a", 200, 160);
const b160 = node("b", 400, 160);
const c260 = node("c", 200, 260);
const d260 = node("d", 400, 260);

test("(c) 別のエッジの平行な区間が 10px で並ぶと、(c) を出す", () => {
  const v = checkDiagram(spec([a160, b160, c260, d260], [ab, detour(170)]));
  expect(v.map((x) => x.rule)).toEqual(["c"]);
  expect(v[0].message).toContain("間隔が 10px");
});

test("(c) 平行な区間の間隔がちょうど 20px なら、出さない", () => {
  expect(rules(spec([a160, b160, c260, d260], [ab, detour(180)]))).toEqual([]);
});

const e300 = node("e", 400, 300);
const trunk = (y: number): DiagramEdge => ({
  from: "a",
  to: "e",
  waypoints: [
    [300, y],
    [300, 300],
  ],
});

test("(c)(j) 同じ依存元から出る線が同じ座標で重なり、そこから分かれる幹線は、出さない", () => {
  expect(rules(spec([a, b, e300], [ab, trunk(200)]))).toEqual([]);
});

test("(d) 幹線の上に置いた一方のラベルを、同じ座標で重なる他方の線が通っても、出さない", () => {
  expect(
    rules(spec([a, b, e300], [{ ...ab, label: "L", labelAt: [260, 200] }, trunk(200)])),
  ).toEqual([]);
});

test("(d) 端点を共有するエッジでも、ラベルを垂直に貫くなら、(d) を出す", () => {
  const v = checkDiagram(
    spec([a, b, e300], [{ ...ab, label: "L", labelAt: [300, 210] }, trunk(200)]),
  );
  expect(v.map((x) => x.rule)).toEqual(["d"]);
  expect(v[0].message).toContain("a->e の区間 (300,200)-(300,300) がエッジ a->b のラベル");
});

test("(d) 幹線を共有するエッジでも、ラベルの中心が幹線の外にあれば、(d) を出す", () => {
  // a->e のラベルを、幹線（x=232〜300）の先の x=340 に置く。そこを通るのは a->b だけである。
  const v = checkDiagram(
    spec([a, b, e300], [ab, { ...trunk(200), label: "L", labelAt: [340, 200] }]),
  );
  expect(v.map((x) => x.rule)).toEqual(["d"]);
  expect(v[0].message).toContain("a->b の区間");
});

test("(c)(j) 同じ依存元から出る線が、別の点から出て幹線に寄り、そこから分かれる形は、出さない", () => {
  // a->b は a の上から、a->c は a の下から出て、y=140 の上で x=200〜300 を重なって進む（幹線にいったん寄せてから分岐させる形）。
  // 寄る点 (200,140) と分かれる点 (300,140) は幹線の端なので、(j) にしない。
  const a2 = { ...node("a", 100, 200), lp: "left" };
  const toB: DiagramEdge = {
    from: "a",
    to: "b",
    waypoints: [
      [100, 140],
      [300, 140],
      [300, 100],
    ],
  };
  const toC: DiagramEdge = {
    from: "a",
    to: "c",
    waypoints: [
      [100, 260],
      [200, 260],
      [200, 140],
      [400, 140],
      [400, 300],
    ],
  };
  expect(rules(spec([a2, node("b", 500, 100), node("c", 500, 300)], [toB, toC]))).toEqual([]);
});

test("(c)(j) 同じ先へ入る線が幹線で合流し、分かれて別の点で入る形は、出さない", () => {
  // p->c と q->c が y=200 の上で x=250〜330 を重なって進み、x=330 で分かれて c に y=185 と y=215 で入る。
  const merge = (from: string, y0: number, y1: number): DiagramEdge => ({
    from,
    to: "c",
    waypoints: [
      [250, y0],
      [250, 200],
      [330, 200],
      [330, y1],
    ],
  });
  expect(
    rules(
      spec(
        [node("p", 100, 100), node("q", 100, 300), node("c", 500, 200)],
        [merge("p", 100, 185), merge("q", 300, 215)],
      ),
    ),
  ).toEqual([]);
});

test("(c) 同じ依存元から出る線でも、間隔が 0 より大きく 20px 未満なら、(c) を出す", () => {
  expect(rules(spec([a, b, e300], [ab, trunk(210)]))).toEqual(["c"]);
});

test("(c)(j) 端点を共有しないエッジが同じ座標で重なると、(c) と、接する点の (j) を出す", () => {
  const c = node("c", 200, 300);
  const d = node("d", 400, 300);
  const overlap: DiagramEdge = {
    from: "c",
    to: "d",
    waypoints: [
      [260, 300],
      [260, 200],
      [340, 200],
      [340, 300],
    ],
  };
  expect(rules(spec([a, b, c, d], [ab, overlap]))).toEqual(["c", "j", "j"]);
});

// c と d を結ぶ水平の線が、a のラベル（a の下、y=236〜252）の高さを通る。
const underA = (y: number) =>
  spec([a, node("c", 100, y), node("d", 400, y)], [{ from: "c", to: "d" }]);

test("(d) 線がノードのラベルの矩形を貫くと、(d) を出す", () => {
  const v = checkDiagram(underA(244));
  expect(v.map((x) => x.rule)).toEqual(["d"]);
  expect(v[0].message).toContain("ノード a のラベル");
});

test("(d) 線がノードのラベルの矩形の下を通るなら、出さない", () => {
  expect(rules(underA(256))).toEqual([]);
});

test("(d) 線が他のエッジのラベルを貫くと、(d) を出す（自分のラベルは対象にしない）", () => {
  // c->d は x=320 を縦に進み、a->b の線を飛び越しの付く形で横切る。a->b のラベルを交点に置く。
  const c = { ...node("c", 320, 100), lp: "top" };
  const d = node("d", 320, 300);
  const cd: DiagramEdge = {
    from: "c",
    to: "d",
    label: "OWN",
    labelAt: [320, 150],
    waypoints: [
      [320, 150],
      [320, 250],
    ],
  };
  const v = checkDiagram(spec([a, b, c, d], [{ ...ab, label: "LBL", labelAt: [320, 200] }, cd]));
  expect(v.map((x) => x.rule)).toEqual(["d"]);
  expect(v[0].message).toContain("c->d の区間");
  expect(v[0].message).toContain("エッジ a->b のラベル");
});

// a(200,150) と c(200,250) から b(400,200) の左の辺へ入る。
const into = (from: string, y0: number, y1: number): DiagramEdge => ({
  from,
  to: "b",
  waypoints: [
    [300, y0],
    [300, y1],
  ],
});

test("(f) 同じノードに 2 本の線が同じ点で入ると、(f) を出す", () => {
  const v = checkDiagram(
    spec([node("a", 200, 150), node("c", 200, 250), b], [into("a", 150, 200), into("c", 250, 200)]),
  );
  expect(v.map((x) => x.rule)).toEqual(["f"]);
  expect(v[0].message).toContain("ノード b で a->b の端 (368,200) と c->b の端 (368,200)");
});

test("(f) 同じノードに入る線の端が 20px 離れていれば、出さない", () => {
  expect(
    rules(
      spec(
        [node("a", 200, 150), node("c", 200, 250), b],
        [into("a", 150, 200), into("c", 250, 220)],
      ),
    ),
  ).toEqual([]);
});

test("(f) ノードに入る線の端と、同じノードから出る線の端が同じ点なら、(f) を出す", () => {
  const out: DiagramEdge = {
    from: "b",
    to: "e",
    waypoints: [
      [340, 200],
      [340, 300],
    ],
  };
  expect(rules(spec([a, b, e300], [ab, out]))).toContain("f");
});

test("(g) 線が端点を含まないグループの内側を通ると、(g) を出す", () => {
  const v = checkDiagram(
    spec(
      [node("a", 150, 200), node("b", 450, 200)],
      [ab],
      [group({ x: 250, w: 100, y: 120, h: 160 })],
    ),
  );
  expect(v.map((x) => x.rule)).toEqual(["g"]);
  expect(v[0].message).toContain("端点を含まないグループ「G」");
});

test("(g) 線が端点のノードを含むグループに入るのは、出さない", () => {
  expect(
    rules(
      spec(
        [node("a", 150, 200), node("b", 450, 200)],
        [ab],
        [group({ x: 350, w: 170, y: 120, h: 160 })],
      ),
    ),
  ).toEqual([]);
});

const along = (y: number): DiagramEdge => ({
  ...ab,
  waypoints: [
    [200, y],
    [400, y],
  ],
});

test("(h) 線がグループの枠線に 15px で沿うと、(h) を出す", () => {
  const v = checkDiagram(spec([a, b], [along(95)], [group()]));
  expect(v.map((x) => x.rule)).toEqual(["h"]);
  expect(v[0].message).toContain("枠線（y=80）");
});

test("(h) 線とグループの枠線の間隔がちょうど 20px なら、出さない", () => {
  expect(rules(spec([a, b], [along(100)], [group()]))).toEqual([]);
});

test.each([
  ["左", { x: 40, w: 460 }],
  ["上", { y: 40, h: 300 }],
  ["右", { w: 460 }],
  ["下", { h: 300 }],
])("(i) グループの%sとキャンバスの端の間が 50px 未満なら、(i) を出す", (_label, extra) => {
  expect(rules(spec([a, b], [ab], [group(extra)]))).toEqual(["i"]);
});

test.each([
  ["左と上", { x: 50, y: 50, w: 450, h: 290 }],
  ["右と下", { w: 450, h: 270 }],
])("(i) グループの%sとキャンバスの端の間がちょうど 50px なら、出さない", (_label, extra) => {
  expect(rules(spec([a, b], [ab], [group(extra)]))).toEqual([]);
});

// c から d へ縦に進み、a->b の水平の線と y=200 で交わる。
const vertical = (x: number) => [node("c", x, 320), { ...node("d", x, 60), lp: "top" }];

test("(j) 屈曲点が他のエッジの線の上に乗り、飛び越しが付かないと、(j) を出す", () => {
  const v = checkDiagram(
    spec([a, b, ...vertical(320)], [ab, { from: "c", to: "d", waypoints: [[320, 200]] }]),
  );
  expect(v.map((x) => x.rule)).toEqual(["j"]);
  expect(v[0].message).toContain("(320,200) で飛び越しなしに接し");
});

test("(j) 自動の L 字が線を分けた点（a->b の中点 x=300）で交わると、飛び越しが付かないので (j) を出す", () => {
  const v = checkDiagram(spec([a, b, ...vertical(300)], [ab, { from: "c", to: "d" }]));
  expect(v.map((x) => x.rule)).toEqual(["j"]);
  expect(v[0].message).toContain("(300,200)");
});

test("(j) 同じ依存元から出る線どうしでも、別の点から出て飛び越しなしに交わるなら、(j) を出す", () => {
  // a->b は a の下から縦に進み、自動の L 字が y=200 で線を分ける。a->c は a の左から出て、その点を横切る。
  const a2 = { ...node("a", 200, 60), lp: "top" };
  const toC: DiagramEdge = {
    from: "a",
    to: "c",
    waypoints: [
      [100, 60],
      [100, 200],
    ],
  };
  const v = checkDiagram(spec([a2, node("b", 200, 340), node("c", 400, 200)], [ab, toC]));
  expect(v.map((x) => x.rule)).toEqual(["j"]);
  expect(v[0].message).toContain("(200,200)");
});

test("(j) 幹線を共有する線でも、幹線の外で飛び越しなしに接するなら、(j) を出す", () => {
  // a->e は幹線（a->b と y=200 の上を x=232〜300）から下へ分かれた後、x=340 で a->b の線まで戻って接する。
  const back: DiagramEdge = {
    from: "a",
    to: "e",
    waypoints: [
      [300, 200],
      [300, 300],
      [340, 300],
      [340, 200],
      [340, 150],
    ],
  };
  const v = checkDiagram(spec([a, b, node("e", 440, 150)], [ab, back]));
  expect(v.map((x) => x.rule)).toEqual(["j"]);
  expect(v[0].message).toContain("(340,200)");
});

test("(j) 幹線から分かれた線が、幹線の途中に戻って飛び越しなしに接するなら、(j) を出す", () => {
  // a->e は幹線（y=200 の上を x=232〜300）の端 (300,200) で分かれ、x=260 で幹線の途中 (260,200) に戻って接する。
  const back: DiagramEdge = {
    from: "a",
    to: "e",
    waypoints: [
      [300, 200],
      [300, 300],
      [260, 300],
      [260, 200],
      [260, 150],
    ],
  };
  const v = checkDiagram(spec([a, b, node("e", 440, 150)], [ab, back]));
  expect(v.map((x) => x.rule)).toEqual(["j"]);
  expect(v[0].message).toContain("(260,200)");
});

test.each([
  ["W が NaN（書き忘れた W を計算に使ったときの値）", { W: Number.NaN }],
  ["H が無限大", { H: Number.POSITIVE_INFINITY }],
])("キャンバスの大きさの%s spec は、検査も描画もエラーにする", (_label, broken) => {
  const s = { ...spec([a, b], [ab], [group()]), ...broken };
  expect(() => checkDiagram(s)).toThrow("spec の W と H は数で書く");
  expect(() => renderDiagram(s, { iconDir: "/nonexistent" })).toThrow("spec の W と H は数で書く");
});

test("routed が同じ spec から計算したものでなければ、検査も描画もエラーにする", () => {
  const s = spec([a, b], [ab], [group()]);
  const other = spec([a, b], [{ ...ab }], [group()]);
  const opts = { iconDir: "/nonexistent" };
  expect(checkDiagram(s, routeEdges(s))).toEqual([]);
  expect(() => checkDiagram(s, routeEdges(other))).toThrow("routed が spec のエッジと対応しない");
  expect(() => checkDiagram(s, [])).toThrow("routed が spec のエッジと対応しない");
  expect(() => renderDiagram(s, { ...opts, routed: routeEdges(other) })).toThrow(
    "routed が spec のエッジと対応しない",
  );
});

test("routed を渡しても、キャンバスの大きさが数でない spec は、検査も描画もエラーにする", () => {
  const s = spec([a, b], [ab], [group()]);
  const routed = routeEdges(s);
  const broken = { ...s, W: Number.NaN };
  expect(() => checkDiagram(broken, routed)).toThrow("spec の W と H は数で書く");
  expect(() => renderDiagram(broken, { iconDir: "/nonexistent", routed })).toThrow(
    "spec の W と H は数で書く",
  );
});

test("(j) 交差に飛び越しが付くなら、出さない", () => {
  expect(rules(spec([a, b, ...vertical(320)], [ab, { from: "c", to: "d" }]))).toEqual([]);
});

test("違反は観点の記号の順に並べる", () => {
  // (i) と (a) を同時に起こす: グループを左にずらし、a の余白も足りなくする。
  const v = rules(spec([node("a", 70, 200), b], [ab], [group({ x: 40, w: 460 })]));
  expect(v).toEqual(["a", "i"]);
});

test("同梱の見本（starter）の全環境は、違反が 0 件である", () => {
  const envs = Object.entries(starter.environments);
  expect(envs.map(([name]) => name)).toEqual(["prod", "local"]);
  for (const [name, env] of envs) {
    const s =
      "transform" in env ? env.transform(structuredClone(starter.baseSpec)) : starter.baseSpec;
    expect(checkDiagram(s), name).toEqual([]);
  }
});

test("同梱の見本（the-simple-webservice）は、違反が 0 件である", () => {
  expect(Object.keys(simple.environments)).toEqual(["prod"]);
  expect(checkDiagram(simple.baseSpec)).toEqual([]);
});
