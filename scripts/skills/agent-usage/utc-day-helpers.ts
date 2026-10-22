// aggregate.test.ts と github.test.ts のヘルパー。テストで使う固定の日（UTC）の時刻を、時と分から作る。
export const iso = (h: number, m = 0) =>
  `2026-10-01T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;
export const ms = (h: number, m = 0) => Date.parse(iso(h, m));
