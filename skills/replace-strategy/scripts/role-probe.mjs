// セマンティクス測定の role プローブ。
// 使い方: `node <このファイル>` を実行し、stdout に出る関数式のソースを chrome-devtools MCP の evaluate_script の
// function 引数にそのまま渡す。Node はソースを組み立てて出すだけで、測定はしない（測るのはブラウザの document）。
// evaluate_script は渡された関数を自ら呼び出して実行し、返り値を JSON で返すため、IIFE 化（`(...)()`）は不要である。
//
// 測るもの: 可視の対象要素（インタラクティブ要素に加え、見出し・テーブル・画像など
// role ロケータの対象になる要素）のうち、role ＋アクセシブルネームで引ける割合。
// アクセシブルネームの算出は仕様（accname）の近似であり、値は目安として扱う
//（references/measurement.md を参照）。決定論的: 乱数・時刻に依存せず、document 順に走査する。
//
// ページで実行する処理は、本体の roleProbeInPage と、ROLE_PROBE_PAGE に並べたヘルパーに分けて書く。
// ページへはソースだけが渡るので、ヘルパーはモジュールの名前を参照せず、互いを引数の一覧（`h`）を通して呼ぶ。
// 1 つの関数式へのまとめ方は lib/page-function.mjs にある。

import { isCliEntry } from "./lib/cli.mjs";
import { pageFunctionSource } from "./lib/page-function.mjs";

/**
 * 走査する要素。labels・type・value は、それを持つ要素（input・select など）でだけ値がある。
 * @typedef {Element & { labels?: NodeListOf<HTMLLabelElement> | null, type?: unknown, value?: unknown }} ProbedElement
 */

/**
 * role ごとの件数と、名前の重複を数える表（tally の返り値）。
 * @typedef {{
 *   byRole: Record<string, { total: number, named: number }>,
 *   nameCountByRole: Record<string, Record<string, number>>,
 *   unnamedSamples: { tag: string, role: string | null, path: string }[],
 *   named: number,
 * }} RoleTally
 */

/** 暗黙の role。上から順に当て、最初に当たったものを使う。 */
const IMPLICIT_ROLES = [
  ["a[href]", "link"],
  ["button", "button"],
  ["input[type=button], input[type=submit], input[type=reset], input[type=image]", "button"],
  ["input[type=checkbox]", "checkbox"],
  ["input[type=radio]", "radio"],
  ["input[type=range]", "slider"],
  ["input[type=search]", "searchbox"],
  [
    "input:not([type]), input[type=text], input[type=email], input[type=tel], input[type=url], input[type=password], input[type=number], input[type=date], input[type=datetime-local], input[type=time], input[type=month], input[type=week]",
    "textbox",
  ],
  ["select[multiple], select[size]:not([size='1'])", "listbox"],
  ["select", "combobox"],
  ["textarea", "textbox"],
  ["summary", "button"],
  ["h1, h2, h3, h4, h5, h6", "heading"],
  ["table", "table"],
  ["img[alt]:not([alt=''])", "img"],
];

