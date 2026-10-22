// decks/ のデッキを読み、Slides の Artifact と同じ 1920×1080 の枠に描いて表示する。
// URL のハッシュで画面を決める。#/ja は章の一覧、#/ja/01-overview/3 はその章の 3 枚目。
// スライドのファイルは Artifact へ送る原本と同じものを読み、ここでは書き換えない。

// Artifact にアップロードした画像の URL を、リポジトリの中の同じ画像に読み替える。
const SAMPLE_DIR = "../../skills/aws-architecture-diagram/assets/samples/serverless-web-app";
const ASSETS = {
  "/_blob/7cf16fea655543aeecd4f82e73c4ddce": `${SAMPLE_DIR}/architecture-prod.svg`,
  "/_blob/8aa48ef720b8f503bdb609b0ade111e9": `${SAMPLE_DIR}/architecture-local.svg`,
  "/_blob/a8f550b446e0c947495536a07d5db802": `${SAMPLE_DIR}/architecture-prod.svg`,
  "/_blob/c25a2cf34ce571be3e5572823d1a5aec": `${SAMPLE_DIR}/architecture-local.svg`,
};

const TEXT = {
  ja: {
    heading: "shoji9x9/skills スライド",
    lead: "リポジトリと各スキルを、章ごとのスライドで説明する。矢印キーでスライドを進める。",
    other: "English",
    back: "章の一覧",
    prev: "前へ",
    next: "次へ",
  },
  en: {
    heading: "shoji9x9/skills slides",
    lead: "Slides that explain the repository and each skill, one deck per chapter. Use the arrow keys to move between slides.",
    other: "日本語",
    back: "Chapters",
    prev: "Prev",
    next: "Next",
  },
};

const app = document.getElementById("app");
const decks = new Map();
let index;
let current;

async function fetchText(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.text();
}

async function loadIndex() {
  index ??= JSON.parse(await fetchText("decks/index.json"));
  return index;
}

function loadFonts(faces) {
  for (const face of Object.values(faces ?? {})) {
    if (!face.href || document.querySelector(`link[href="${face.href}"]`)) continue;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = face.href;
    document.head.append(link);
  }
}

// スライドの断片を DOM にし、スピーカーノートを除いて、画像の URL を読み替える。
function parseSlide(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const section = template.content.querySelector("section");
  if (!section) throw new Error("スライドに <section> が無い");
  for (const aside of section.querySelectorAll("aside")) aside.remove();
  for (const img of section.querySelectorAll("img")) {
    const local = ASSETS[img.getAttribute("src")];
    if (local) img.setAttribute("src", local);
  }
  return section;
}

// 章の一覧は題名だけを使うので、スライドは章を開いたときに読む。
async function loadMeta(lang, chapter) {
  const key = `${lang}/${chapter}`;
  if (!decks.has(key)) {
    const deck = JSON.parse(await fetchText(`decks/${key}/deck.json`));
    decks.set(key, { title: deck.title, faces: deck.faces, order: deck.order });
  }
  return decks.get(key);
}

async function loadDeck(lang, chapter) {
  const deck = await loadMeta(lang, chapter);
  deck.slides ??= await Promise.all(
    deck.order.map(async (id) =>
      parseSlide(await fetchText(`decks/${lang}/${chapter}/slides/${id}.html`)),
    ),
  );
  return deck;
}

function otherLang(lang) {
  return lang === "ja" ? "en" : "ja";
}

