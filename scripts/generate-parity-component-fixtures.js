#!/usr/bin/env node
// parity-component の eval fixture（`button` 部品の採取物）を、同梱の決定論ツールを実物のブラウザで
// 実行して生成する（Issue #354）。
//
// 何のためか: 採取物を手で書くと、traits.json / css-rules.json / metadata.json の
// `traits_property_set` / element.png が互いに食い違う（PR #352 で 3 回、Issue #354 で再発）。
// `build` の前提検証はこれらを突き合わせるので、食い違った fixture では eval が目的の分岐へ届かない。
// このスクリプトは現行アプリの代わりになる最小のページを `Page.setDocumentContent` で流し込み、
//   - `parity-suite` の trait-capture.mjs（計算後スタイル・擬似要素・rect）
//   - `parity-component` の css-rules-capture.mjs（当たっている CSS 規則）
//   - 要素単位のスクリーンショット（element.png）
// を採り、`axis-diff.mjs --baseline` 相当で axes.json を組み立て、metadata.json のツール版・
// プロパティ集合・軸の件数を実物の値で更新する。整合は scripts/parity-component-fixtures.test.js が CI で検査する。
//
// ページは HTTP で配信せず文書として流し込む。開発環境（WSL2 上の headless Chrome 149）で
// http(s) へのナビゲーションが開始すらしない（data: は通る）ことを実測したため。
// そのためスタイルシートは `<style>` 要素で、css-rules.json の `href` は null になる。
//
// 前提: ローカルに Chrome（既定 /usr/bin/google-chrome。CHROME で上書き）があること。
// CI では走らせない（ブラウザが無い）。生成後は `pnpm exec oxfmt` で JSON を整形する。
//
// 使い方: node scripts/generate-parity-component-fixtures.js

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const traitCapture = await import(join(repoRoot, "skills/parity-suite/scripts/trait-capture.mjs"));
const cssRules = await import(
  join(repoRoot, "skills/parity-component/scripts/css-rules-capture.mjs")
);
const axisDiff = await import(join(repoRoot, "skills/parity-component/scripts/axis-diff.mjs"));

const FIXTURES = ["catalog-unset", "breaking-change-request"].map((name) =>
  join(repoRoot, "skills/parity-component/evals/fixtures", name, ".replace/components/button"),
);
const VIEWPORT = { width: 1280, height: 800 };

// 現行アプリの代わりのスタイルシート。2 つのバリアント（primary / secondary）が
// 背景色・文字色で割れ、文言の長さで幅が割れる。値は計算値と同じ表記で書く
// （css-rules.json の宣言値と traits.json の計算値を突き合わせられるようにするため）。
const APP_CSS = `.btn {
  display: inline-block;
  margin: 0px;
  padding: 4px 12px;
  border: 0px solid rgba(0, 0, 0, 0);
  border-radius: 2px;
  font-family: "Noto Sans JP", sans-serif;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
  text-align: center;
  cursor: pointer;
  user-select: none;
}
.btn-primary { background-color: rgb(0, 90, 158); color: rgb(255, 255, 255); }
.btn-primary:hover { background-color: rgb(0, 70, 130); }
.btn-secondary { background-color: rgb(238, 238, 238); color: rgb(51, 51, 51); }
.btn-secondary:hover { background-color: rgb(221, 221, 221); }
.btn:active { background-color: rgb(0, 55, 105); }
.btn:disabled { color: rgb(153, 153, 153); cursor: not-allowed; }
`;

