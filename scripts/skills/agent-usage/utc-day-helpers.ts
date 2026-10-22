// aggregate.test.ts と github.test.ts のヘルパー。テストで使う固定の日（UTC）の時刻を、時と分から作る。
export const iso = (h: number, m = 0) =>
  `2026-10-01T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;
export const ms = (h: number, m = 0) => Date.parse(iso(h, m));
/** iso と同じ時刻を、Date#toISOString の書式（ミリ秒の .000 を含む）で返す。 */
export const isoMs = (h: number, m = 0) => new Date(ms(h, m)).toISOString();
