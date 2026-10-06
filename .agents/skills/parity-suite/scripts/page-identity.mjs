// capture_conditions.pages[].path を URL へ解決し、押した後の URL を宣言済みのページへ一意に引く（原本）。
//
// 何のためか: 撮影の単位はページ × 状態名 × ビューポートで、使い回しの照合（reaction-check.mjs）は
// 「押した後に撮ったページ」（capture_page）を名乗らせて数える。名乗りを押した後の URL（aftermath.returns_to.url_after）と
// 照合しないと、同じ URL に着く 2 操作が別のページ名を名乗り、1 枚の撮影が両方の操作を満たしても根拠を求められない。
// 照合のキーも名前ではなく解決したページにする（別名で同じページを指す 2 つの名前は同じ 1 枚）。
//
// 解決規則は次のとおりである（原本は references/baseline.md「ページの path の解決規則」。ここと食い違わせない）。
//   - path は target の baseURL（metadata.json の target.ui_url）に対して WHATWG URL の相対解決（new URL(path, baseURL)）で解く。
//     Playwright の page.goto(path) が baseURL を当てる規則と同じなので、撮影が開いたページと同じ URL になる。
//     `/` で始まる path は baseURL のパス接頭辞を捨てる（`https://host/portal/` に `/orders` は `https://host/orders`）。
//     接頭辞の下へ着かせたいなら `orders` と相対で書く。末尾の `/` の無い baseURL（`https://host/portal`）は最後の区間が置き換わる
//   - ページの識別はパス（pathname）の完全一致。末尾スラッシュ・大文字小文字を正規化しない（`orders` と `archive/orders` は別）
//   - クエリ・フラグメントは path に書いたときだけ識別に含め、書いたものと完全一致を要求する（書かなければ何でも合う）
//   - 1 つの URL に複数のページが合うなら、クエリ・フラグメントを多く書いた方（より狭い方）を採る。同じ狭さで別のページが残れば曖昧
//   - target.ui_url が "runtime"（url_command の target。URL を成果物に残さない）なら baseURL が無いので、
//     `/` で始まる path だけを解ける。相対の path が 1 つでもあれば照合しない（理由を返す。オリジンは照合に使わない）
//
// 決定論的: 乱数・現在時刻・ネットワークに依存しない。TypeScript 構文は使わない（型は JSDoc）。

/** baseURL の無い（runtime の）とき、`/` で始まる path を解くためだけに当てるオリジン。照合はパス以降しか見ない。 */
const PLACEHOLDER_ORIGIN = "http://runtime.invalid/";

/**
 * @typedef {{ name: string, path: string, pathname: string, search: string | null, hash: string | null, key: string }} ResolvedPage
 *
 * search / hash は path に書いたときだけ文字列（`?` / `#` を含む）、書いていなければ null（照合で何でも合う）。
 * key は照合のキー（pathname と、書いた search / hash を連ねたもの）。別名のページは同じ key になる。
 */

/**
 * @typedef {{
 *   resolvable: boolean,
 *   reason: string | null,
 *   pages: Map<string, ResolvedPage>,
 *   unresolved: Map<string, string>,
 *   problems: string[],
 * }} PageResolution
 *
 * resolvable: 全てのページを解けたか（false なら URL との照合をしない。reason に理由）。
 * pages: 解けたページだけ（名前 → 解決結果）。problems: 入力の誤り（path が空・解けない・baseURL が URL でない）。
 * unresolved: runtime で baseURL が無く解けなかった相対の path（名前 → 書いた path）。使い回しは書いた path で数える。
 */

/**
 * @param {unknown} v
 * @returns {v is string}
 */
const nonEmptyString = (v) => typeof v === "string" && v.trim() !== "";

/**
 * baseURL（target.ui_url）を読む。runtime は null、絶対 URL（http / https）はその URL、それ以外は誤り。
 * @param {unknown} uiUrl
 * @returns {{ base: URL | null, runtime: boolean, problem: string | null }}
 */
export function readBaseUrl(uiUrl) {
  if (uiUrl === "runtime") return { base: null, runtime: true, problem: null };
  if (nonEmptyString(uiUrl)) {
    try {
      const u = new URL(uiUrl);
      if (u.protocol === "http:" || u.protocol === "https:") {
        return { base: u, runtime: false, problem: null };
      }
    } catch {
      // 下で誤りとして返す
    }
  }
  return {
    base: null,
    runtime: false,
    problem: `target.ui_url が絶対 URL（http / https）でも "runtime" でもない: ${JSON.stringify(uiUrl ?? null)}（capture_conditions.pages[].path を解決する baseURL が無い）`,
  };
}

/**
 * path が `/` で始まるオリジン相対か（`//` はスキーム相対なので含めない）。
 * @param {string} path
 */
// バックスラッシュは http(s) の URL では "/" と同じに読まれる（`/\\host/x` はスキーム相対になり別のホストへ解ける）ので、含むものは受けない
const originRelative = (path) =>
  path.startsWith("/") && !path.startsWith("//") && !path.includes("\\");

/**
 * 解いた URL から照合のキーを作る。
 * @param {string} pathname
 * @param {string | null} search
 * @param {string | null} hash
 */
const keyOf = (pathname, search, hash) => JSON.stringify([pathname, search ?? null, hash ?? null]);

