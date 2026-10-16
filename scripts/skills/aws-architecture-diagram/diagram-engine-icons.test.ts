// aws-architecture-diagram の描画エンジンが、アイコンの SVG を図に埋め込む処理のテスト。
//
// エンジンは spec の icon が指す `<iconDir>/<name>.svg` を読み、<svg> の入れ子として図に埋め込む。
// 確かめる状態は次のとおりである。
//   - 読む場所: iconDir の中のファイル / `..` で外を指す名前 / iconDir の中から外へ向く symlink / 無いファイル
//   - 中身: <svg> の無いファイル / viewBox の引用符（" と '）と viewBox の無いもの / <script> と on* の属性
//   - 埋め込みの回数: 同じアイコンを 2 回使う（内部の id が衝突しないように書き換えるか）

import { expect, test } from "vitest";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderDiagram } from "../../../skills/aws-architecture-diagram/assets/engine/diagram-engine.mjs";
import type { DiagramSpec } from "../../../skills/aws-architecture-diagram/assets/engine/diagram-engine.mjs";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

/** アイコンを files（名前 → 中身）で置いた iconDir を作る。 */
function iconDir(files: Record<string, string>): string {
  const dir = join(makeTempDir("diagram-icons-"), "icons");
  mkdirSync(dir);
  for (const [name, content] of Object.entries(files))
    writeFileSync(join(dir, `${name}.svg`), content);
  return dir;
}

/** icons の順にアイコンを付けたノードを横に並べ、隣どうしを水平のエッジでつなぐ spec。 */
function spec(icons: string[]): DiagramSpec {
  const nodes = icons.map((icon, i) => ({
    id: `n${i}`,
    icon,
    label: [`N${i}`],
    x: 100 + i * 200,
    y: 100,
  }));
  const edges = nodes.slice(1).map((n, i) => ({ from: `n${i}`, to: n.id }));
  return { W: 200 + icons.length * 200, H: 200, title: "t", nodes, edges, groups: [] };
}

/** 埋め込まれたアイコン（x 属性を持つ入れ子の <svg>）を取り出す。 */
function embedded(svg: string): string[] {
  return [...svg.matchAll(/<svg x="[^"]+" y="[^"]+"[^>]*>[\s\S]*?<\/svg>/g)].map((m) => m[0]);
}

test("iconDir の中のアイコンを、元の viewBox のまま埋め込む", () => {
  const dir = iconDir({
    dq: '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect class="dq"/></svg>',
    sq: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 16'><circle class='sq'/></svg>",
  });
  const icons = embedded(renderDiagram(spec(["dq", "sq"]), { iconDir: dir }));
  expect(icons).toHaveLength(2);
  expect(icons[0]).toContain('viewBox="0 0 64 64"');
  expect(icons[0]).toContain('<rect class="dq"/>');
  // XML 宣言は入れ子の中に残さない（文書の途中に置くと SVG として不正になる）。
  expect(icons[0]).not.toContain("<?xml");
  expect(icons[1]).toContain('viewBox="0 0 32 16"');
  expect(icons[1]).toContain("<circle class='sq'/>");
});

test("viewBox の無いアイコンは 0 0 80 80 で埋め込む", () => {
  const dir = iconDir({ plain: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>' });
  const [icon] = embedded(renderDiagram(spec(["plain", "plain"]), { iconDir: dir }));
  expect(icon).toContain('viewBox="0 0 80 80"');
});

test("アイコンに含まれる <script> と on* の属性は図に入れない", () => {
  const dir = iconDir({
    evil: [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">',
      "<script>alert(1)</script>",
      '<script src="x.js"/>',
      '<rect onclick="a()" width="1"/>',
      "<rect onload='b()' width=\"2\"/>",
      '<rect onmouseover=c() width="3"/>',
      "</svg>",
    ].join(""),
  });
  const svg = renderDiagram(spec(["evil", "evil"]), { iconDir: dir });
  expect(svg).not.toMatch(/<script/i);
  expect(svg).not.toMatch(/\son[a-z]+\s*=/i);
  // 取り除くのはハンドラだけで、同じ要素の他の属性は残す。
  expect(svg).toContain('<rect width="1"/>');
  expect(svg).toContain('<rect width="2"/>');
  expect(svg).toContain('<rect width="3"/>');
});

test("同じアイコンを 2 回埋め込むと、内部の id とその参照を埋め込みごとに別の名前にする", () => {
  const dir = iconDir({
    grad: [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">',
      "<linearGradient id=\"g\"/><clipPath id='c'/>",
      '<rect fill="url(#g)" clip-path="url(\'#c\')"/>',
      "<use href=\"#g\"/><use xlink:href='#c'/>",
      "</svg>",
    ].join(""),
  });
  const icons = embedded(renderDiagram(spec(["grad", "grad"]), { iconDir: dir }));
  expect(icons).toHaveLength(2);
  const ids = icons.map((icon) => [...icon.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]));
  // 2 つの埋め込みの id が重ならない。
  expect(ids[0]).toHaveLength(2);
  expect(ids[1]).toHaveLength(2);
  expect(ids[0].filter((id) => ids[1].includes(id))).toEqual([]);
  // 参照は、同じ埋め込みの中の書き換えた id を指す。
  for (const [i, icon] of icons.entries()) {
    const [g, c] = ids[i];
    expect(icon).toContain(`fill="url(#${g})"`);
    expect(icon).toContain(`clip-path="url('#${c}')"`);
    expect(icon).toContain(`href="#${g}"`);
    expect(icon).toContain(`xlink:href='#${c}'`);
  }
});

test("`..` で iconDir の外を指す名前は読まずにエラーにする", () => {
  const dir = iconDir({});
  writeFileSync(join(dir, "..", "outside.svg"), '<svg viewBox="0 0 1 1"/>');
  expect(() => renderDiagram(spec(["../outside", "../outside"]), { iconDir: dir })).toThrow(
    /アイコンパスが iconDir の外を指しています: \.\.\/outside/,
  );
});

test("iconDir の中から外へ向く symlink は、実体の場所でエラーにする", () => {
  const dir = iconDir({});
  const outside = join(dir, "..", "secret.svg");
  writeFileSync(outside, '<svg viewBox="0 0 1 1"><rect/></svg>');
  symlinkSync(outside, join(dir, "link.svg"));
  expect(() => renderDiagram(spec(["link", "link"]), { iconDir: dir })).toThrow(
    /symlink 経由.*link/,
  );
});

test("iconDir の中を指す symlink は埋め込む（検出されることの確認の対照）", () => {
  const dir = iconDir({ real: '<svg viewBox="0 0 5 5"><rect class="real"/></svg>' });
  symlinkSync(join(dir, "real.svg"), join(dir, "alias.svg"));
  const [icon] = embedded(renderDiagram(spec(["alias", "alias"]), { iconDir: dir }));
  expect(icon).toContain('<rect class="real"/>');
});

test("無いアイコンは名前を示すエラーにする", () => {
  expect(() => renderDiagram(spec(["missing", "missing"]), { iconDir: iconDir({}) })).toThrow(
    /アイコンが見つかりません: missing/,
  );
});

test("<svg> の無いファイルは不正なアイコンとしてエラーにする", () => {
  const dir = iconDir({ broken: "<html>not an svg</html>" });
  expect(() => renderDiagram(spec(["broken", "broken"]), { iconDir: dir })).toThrow(
    /アイコン SVG が不正（<svg> がありません）: broken/,
  );
});
