// AWS 構成図の描画エンジン（複数環境の図で共用する純関数）。
// spec を受け取り SVG 文字列を返す。GUI 不要・テキスト差分で管理できる。
// 作図ルールと品質確認は SKILL のガイド（references/conventions.md）を参照。
//
// spec = { W, H, title, nodes, edges, groups, notes? }
//   node : { id, icon, label:[行...], x, y, lp, dim? }
//            icon = アイコンディレクトリ相対のパス（拡張子なし。例 "aws-icons/lambda"）。
//                   null なら無地の箱を描く。
//            lp   = ラベル位置 "top"|"bottom"|"left"|"right"（線の出ていない辺へ寄せる）。
//            dim  = true で淡色化（環境差分の「未使用」表現）。
//   edge : { from, to, label?, dashed?, waypoints?, dim? }
//            waypoints = [[x,y]...] 直交配線の経由点。無ければ自動 L 字。
//   group: { label, x, y, w, h, color }   背景の枠（左上基準）。
//   notes: [{ x, y, w, title, lines:[...] }]   凡例/注記ボックス。
//
// 使い方: renderDiagram(spec, { iconDir })  ← iconDir にアイコン群のルートを渡す。
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

const ICON = 64; // アイコン一辺 (px)
const HOP = 5; // 交差の飛び越し（line jump）半径
const FONT =
  '-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// ラベル等をSVGテキストへ埋め込むときのXMLエスケープ（& < > で壊れないように）。
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderDiagram(spec, options = {}) {
  const { W, H, title, nodes = [], edges = [], groups = [], notes = [] } = spec;
  const { iconDir } = options;
  if (!iconDir) throw new Error("renderDiagram: options.iconDir が必要です");

  // ノード間の矢印は最大 1 本。重複した from→to はここで弾く（配置ミスの早期検出）。
  const seenEdge = new Set();
  for (const e of edges) {
    const key = `${e.from}->${e.to}`;
    if (seenEdge.has(key)) throw new Error(`重複エッジ: ${key}（ノード間の矢印は最大 1 本）`);
    seenEdge.add(key);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const node = (id) => {
    const n = byId.get(id);
    if (!n) throw new Error(`未知のノード: ${id}`);
    return n;
  };

  // アイコン SVG を <svg> ネストとして取り込み、元の viewBox を引き継ぐ。
  // iconDir の外（.. や絶対パス）は読み込ませない。
  const iconCache = new Map();
  let iconDirReal; // iconDir の実体パス（symlink 解決後）。初回に一度だけ解決する。
  let iconSeq = 0; // 埋め込みごとに内部 id を名前空間化するための連番。
  const embedIcon = (name, x, y) => {
    let inner = iconCache.get(name);
    if (inner === undefined) {
      const file = join(iconDir, `${name}.svg`);
      // 1) 字面のチェック（spec の name に .. / 絶対パスが混ざっても弾く）。
      const rel = relative(iconDir, file);
      if (rel.startsWith("..") || isAbsolute(rel))
        throw new Error(`アイコンパスが iconDir の外を指しています: ${name}`);
      // 2) 実体（symlink 解決後）が iconDir 配下かを検証（iconDir 内の外向き symlink 対策）。
      iconDirReal ??= realpathSync(iconDir);
      let fileReal;
      try {
        fileReal = realpathSync(file);
      } catch {
        throw new Error(`アイコンが見つかりません: ${name}`);
      }
      const relReal = relative(iconDirReal, fileReal);
      if (relReal.startsWith("..") || isAbsolute(relReal))
        throw new Error(`アイコンパスが iconDir の外を指しています（symlink 経由）: ${name}`);
      const raw = readFileSync(fileReal, "utf8");
      const head = raw.match(/<svg[^>]*>/);
      if (!head) throw new Error(`アイコン SVG が不正（<svg> がありません）: ${name}`);
      // viewBox はシングル/ダブルクォート両対応（自作アイコンで ' を使っても崩れない）。
      const viewBox = head[0].match(/viewBox=["']([^"']+)["']/)?.[1] ?? "0 0 80 80";
      const body = raw
        .replace(/<\?xml[^>]*\?>/, "")
        .replace(/<svg[^>]*>/, "")
        .replace(/<\/svg>\s*$/, "")
        // 取得元（AWS パッケージ）や自作アイコンに万一 <script> や on* ハンドラが
        // 含まれても出力 SVG へ混入させない（多層防御）。
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
        .replace(/<script\b[^>]*\/>/gi, "")
        .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
        .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
        .trim();
      inner = { viewBox, body };
      iconCache.set(name, inner);
    }
    // 同じ図に複数のアイコンを埋めると内部 id（clipPath/gradient/mask 等）が衝突し、
    // url(#id)/href="#id" が別アイコンの要素を参照してしまう。埋め込みごとに一意の
    // 接頭辞で id とその参照を書き換えて分離する。クォート種別（" / '）や xlink:href、
    // url() 内のクォート有無を問わず置換する（取得元 SVG・自作アイコンの表記ゆれ対策）。
    const p = `ic${iconSeq++}-`;
    const body = inner.body
      .replace(/\bid=(["'])([^"']+)\1/g, `id=$1${p}$2$1`)
      .replace(/\b((?:xlink:)?href)=(["'])#([^"']+)\2/g, `$1=$2#${p}$3$2`)
      .replace(/\burl\((["']?)#([^"')]+)\1\)/g, `url($1#${p}$2$1)`);
    return `<svg x="${x}" y="${y}" width="${ICON}" height="${ICON}" viewBox="${inner.viewBox}" overflow="visible">${body}</svg>`;
  };

  const box = (n) => {
    const h = ICON / 2;
    return { left: n.x - h, right: n.x + h, top: n.y - h, bottom: n.y + h };
  };

  // ノード境界上の接続点。最も近い辺を選び、辺に平行な座標は接近点(px,py)へ合わせる。
  // これにより waypoint を動かすと辺上の進入位置を制御できる（複数線の進入をずらす）。
  const anchor = (n, px, py) => {
    const b = box(n);
    const PAD = 12;
    if (Math.abs(px - n.x) >= Math.abs(py - n.y)) {
      return { x: px >= n.x ? b.right : b.left, y: clamp(py, b.top + PAD, b.bottom - PAD) };
    }
    return { x: clamp(px, b.left + PAD, b.right - PAD), y: py >= n.y ? b.bottom : b.top };
  };

  // 経路の座標列。waypoints があればそれを経由、無ければ直交 L 字を自動生成。
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

  // ラベルを線の出ていない辺へ配置。
  const label = (n) => {
    const b = box(n);
    const lines = n.label ?? [];
    const lh = 14;
    let x;
    let y;
    let align;
    if (n.lp === "top") {
      x = n.x;
      align = "middle";
      y = b.top - 8 - (lines.length - 1) * lh;
    } else if (n.lp === "left") {
      x = b.left - 8;
      align = "end";
      y = n.y - ((lines.length - 1) * lh) / 2 + 4;
    } else if (n.lp === "right") {
      x = b.right + 8;
      align = "start";
      y = n.y - ((lines.length - 1) * lh) / 2 + 4;
    } else {
      x = n.x;
      align = "middle";
      y = b.bottom + 16;
    }
    return lines
      .map(
        (line, i) =>
          `<text x="${x}" y="${y + i * lh}" text-anchor="${align}" font-family='${FONT}' font-size="12" fill="#16191F">${esc(line)}</text>`,
      )
      .join("\n  ");
  };

  // 全エッジの経路を先に確定し、垂直セグメント一覧を作る（交差の飛び越し判定用）。
  const routed = edges.map((e) => ({ e, pts: route(node(e.from), node(e.to), e) }));
  const verticals = [];
  routed.forEach(({ pts }, ei) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a.x === b.x && a.y !== b.y)
        verticals.push({ ei, x: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
    }
  });

  // 水平セグメントが他エッジの垂直セグメントと交わる点で半円アーチ（∩）を描く。
  const pathD = (pts, ei) => {
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a.y === b.y && a.x !== b.x) {
        const dir = b.x > a.x ? 1 : -1;
        const y = a.y;
        const hops = [
          ...new Set(
            verticals
              .filter(
                (v) =>
                  v.ei !== ei &&
                  v.x > Math.min(a.x, b.x) + 1 &&
                  v.x < Math.max(a.x, b.x) - 1 &&
                  v.lo < y - 1 &&
                  v.hi > y + 1,
              )
              .map((v) => v.x),
          ),
        ].sort((p, q) => (dir > 0 ? p - q : q - p));
        for (const cx of hops) {
          d += ` L ${cx - dir * HOP} ${y} A ${HOP} ${HOP} 0 0 ${dir > 0 ? 1 : 0} ${cx + dir * HOP} ${y}`;
        }
        d += ` L ${b.x} ${b.y}`;
      } else {
        d += ` L ${b.x} ${b.y}`;
      }
    }
    return d;
  };

  const out = [];
  out.push(
    `<rect x="0" y="0" width="${W}" height="${H}" fill="#FFFFFF"/>`,
    `<text x="28" y="44" font-family='${FONT}' font-size="22" font-weight="700" fill="#16191F">${esc(title)}</text>`,
  );

  // グループ枠（最背面）。
  for (const g of groups) {
    out.push(
      `<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="10" fill="${g.color}" fill-opacity="0.04" stroke="${g.color}" stroke-width="2"/>`,
      `<text x="${g.x + 12}" y="${g.y + 24}" font-family='${FONT}' font-size="14" font-weight="600" fill="${g.color}">${esc(g.label)}</text>`,
    );
  }

  // エッジ（ノードより先に描いて背面へ）。dim は淡色。
  routed.forEach(({ e, pts }, ei) => {
    const stroke = e.dim ? "#B9C2CE" : "#5A6B86";
    const marker = e.dim ? "arrowDim" : "arrow";
    out.push(
      `<path d="${pathD(pts, ei)}" fill="none" stroke="${stroke}" stroke-width="1.8" marker-end="url(#${marker})"${e.dashed ? ' stroke-dasharray="6,4"' : ""}/>`,
    );
    if (e.label) {
      const mid = pts[Math.floor(pts.length / 2)];
      // 全角（CJK 等の非 Latin-1）は ASCII より広いので、文字幅を出し分けて背景がラベルより
      // 狭くならないようにする（font-size 11 での概算: Latin-1 ≈ 6.5px / 全角 ≈ 11px）。
      const textW = [...e.label].reduce((a, ch) => a + (/[ -ÿ]/.test(ch) ? 6.5 : 11), 0);
      const w = Math.ceil(textW) + 12;
      out.push(
        `<rect x="${mid.x - w / 2}" y="${mid.y - 10}" width="${w}" height="18" rx="3" fill="#FFFFFF" fill-opacity="0.92"/>`,
        `<text x="${mid.x}" y="${mid.y + 3}" text-anchor="middle" font-family='${FONT}' font-size="11" fill="#5A6B86">${esc(e.label)}</text>`,
      );
    }
  });

  // ノード（アイコン + ラベル）。
  for (const n of nodes) {
    const b = box(n);
    const icon = n.icon
      ? embedIcon(n.icon, b.left, b.top)
      : `<rect x="${b.left}" y="${b.top}" width="${ICON}" height="${ICON}" rx="6" fill="#EAEDED" stroke="#5A6B86" stroke-width="1.5"/>`;
    const body = `${icon}\n  ${label(n)}`;
    out.push(n.dim ? `<g opacity="0.32">${body}</g>` : body);
  }

  // 注記/凡例ボックス（最前面）。
  for (const note of notes) {
    const h = 30 + note.lines.length * 16 + 6;
    out.push(
      `<rect x="${note.x}" y="${note.y}" width="${note.w}" height="${h}" rx="8" fill="#F4F6F8" stroke="#C2CAD4" stroke-width="1"/>`,
      `<text x="${note.x + 14}" y="${note.y + 22}" font-family='${FONT}' font-size="13" font-weight="700" fill="#16191F">${esc(note.title)}</text>`,
      ...note.lines.map(
        (line, i) =>
          `<text x="${note.x + 14}" y="${note.y + 42 + i * 16}" font-family='${FONT}' font-size="12" fill="#3A4452">${esc(line)}</text>`,
      ),
    );
  }

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