/**
 * capture_conditions.pages を baseURL に対して解く。
 * @param {unknown} pages - capture_conditions.pages（名前の重複・欠けの検査は呼び出し側が持つ）
 * @param {unknown} uiUrl - target.ui_url
 * @returns {PageResolution}
 */
export function resolvePages(pages, uiUrl) {
  /** @type {Map<string, ResolvedPage>} */
  const resolved = new Map();
  /** @type {string[]} */
  const problems = [];
  const list = Array.isArray(pages) ? pages : [];
  const baseRead = readBaseUrl(uiUrl);
  if (baseRead.problem !== null) {
    return {
      resolvable: false,
      reason: baseRead.problem,
      pages: resolved,
      unresolved: new Map(),
      problems: [baseRead.problem],
    };
  }
  /** @type {Map<string, string>} */
  const unresolved = new Map();
  for (const pg of list) {
    if (typeof pg !== "object" || pg === null || Array.isArray(pg)) continue;
    const name = /** @type {Record<string, unknown>} */ (pg).name;
    const path = /** @type {Record<string, unknown>} */ (pg).path;
    if (!nonEmptyString(name)) continue;
    if (typeof path !== "string") {
      problems.push(
        `capture_conditions.pages の "${name}" に path（baseURL からの相対パス。根のページは空文字列）が無い`,
      );
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//") || path.includes("\\")) {
      problems.push(
        `capture_conditions.pages の "${name}" の path がオリジンを持つかバックスラッシュを含む（${path}）。baseURL からの相対パスを "/" 区切りで書く`,
      );
      continue;
    }
    if (baseRead.runtime && !originRelative(path)) {
      unresolved.set(name, path);
      continue;
    }
    const u = new URL(path, baseRead.base ?? PLACEHOLDER_ORIGIN);
    // フラグメントの中の `?`（`#/orders?tab=1`）はクエリではない
    const search = path.split("#")[0].includes("?") ? u.search : null;
    const hash = path.includes("#") ? u.hash : null;
    resolved.set(name, {
      name,
      path,
      pathname: u.pathname,
      search,
      hash,
      key: keyOf(u.pathname, search, hash),
    });
  }
  if (problems.length > 0) {
    return {
      resolvable: false,
      reason: problems.join(" / "),
      pages: resolved,
      unresolved,
      problems,
    };
  }
  if (unresolved.size > 0) {
    return {
      resolvable: false,
      reason: `target.ui_url が "runtime" で baseURL が成果物に無く、相対の path（${[...unresolved.keys()].join(", ")}）を解決できない（押した後の URL との照合をしない。照合させるなら path を baseURL のパス接頭辞を含めて "/" から書く）`,
      pages: resolved,
      unresolved,
      problems: [],
    };
  }
  return { resolvable: true, reason: null, pages: resolved, unresolved, problems: [] };
}

/**
 * 押した後の URL（`/` で始まるオリジンを除いたパス。クエリ・フラグメントを含む）を、宣言済みのページへ一意に引く。
 * @param {string} urlAfter
 * @param {PageResolution} resolution - resolvable: true のもの
 * @returns {{ page: ResolvedPage | null, problem: string | null }}
 */
export function pageForUrl(urlAfter, resolution) {
  if (!originRelative(urlAfter)) {
    return { page: null, problem: `"${urlAfter}" が "/" で始まるオリジンを除いたパスでない` };
  }
  const u = new URL(urlAfter, PLACEHOLDER_ORIGIN);
  /** @type {ResolvedPage[]} */
  const hits = [];
  for (const pg of resolution.pages.values()) {
    if (pg.pathname !== u.pathname) continue;
    if (pg.search !== null && pg.search !== u.search) continue;
    if (pg.hash !== null && pg.hash !== u.hash) continue;
    hits.push(pg);
  }
  if (hits.length === 0) {
    return {
      page: null,
      problem: `"${urlAfter}" が capture_conditions.pages のどのページにも解決しない（パス ${u.pathname}）`,
    };
  }
  const narrowness = (/** @type {ResolvedPage} */ p) =>
    (p.search === null ? 0 : 1) + (p.hash === null ? 0 : 1);
  const top = Math.max(...hits.map(narrowness));
  const best = hits.filter((p) => narrowness(p) === top);
  const keys = new Set(best.map((p) => p.key));
  if (keys.size > 1) {
    return {
      page: null,
      problem: `"${urlAfter}" が同じ狭さの複数のページ（${best.map((p) => p.name).join(", ")}）に解決する（path のクエリ・フラグメントで分ける）`,
    };
  }
  return { page: best[0], problem: null };
}

/**
 * 使い回しの照合のキー。解けたページは解決結果（別名は同じ 1 枚）。
 * runtime で解けない相対の path は書いた path の文字列で数える（URL との照合はしないが、同じ path を書いた別名は同じ 1 枚にまとめる。
 * 名前で数えると、別名を名乗り分けるだけで根拠なしの使い回しが通る）。どれでもなければ名前で数える。
 * @param {string} name
 * @param {PageResolution | null} resolution
 */
export function pageKey(name, resolution) {
  const pg = resolution?.pages.get(name);
  if (pg) return `url:${pg.key}`;
  const raw = resolution?.unresolved.get(name);
  return raw !== undefined ? `path:${raw}` : `name:${name}`;
}
