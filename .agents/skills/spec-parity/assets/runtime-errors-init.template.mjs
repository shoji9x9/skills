// 操作中のエラーを記録する init script（雛形）— spec-parity
//
// このファイルは、プロジェクトへコピーして使う雛形である。コピー先は `tests/parity/runtime-errors-init.js` にする
// （実際のパスは metadata.json の suite.runtime_errors.init_script に記録する）。
// e2e の設定で、すべての target の web() に `initScripts: [{ path: "tests/parity/runtime-errors-init.js" }]` を渡す。
// init script は、ページの中で、ページ自身のスクリプトより先に実行される。
//
// 何を記録するか: e2e には console と pageerror のイベントが無いので、ページの中で次の 4 種類を捕まえ、
// 起きたときのページの URL と一緒に sessionStorage に並べる。
//   pageerror     … 捕まえていない例外（window の error）と、処理されない Promise の拒否（unhandledrejection）。本文は Error の message。
//   console-error … console.error の呼び出し。本文は引数を空白でつないだもの。
//   http-error    … fetch の 4xx と 5xx の応答と、fetch 以外のリソース（img・script・link・文書そのもの）の 4xx と 5xx。
//                   fetch 以外の状態コードは Resource Timing の responseStatus から読む（Chromium 109 以降）。
//   requestfailed … fetch の通信の失敗と、状態コードの取れないリソースの読み込みの失敗（接続の失敗・別オリジンの応答）。
// 同じ img・script の 404 を http-error と requestfailed の 2 件にしないよう、要素の error は、同じ URL に 400 以上の
// responseStatus が無いときだけ requestfailed にする。
// 記録しないもの: XMLHttpRequest の応答、iframe の中のエラー（init script は iframe でも実行されるが、iframe の中では何も記録しない）、
// 別のタブのエラー。sessionStorage はオリジンごとなので、別オリジンへ移った後のエラーと、移る前の記録は取り出せない。
//
// 取り出し方: テストの終わりに、スイートの基（tests/parity/test.ts）の fixture が
// `window.__parityRuntimeEvents()` を呼んで記録を取り出し、標準出力へ 1 行で書く。
// sessionStorage は同じタブの同じオリジンの遷移をまたいで残るので、ページを移っても記録は消えない。
// テストごとにブラウザのコンテキストが新しくなるので、記録はテストごとに空から始まる（e2e 0.23.0・@e2e-dev/web 0.15.5 で確かめた）。

(() => {
  const KEY = "__parityRuntime";
  const ACCESSOR = "__parityRuntimeEvents";
  if (Reflect.has(window, ACCESSOR)) return;
  // 同じオリジンの iframe は sessionStorage を最上位の文書と共有するので、iframe でも記録すると、
  // 互いに古い配列で上書きし合い、最上位の文書の記録が遷移の後に消える。最上位の文書だけで記録する
  if (window !== window.top) return;

  /** @typedef {{ page: string, kind: string, text: string, method?: string, url?: string, status?: number }} RuntimeEvent */

  /** @type {RuntimeEvent[]} */
  let store = [];
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    if (Array.isArray(saved)) store = saved;
  } catch {
    store = [];
  }
  const save = () => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(store));
    } catch {
      // 容量を超えたときは、それまでの記録を残す
    }
  };
  /** @param {Omit<RuntimeEvent, "page">} e */
  const push = (e) => {
    store.push({ page: location.href, ...e });
    save();
  };
  Object.defineProperty(window, ACCESSOR, { value: () => store, enumerable: false });

  /** @param {unknown} a */
  const fmt = (a) => {
    if (a instanceof Error) return a.message;
    if (typeof a === "string") return a;
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  };

  // console.error
  const origError = console.error;
  console.error = function (...args) {
    push({ kind: "console-error", text: args.map(fmt).join(" ") });
    return origError.apply(this, args);
  };

  /** @param {string} url */
  const hasHttpStatus = (url) =>
    performance.getEntriesByName(url).some((en) => {
      const st = Reflect.get(en, "responseStatus");
      return typeof st === "number" && st >= 400;
    });

  // 捕まえていない例外と、要素（img・script・link）の読み込みの失敗。後者は捕捉の段でだけ届く
  window.addEventListener(
    "error",
    (ev) => {
      const t = ev.target;
      if (t instanceof Element) {
        const raw =
          Reflect.get(t, "currentSrc") || Reflect.get(t, "src") || Reflect.get(t, "href") || "";
        const url = typeof raw === "string" ? raw : "";
        const tag = t.tagName.toLowerCase();
        // Resource Timing の記録が届くのを待ってから、状態コードがあるかを見る
        setTimeout(() => {
          if (url !== "" && hasHttpStatus(url)) return;
          push({ kind: "requestfailed", text: `resource error <${tag}>`, method: "GET", url });
        }, 0);
        return;
      }
      push({
        kind: "pageerror",
        text: ev.error instanceof Error ? ev.error.message : String(ev.message),
      });
    },
    true,
  );

  window.addEventListener("unhandledrejection", (ev) => {
    push({ kind: "pageerror", text: fmt(ev.reason) });
  });

  // fetch の 4xx と 5xx と、通信の失敗
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const method = (init && init.method) || (input instanceof Request ? input.method : "GET");
    const target = input instanceof Request ? input.url : String(input);
    const url = new URL(target, location.href).href;
    try {
      const res = await origFetch.call(this, input, init);
      if (res.status >= 400)
        push({
          kind: "http-error",
          text: res.statusText,
          method: method.toUpperCase(),
          url,
          status: res.status,
        });
      return res;
    } catch (e) {
      push({ kind: "requestfailed", text: fmt(e), method: method.toUpperCase(), url });
      throw e;
    }
  };

  // fetch 以外のリソース（img・script・css）の 4xx と 5xx
  try {
    new PerformanceObserver((list) => {
      for (const en of list.getEntries()) {
        const initiator = Reflect.get(en, "initiatorType");
        if (initiator === "fetch" || initiator === "xmlhttprequest") continue;
        const st = Reflect.get(en, "responseStatus");
        if (typeof st === "number" && st >= 400)
          push({ kind: "http-error", text: "", method: "GET", url: en.name, status: st });
      }
    }).observe({ type: "resource", buffered: true });
  } catch {
    // PerformanceObserver の resource を持たないブラウザでは、要素の error だけを記録する
  }

  // 文書そのものの 4xx と 5xx
  addEventListener("load", () => {
    const nav = performance.getEntriesByType("navigation")[0];
    const st = nav ? Reflect.get(nav, "responseStatus") : undefined;
    if (nav && typeof st === "number" && st >= 400)
      push({ kind: "http-error", text: "", method: "GET", url: nav.name, status: st });
  });
})();