function element(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

async function showIndex(lang, isStale) {
  const { chapters } = await loadIndex();
  const text = TEXT[lang];
  const items = await Promise.all(
    chapters.map(async (chapter) => {
      const deck = await loadMeta(lang, chapter);
      loadFonts(deck.faces);
      const link = element("a", { href: `#/${lang}/${chapter}/1`, textContent: deck.title });
      return element("li", {}, [link]);
    }),
  );
  if (isStale()) return;
  document.documentElement.lang = lang;
  document.title = text.heading;
  // 言語の切り替えは、スライドの画面と同じく見出しの行の右端に置く。
  const header = element("div", { className: "index-header" }, [
    element("h1", { textContent: text.heading }),
    element("a", { href: `#/${otherLang(lang)}`, textContent: text.other }),
  ]);
  const links = element("div", { className: "index-links" }, [
    element("a", { href: "https://github.com/shoji9x9/skills", textContent: "GitHub" }),
  ]);
  const inner = element("div", { className: "index-inner" }, [
    header,
    element("p", { textContent: text.lead }),
    links,
    element("ol", {}, items),
  ]);
  current = undefined;
  app.replaceChildren(element("section", { className: "index" }, [inner]));
}

// 前後のスライドの位置。章の端では隣の章へ移り、全体の端では null を返す。
function neighbor(chapters, step) {
  const { chapter, n, total } = current;
  if (n + step >= 1 && n + step <= total) return { chapter, n: n + step };
  const next = chapters[chapters.indexOf(chapter) + step];
  if (!next) return null;
  return { chapter: next, n: step > 0 ? 1 : -1 };
}

function go(step) {
  if (!current) return;
  const target = neighbor(index.chapters, step);
  if (target) location.hash = `#/${current.lang}/${target.chapter}/${target.n}`;
}

function fitStage(stage, screen) {
  const scale = Math.min(screen.clientWidth / 1920, screen.clientHeight / 1080);
  stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

function toolbar(lang, deck) {
  const text = TEXT[lang];
  const { chapter, n, total } = current;
  const prev = element("button", { textContent: text.prev, onclick: () => go(-1) });
  const next = element("button", { textContent: text.next, onclick: () => go(1) });
  prev.disabled = !neighbor(index.chapters, -1);
  next.disabled = !neighbor(index.chapters, 1);
  return element("nav", { className: "toolbar" }, [
    element("a", { href: `#/${lang}`, textContent: text.back }),
    element("span", { className: "title", textContent: deck.title }),
    element("span", { textContent: `${n} / ${total}` }),
    prev,
    next,
    element("a", { href: `#/${otherLang(lang)}/${chapter}/${n}`, textContent: text.other }),
  ]);
}

async function showSlide({ lang, chapter, requested }, isStale) {
  await loadIndex();
  const deck = await loadDeck(lang, chapter);
  if (isStale()) return;
  loadFonts(deck.faces);
  const total = deck.slides.length;
  // -1 は前の章から戻ってきたときで、その章の最後のスライドを指す。
  const n = requested === -1 ? total : Math.min(Math.max(requested, 1), total);
  current = { lang, chapter, n, total };
  const stage = element("div", { className: "slide-stage" }, [deck.slides[n - 1].cloneNode(true)]);
  const screen = element("div", { className: "screen" }, [stage]);
  document.documentElement.lang = lang;
  document.title = deck.title;
  app.replaceChildren(element("div", { className: "viewer" }, [toolbar(lang, deck), screen]));
  fitStage(stage, screen);
  window.onresize = () => fitStage(stage, screen);
}

// 読み込みを待つ間にハッシュが変わったら、古い画面を描かない。
let routeSeq = 0;

async function route() {
  const seq = ++routeSeq;
  const isStale = () => seq !== routeSeq;
  const [lang, chapter, n] = location.hash.replace(/^#\/?/, "").split("/");
  const { languages, chapters } = await loadIndex();
  const known = languages.includes(lang) ? lang : "ja";
  if (chapters.includes(chapter))
    await showSlide({ lang: known, chapter, requested: Math.trunc(Number(n)) || 1 }, isStale);
  else await showIndex(known, isStale);
}

const KEYS = { ArrowRight: 1, PageDown: 1, " ": 1, ArrowLeft: -1, PageUp: -1 };

document.addEventListener("keydown", (event) => {
  const step = KEYS[event.key];
  // 修飾キー付きの操作（Alt+← のブラウザの「戻る」など）は、ブラウザに任せる。
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (step === undefined || !current) return;
  event.preventDefault();
  go(step);
});

window.addEventListener("hashchange", () => route().catch(showError));

function showError(error) {
  app.replaceChildren(element("pre", { className: "index", textContent: String(error) }));
}

route().catch(showError);