const page = (title, button) =>
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${title}</title>` +
  `<style>${APP_CSS}</style></head><body style="margin:0">` +
  `<main style="padding:16px">${button}</main></body></html>`;

const PAGES = {
  "/orders": page(
    "注文",
    '<button class="btn btn-primary" data-testid="order-search-submit">検索</button>',
  ),
  "/users": page(
    "利用者",
    '<button class="btn btn-secondary" data-testid="user-create-submit">利用者を作成</button>',
  ),
};

const INSTANCES = [
  { id: "orders-search", page: "/orders", selector: '[data-testid="order-search-submit"]' },
  { id: "users-create", page: "/users", selector: '[data-testid="user-create-submit"]' },
];
const STATES = ["default", "hover", "active", "disabled"];

async function launchChrome() {
  const userDir = mkdtempSync(join(tmpdir(), "parity-component-fixtures-"));
  const proc = spawn(
    process.env.CHROME || "/usr/bin/google-chrome",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDir}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error(`Chrome が起動しない: ${buf}`)), 20000);
    proc.once("exit", (code) => reject(new Error(`Chrome が終了した (exit ${code}): ${buf}`)));
    proc.stderr.on("data", (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
  });
  const port = new URL(wsUrl).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const browser = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).Browser;
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else resolve(msg.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  // Chrome は SIGTERM 後もしばらくプロファイルへ書くので、終了を待ってから消す
  // （待たずに消すと ENOTEMPTY で finally が throw し、成功した生成が非 0 終了に化ける）。
  const close = async () => {
    ws.close();
    if (proc.exitCode === null && proc.signalCode === null) {
      const exited = new Promise((resolve) => proc.once("exit", resolve));
      proc.kill();
      await exited;
    }
    rmSync(userDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  return { send, close, browser };
}

// Playwright の locator.evaluate(fn, arg) と同じ契約（関数を文字列化して要素と引数で呼ぶ）の最小実装。
const locator = (cdp, selector) => ({
  async evaluate(fn, arg) {
    const r = await cdp.send("Runtime.evaluate", {
      expression: `(${fn.toString()})(document.querySelector(${JSON.stringify(selector)}), ${JSON.stringify(arg)})`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result.value;
  },
});

async function captureOnce(cdp, instance, state) {
  const { frameTree } = await cdp.send("Page.getFrameTree");
  await cdp.send("Page.setDocumentContent", {
    frameId: frameTree.frame.id,
    html: PAGES[instance.page],
  });
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: instance.selector,
  });
  if (!nodeId) throw new Error(`${instance.id}: 要素が見つからない (${instance.selector})`);
  if (state === "hover" || state === "active") {
    await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [state] });
  } else if (state === "disabled") {
    await cdp.send("DOM.setAttributeValue", { nodeId, name: "disabled", value: "" });
  } else if (state !== "default") {
    throw new Error(`未対応の状態: ${state}`);
  }
  const name = `button@${instance.id}`;
  const el = locator(cdp, instance.selector);
  const [traits] = await traitCapture.captureTraits([{ name, locator: el }]);
  const [rules] = await cssRules.captureMatchedRules([{ name, locator: el }]);
  const { x, y, width, height } = traits.rect;
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    clip: { x, y, width, height, scale: 1 },
  });
  return { traits, rules, png: Buffer.from(shot.data, "base64") };
}

const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const cdp = await launchChrome();
try {
  await cdp.send("Page.enable");
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    ...VIEWPORT,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const captured = [];
  for (const instance of INSTANCES) {
    for (const state of STATES) {
      // ノイズ基準値: 同一条件で 2 回採り、特性とバイト列が一致することを確かめる。
      const first = await captureOnce(cdp, instance, state);
      const second = await captureOnce(cdp, instance, state);
      const traitsNoise = isDeepStrictEqual(first.traits, second.traits) ? 0 : 1;
      const pixelNoise = first.png.equals(second.png) ? 0 : 1;
      if (traitsNoise || pixelNoise || !isDeepStrictEqual(first.rules, second.rules)) {
        throw new Error(`${instance.id} / ${state}: 2 回の採取が一致しない（決定論的でない）`);
      }
      captured.push({ instance, state, ...first });
    }
  }

  for (const dir of FIXTURES) {
    for (const { instance, state, traits, rules, png } of captured) {
      const base = join(dir, "baseline", instance.id, state);
      mkdirSync(base, { recursive: true });
      writeJson(join(base, "traits.json"), traits);
      writeJson(join(base, "css-rules.json"), rules);
      writeFileSync(join(base, "element.png"), png);
    }

    const metaPath = join(dir, "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.capture.states = STATES;
    meta.capture.tools = {
      ...meta.capture.tools,
      traits_version: traitCapture.VERSION,
      traits_property_set: [...traitCapture.FIXED_PROPERTIES].sort(),
      css_rules_version: cssRules.VERSION,
      axis_diff_version: axisDiff.VERSION,
    };
    const unresolved = captured.reduce((n, c) => n + c.rules.unresolved.length, 0);
    const inaccessible = captured.reduce((n, c) => n + c.rules.inaccessible.length, 0);
    meta.capture_gaps = { inaccessible_sheets: inaccessible, unresolved_selectors: unresolved };
    if (meta.capture_conditions) {
      meta.capture_conditions.environment = `${cdp.browser}（headless）/ Linux / DPR 1`;
      meta.capture_conditions.viewports = [{ ...VIEWPORT, label: "desktop" }];
    }
    if (meta.noise_baseline) {
      meta.noise_baseline = captured.map(({ instance, state }) => ({
        instance: instance.id,
        state,
        viewport: "desktop",
        pixel: 0,
        traits: 0,
      }));
    }
    // 軸の件数は axes.json から写す。先に metadata を書かないと --baseline がプロパティ集合を読めない。
    writeJson(metaPath, meta);
    const axes = axisDiff.diffAxes(axisDiff.assembleFromBaseline(dir));
    if (!axes.ok) throw new Error(`${dir}: axis-diff が ok でない: ${axes.problems.join(" / ")}`);
    writeJson(join(dir, "axes.json"), axes);
    meta.axes = {
      ...meta.axes,
      ok: axes.ok,
      variable: axes.variable.length,
      fixed: axes.fixed.length,
      measured: axes.measured,
      not_compared: axes.not_compared,
    };
    writeJson(metaPath, meta);
    console.log(`wrote ${dir}`);
  }

  const widths = Object.fromEntries(
    captured.filter((c) => c.state === "default").map((c) => [c.instance.id, c.traits.rect.width]),
  );
  const axes = JSON.parse(readFileSync(join(FIXTURES[0], "axes.json"), "utf8"));
  console.log(
    JSON.stringify(
      {
        browser: cdp.browser,
        widths,
        variable: axes.variable.map((v) => `${v.state} / ${v.axis}`),
        measured: axes.measured,
      },
      null,
      2,
    ),
  );
} finally {
  await cdp.close();
}
