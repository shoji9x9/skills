// feature-check.mjs がページの中で実行する関数。CDP の Runtime.evaluate へ関数のソースだけを送るので、
// この関数は外の名前を参照しない（本体が使う関数は、本体の中に入れ子で書く）。
//
// kind ごとの動き:
//   exists・visible・text  要素があるか・表示されているか・文字を含むかを返す（待つのは呼び出し側）
//   click・fill            要素を表示の位置まで動かしてから操作する。fill はフレームワークが値の変化を拾えるよう、
//                          要素の型の setter で値を入れてから input と change を送る

/**
 * @param {{ selector: string, kind: string, value?: string, text?: string }} a selector が空なら body を対象にする
 * @returns {{ ok: boolean, message?: string }}
 */
export function featureCheckInPage(a) {
  const el = a.selector === "" ? document.body : document.querySelector(a.selector);
  /** @param {Element} e */
  const visible = (e) =>
    e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  /** 読むだけの kind の結果。読むだけの kind でなければ undefined。 */
  const probe = () => {
    if (a.kind === "exists") return { ok: el !== null };
    if (a.kind === "visible") return { ok: el !== null && visible(el) };
    if (a.kind !== "text") return undefined;
    const text = el instanceof HTMLElement ? el.innerText : (el?.textContent ?? "");
    return { ok: el !== null && text.includes(a.text ?? "") };
  };
  /** @param {HTMLInputElement | HTMLTextAreaElement} input */
  const fill = (input) => {
    input.focus();
    const proto =
      input instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(input, a.value ?? "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  };
  /** 操作する kind の結果。 */
  const act = () => {
    if (el === null) return { ok: false, message: `要素が無い: ${a.selector}` };
    if (!(el instanceof HTMLElement))
      return { ok: false, message: `操作できる要素でない: ${a.selector}` };
    el.scrollIntoView({ block: "center" });
    if (a.kind === "click") {
      el.click();
      return { ok: true };
    }
    if (a.kind !== "fill") return { ok: false, message: `知らない操作: ${a.kind}` };
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return fill(el);
    return { ok: false, message: `入力欄でない: ${a.selector}` };
  };
  return probe() ?? act();
}
