// 時刻の扱い。記録はすべて UTC の ISO 8601（末尾 Z）にそろえ、日付と時間帯は人ごとのタイムゾーンで切る。

/**
 * ISO 8601 などの時刻の文字列をミリ秒にする。読めなければ null。
 * オフセットの無い文字列は、実行環境のタイムゾーンで解釈されて結果が環境で変わるので、受け付けない。
 * @param {unknown} value
 * @returns {number | null}
 */
export function parseTime(value) {
  if (typeof value !== "string" || value === "") return null;
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {number} ms
 * @returns {string}
 */
export function toIso(ms) {
  return new Date(ms).toISOString();
}

/**
 * タイムゾーンの名前が使えるか（IANA の名前）。
 * @param {string} tz
 * @returns {boolean}
 */
export function isValidTimeZone(tz) {
  if (tz === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** 実行環境のタイムゾーン。 */
export function systemTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** @type {Map<string, Intl.DateTimeFormat>} */
const formatters = new Map();

/**
 * @param {string} tz
 * @returns {Intl.DateTimeFormat}
 */
function formatterFor(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    });
    formatters.set(tz, f);
  }
  return f;
}

/**
 * タイムゾーンでの日付（YYYY-MM-DD）・時（0〜23）・曜日（Mon〜Sun）。
 * @param {number} ms
 * @param {string} tz
 * @returns {{ date: string; hour: number; weekday: string }}
 */
export function localParts(ms, tz) {
  /** @type {Record<string, string>} */
  const p = {};
  for (const part of formatterFor(tz).formatToParts(new Date(ms))) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekday: p.weekday };
}

/**
 * 区間 [start, end) を、タイムゾーンでの正時の境界で分ける。夏時間で 1 時間が 30 分などになっても、境界は実際の正時に置く。
 * @param {number} start
 * @param {number} end
 * @param {string} tz
 * @returns {{ start: number; end: number; date: string; hour: number; weekday: string }[]}
 */
export function splitByLocalHour(start, end, tz) {
  /** @type {{ start: number; end: number; date: string; hour: number; weekday: string }[]} */
  const out = [];
  let cur = start;
  while (cur < end) {
    const parts = localParts(cur, tz);
    // 次の正時は、15 分刻みで進めて時が変わる位置を探す（オフセットが 15 分単位のタイムゾーンにも合う）
    let next = Math.floor(cur / 900000) * 900000 + 900000;
    while (
      next < end &&
      localParts(next, tz).hour === parts.hour &&
      localParts(next, tz).date === parts.date
    ) {
      next += 900000;
    }
    const segEnd = Math.min(next, end);
    out.push({ start: cur, end: segEnd, ...parts });
    cur = segEnd;
  }
  return out;
}
