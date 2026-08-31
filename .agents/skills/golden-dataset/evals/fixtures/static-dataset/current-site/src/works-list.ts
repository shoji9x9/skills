export type Work = {
  id: string;
  tags: string[];
  publishedAt: string;
};

export const PAGE_SIZE = 6;

export function listWorks(works: Work[], tag: string | null, page: number): Work[] {
  const filtered = tag === null ? works : works.filter((work) => work.tags.includes(tag));
  const sorted = [...filtered].sort(
    (a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id),
  );
  const offset = (page - 1) * PAGE_SIZE;
  return sorted.slice(offset, offset + PAGE_SIZE);
}

// UI は URL の page を tag 変更時にも保持する。tag 候補はデータ中の tags から生成する。
export function updateTagQuery(currentPage: number, tag: string): URLSearchParams {
  return new URLSearchParams({ page: String(currentPage), tag });
}
