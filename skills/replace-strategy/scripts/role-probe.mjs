// セマンティクス測定の role プローブ（正本）。
// 使い方: 下の `roleProbe` の関数リテラルを chrome-devtools MCP の evaluate_script の
// function 引数にそのまま渡す（Node では実行しない。ブラウザの document を参照する）。
// evaluate_script は渡された関数宣言を自ら呼び出して実行し、返り値を JSON で返すため、
// IIFE 化（`(...)()`）は不要（ツール仕様・実測とも確認済み）。
//
// 測るもの: 可視の対象要素（インタラクティブ要素に加え、見出し・テーブル・画像など
// role ロケータの対象になる要素）のうち、role ＋アクセシブルネームで引ける割合。
// アクセシブルネームの算出は仕様（accname）の近似であり、値は目安として扱う
//（references/measurement.md を参照）。決定論的: 乱数・時刻に依存せず、document 順に走査する。

export const roleProbe = () => {
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

  const isVisible = (el) => {
    if (el.closest("[aria-hidden=true]")) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const text = (el) => (el ? (el.textContent || "").replace(/\s+/g, " ").trim() : "");

  // accname の近似: aria-label > aria-labelledby > label 関連付け > alt > value(button 系) >
  // 内容テキスト > title > placeholder。空文字は「名前なし」。
  const accessibleName = (el) => {
    const ariaLabel = (el.getAttribute("aria-label") || "").trim();
    if (ariaLabel) return ariaLabel;
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const joined = labelledby
        .split(/\s+/)
        .map((id) => text(document.getElementById(id)))
        .filter(Boolean)
        .join(" ");
      if (joined) return joined;
    }
    if (el.labels && el.labels.length) {
      const joined = Array.from(el.labels).map(text).filter(Boolean).join(" ");
      if (joined) return joined;
    }
    const alt = el.getAttribute("alt");
    if (alt && alt.trim()) return alt.trim();
    const tag = el.tagName.toLowerCase();
    if (tag === "input" && ["button", "submit", "reset"].includes(el.type) && el.value.trim()) {
      return el.value.trim();
    }
    const content = text(el);
    if (content) return content;
    const title = (el.getAttribute("title") || "").trim();
    if (title) return title;
    const placeholder = (el.getAttribute("placeholder") || "").trim();
    if (placeholder) return placeholder;
    return "";
  };

  const cssPath = (el) => {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && parts.length < 5) {
      const parent = cur.parentElement;
      const idx = parent ? Array.from(parent.children).indexOf(cur) + 1 : 1;
      parts.unshift(cur.tagName.toLowerCase() + ":nth-child(" + idx + ")");
      cur = parent;
    }
    return parts.join(" > ");
  };

  const roleOf = (el) => {
    const explicit = (el.getAttribute("role") || "").trim().split(/\s+/)[0];
    if (explicit) return explicit;
    for (const [selector, role] of IMPLICIT_ROLES) {
      if (el.matches(selector)) return role;
    }
    return "";
  };

  const candidates = Array.from(
    document.querySelectorAll(
      "a[href], button, input:not([type=hidden]), select, textarea, summary, h1, h2, h3, h4, h5, h6, table, img[alt]:not([alt='']), [role], [tabindex]",
    ),
  ).filter(isVisible);

  const byRole = {};
  const nameCountByRole = {};
  const unnamedSamples = [];
  let named = 0;

  for (const el of candidates) {
    const role = roleOf(el);
    const name = role ? accessibleName(el) : "";
    const key = role || "(no role)";
    byRole[key] = byRole[key] || { total: 0, named: 0 };
    byRole[key].total += 1;
    if (role && name) {
      byRole[key].named += 1;
      named += 1;
      nameCountByRole[role] = nameCountByRole[role] || {};
      nameCountByRole[role][name] = (nameCountByRole[role][name] || 0) + 1;
    } else if (unnamedSamples.length < 20) {
      unnamedSamples.push({ tag: el.tagName.toLowerCase(), role: role || null, path: cssPath(el) });
    }
  }

  // 同一 (role, name) の重複はそのままでは一意に引けないため、規模見積もりに含める。
  // 重複判定はフルネームで行い、表示用の name だけ切り詰める（先頭一致の別名を同一視しないため）。
  const duplicatePairs = [];
  for (const [role, names] of Object.entries(nameCountByRole)) {
    for (const [name, count] of Object.entries(names)) {
      if (count > 1) duplicatePairs.push({ role, name: name.slice(0, 80), count });
    }
  }

  return {
    url: location.pathname,
    total: candidates.length,
    named,
    unnamed: candidates.length - named,
    ratio: candidates.length ? Math.round((named / candidates.length) * 1000) / 1000 : null,
    duplicatePairs,
    byRole,
    unnamedSamples,
  };
};
