// golden-dataset フェーズ A（dataset_mode: static）が生成した投入ツール（fixture の初期状態）。
// 削除 → 生成 → 検証を 1 エントリで走らせる。冪等・決定論的（id は固定、日付は BASE_TIME からの相対）。
// 書き込み先は設定の dataset_static_paths 配下だけに限る。

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_TIME = new Date("2026-05-01T00:00:00Z");
const ALLOWED_PATHS = ["content/works"]; // dataset_static_paths（設定由来ゲート）
const OUT_DIR = "content/works";

type Work = {
  id: string;
  title: string;
  tags: string[];
  daysBeforeBase: number;
  summary: string;
  body: string;
  slug: string;
};

const works: Work[] = [
  {
    id: "001",
    slug: "001-city-library",
    title: "市立図書館 蔵書検索リニューアル",
    tags: ["web", "accessibility"],
    daysBeforeBase: 7,
    summary: "蔵書検索の導線を見直し、絞り込みとページ送りを整理した。",
    body: "貸出履歴を持たない利用者でも目的の資料に辿り着けるよう、検索結果の絞り込み条件を並べ替えた。",
  },
  {
    id: "002",
    slug: "002-harbor-cafe",
    title: "港町のカフェ 予約サイト",
    tags: ["web"],
    daysBeforeBase: 14,
    summary: "席種と時間帯を 1 画面で選べる予約フォームを作った。",
    body: "予約の取り消し・変更を電話に頼らず完結できるよう、確認メールから辿れる導線を用意した。",
  },
];

function assertWritable(dir: string): void {
  if (!ALLOWED_PATHS.some((allowed) => dir === allowed || dir.startsWith(`${allowed}/`))) {
    throw new Error(`書き込み先 ${dir} が dataset_static_paths の外にある。設定を確認して停止する。`);
  }
}

function isoDate(daysBeforeBase: number): string {
  const t = new Date(BASE_TIME.getTime() - daysBeforeBase * 24 * 60 * 60 * 1000);
  return t.toISOString().slice(0, 10);
}

function clean(): void {
  assertWritable(OUT_DIR);
  mkdirSync(OUT_DIR, { recursive: true });
  for (const name of readdirSync(OUT_DIR)) {
    if (name.endsWith(".md")) rmSync(join(OUT_DIR, name));
  }
}

function seed(): void {
  for (const w of works) {
    const frontmatter = [
      "---",
      `id: "${w.id}"`,
      `title: ${w.title}`,
      `tags: [${w.tags.join(", ")}]`,
      `published_at: ${isoDate(w.daysBeforeBase)}`,
      `cover: /images/works/${w.id}.png`,
      `summary: ${w.summary}`,
      "---",
    ].join("\n");
    writeFileSync(join(OUT_DIR, `${w.slug}.md`), `${frontmatter}\n\n${w.body}\n`);
  }
}

function verify(): void {
  const files = readdirSync(OUT_DIR).filter((n) => n.endsWith(".md"));
  if (files.length !== works.length) {
    throw new Error(`件数不一致: expected ${works.length}, got ${files.length}`);
  }
  const ids = new Set(works.map((w) => w.id));
  if (ids.size !== works.length) throw new Error("id が一意でない");
}

clean();
seed();
verify();
