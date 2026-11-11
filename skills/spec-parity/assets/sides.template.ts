/**
 * 現行と新側の URL の対応表（雛形）— spec-parity
 *
 * このファイルは、プロジェクトへコピーして使う雛形である。コピー先は `tests/parity/sides.ts` にする。
 * e2e の設定（e2e.config.ts）とテストの両方が読む。
 *
 * e2e の targets は、同じテストを current と new の 2 つの URL に当てる。テストの中では target の名前を読めないので、
 * テストは `app.baseUrl` から、この対応表で側（current / new）を求める（e2e 0.23.0 で確かめた）。
 * URL は、スキルが replace-strategy の targets から解決して、環境変数で渡す。
 *   PARITY_CURRENT_UI_URL・PARITY_CURRENT_API_URL … 現行の UI と API の baseURL（API を省くと UI と同じ）。
 *   PARITY_NEW_UI_URL・PARITY_NEW_API_URL         … 新側の UI と API の baseURL（API を省くと UI と同じ）。
 * 渡していない側は、設定の targets に入れない（`npx e2e run --target new` は、新側の URL が無いと設定の誤りで止まる）。
 */

export type Side = "current" | "new";

type Urls = { app: string; api: string };

function urlsOf(prefix: "CURRENT" | "NEW"): Urls | null {
  const app = process.env[`PARITY_${prefix}_UI_URL`];
  if (!app) return null;
  return { app, api: process.env[`PARITY_${prefix}_API_URL`] || app };
}

// 末尾の / の有無で別の URL にしない
function originAndPath(url: string): string {
  const u = new URL(url);
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

const current = urlsOf("CURRENT");
const next = urlsOf("NEW");

export const SIDES: Partial<Record<Side, Urls>> = {
  ...(current ? { current } : {}),
  ...(next ? { new: next } : {}),
};

/** app.baseUrl から側を求める。どちらにも当たらない・両方に当たるときは止める（取り違えた側で期待値を選ばない）。 */
export function sideOf(baseUrl: string): Side {
  const candidates: [Side, Urls | undefined][] = [
    ["current", SIDES.current],
    ["new", SIDES.new],
  ];
  const hits = candidates
    .filter(([, urls]) => urls !== undefined && originAndPath(urls.app) === originAndPath(baseUrl))
    .map(([side]) => side);
  const [hit] = hits;
  if (hits.length !== 1 || hit === undefined)
    throw new Error(
      `側を決められない baseUrl: ${baseUrl}（当たった側: ${hits.join(", ") || "なし"}）`,
    );
  return hit;
}

/** 側の API の baseURL。テストの中の fetch で API を特性化するときに使う。 */
export function apiOf(baseUrl: string): string {
  const urls = SIDES[sideOf(baseUrl)];
  if (!urls) throw new Error(`API の URL が無い: ${baseUrl}`);
  return urls.api;
}