/** @param {Element} el */
function isVisible(el) {
  if (el.closest("[aria-hidden=true]")) return false;
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** @param {Element | null} el */
function text(el) {
  return el ? (el.textContent || "").replace(/\s+/g, " ").trim() : "";
}

/**
 * aria-labelledby が指す要素の内容テキストを空白でつなぐ。指す要素が無い・空なら空文字。
 * @param {RoleProbeHelpers} h
 * @param {Element} el
 */
function labelledbyName(h, el) {
  const labelledby = el.getAttribute("aria-labelledby");
  if (!labelledby) return "";
  return labelledby
    .split(/\s+/)
    .map((id) => h.text(document.getElementById(id)))
    .filter(Boolean)
    .join(" ");
}

/**
 * 関連付けられた label の内容テキストを空白でつなぐ。label が無い・空なら空文字。
 * @param {RoleProbeHelpers} h
 * @param {ProbedElement} el
 */
function labelsName(h, el) {
  if (!el.labels || !el.labels.length) return "";
  return Array.from(el.labels).map(h.text).filter(Boolean).join(" ");
}

/**
 * button 系の input の value。それ以外の要素と、value が空のときは空文字。
 * @param {ProbedElement} el
 */
function buttonValue(el) {
  if (
    el.tagName.toLowerCase() === "input" &&
    typeof el.type === "string" &&
    ["button", "submit", "reset"].includes(el.type) &&
    typeof el.value === "string"
  ) {
    return el.value.trim();
  }
  return "";
}

// accname の近似: aria-label > aria-labelledby > label 関連付け > alt > value(button 系) >
// 内容テキスト > title > placeholder。空文字は「名前なし」。
/**
 * @param {RoleProbeHelpers} h
 * @param {ProbedElement} el
 */
function accessibleName(h, el) {
  const ariaLabel = (el.getAttribute("aria-label") || "").trim();
  if (ariaLabel) return ariaLabel;
  const referenced = h.labelledbyName(h, el) || h.labelsName(h, el);
  if (referenced) return referenced;
  const alt = el.getAttribute("alt");
  if (alt && alt.trim()) return alt.trim();
  const value = h.buttonValue(el);
  if (value) return value;
  const content = h.text(el);
  if (content) return content;
  const title = (el.getAttribute("title") || "").trim();
  if (title) return title;
  return (el.getAttribute("placeholder") || "").trim();
}

/** @param {Element} el */
function cssPath(el) {
  const parts = [];
  /** @type {Element | null} */
  let cur = el;
  while (cur && cur !== document.body && parts.length < 5) {
    /** @type {HTMLElement | null} */
    const parent = cur.parentElement;
    const idx = parent ? Array.from(parent.children).indexOf(cur) + 1 : 1;
    parts.unshift(cur.tagName.toLowerCase() + ":nth-child(" + idx + ")");
    cur = parent;
  }
  return parts.join(" > ");
}

/**
 * @param {RoleProbeHelpers} h
 * @param {Element} el
 */
function roleOf(h, el) {
  const explicit = (el.getAttribute("role") || "").trim().split(/\s+/)[0];
  if (explicit) return explicit;
  for (const [selector, role] of h.IMPLICIT_ROLES) {
    if (el.matches(selector)) return role;
  }
  return "";
}

/**
 * 要素ごとに role と名前を数える。名前の無い要素は先頭から 20 件まで標本に残す。
 * @param {RoleProbeHelpers} h
 * @param {Element[]} candidates
 * @returns {RoleTally}
 */
function tally(h, candidates) {
  /** @type {RoleTally} */
  const out = { byRole: {}, nameCountByRole: {}, unnamedSamples: [], named: 0 };
  for (const el of candidates) {
    const role = h.roleOf(h, el);
    const name = role ? h.accessibleName(h, el) : "";
    const key = role || "(no role)";
    out.byRole[key] = out.byRole[key] || { total: 0, named: 0 };
    out.byRole[key].total += 1;
    if (role && name) {
      out.byRole[key].named += 1;
      out.named += 1;
      out.nameCountByRole[role] = out.nameCountByRole[role] || {};
      out.nameCountByRole[role][name] = (out.nameCountByRole[role][name] || 0) + 1;
    } else if (out.unnamedSamples.length < 20) {
      out.unnamedSamples.push({
        tag: el.tagName.toLowerCase(),
        role: role || null,
        path: h.cssPath(el),
      });
    }
  }
  return out;
}

// 同一 (role, name) の重複はそのままでは一意に引けないため、規模見積もりに含める。
// 重複判定はフルネームで行い、表示用の name だけ切り詰める（先頭一致の別名を同一視しないため）。
/** @param {Record<string, Record<string, number>>} nameCountByRole */
function duplicatePairs(nameCountByRole) {
  const pairs = [];
  for (const [role, names] of Object.entries(nameCountByRole)) {
    for (const [name, count] of Object.entries(names)) {
      if (count > 1) pairs.push({ role, name: name.slice(0, 80), count });
    }
  }
  return pairs;
}

/**
 * ページで実行する本体。ヘルパーの一覧を引数で受け取る。
 * @param {RoleProbeHelpers} h
 */
function roleProbeInPage(h) {
  const candidates = Array.from(
    document.querySelectorAll(
      "a[href], button, input:not([type=hidden]), select, textarea, summary, h1, h2, h3, h4, h5, h6, table, img[alt]:not([alt='']), [role], [tabindex]",
    ),
  ).filter((el) => h.isVisible(el));
  const counts = h.tally(h, candidates);
  return {
    url: location.pathname,
    total: candidates.length,
    named: counts.named,
    unnamed: candidates.length - counts.named,
    ratio: candidates.length ? Math.round((counts.named / candidates.length) * 1000) / 1000 : null,
    duplicatePairs: h.duplicatePairs(counts.nameCountByRole),
    byRole: counts.byRole,
    unnamedSamples: counts.unnamedSamples,
  };
}

/** ページ側のヘルパーと定数。ページへは pageFunctionSource がソースのまま組み込んで渡す。 */
const ROLE_PROBE_PAGE = {
  IMPLICIT_ROLES,
  isVisible,
  text,
  labelledbyName,
  labelsName,
  buttonValue,
  accessibleName,
  cssPath,
  roleOf,
  tally,
  duplicatePairs,
};

/**
 * ページ側のヘルパーの一覧の型。
 * @typedef {typeof ROLE_PROBE_PAGE} RoleProbeHelpers
 */

/**
 * evaluate_script の function 引数に渡す関数式のソースを返す。
 * @returns {string}
 */
export function roleProbeSource() {
  return pageFunctionSource(roleProbeInPage, ROLE_PROBE_PAGE);
}

if (isCliEntry(import.meta.url)) {
  process.stdout.write(roleProbeSource() + "\n");
}
