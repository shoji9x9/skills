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
// CI では走らせない（ブラウザが無い）。書き出した JSON の整形はこのスクリプトが自分で行う
// （対象ファイルを列挙して oxfmt へ渡す。ディレクトリを渡すと Markdown まで整形されるため）。
//
// 使い方: node scripts/generate-parity-component-fixtures.js

import { spawn, spawnSync } from "node:child_process";
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
const elementShot = await import(join(repoRoot, "skills/parity-suite/scripts/element-shot.mjs"));

const fixtureDir = (name) =>
  join(repoRoot, "skills/parity-component/evals/fixtures", name, ".replace/components/button");
const VIEWPORT = { width: 1280, height: 800 };
const VIEWER_ENVIRONMENT = "一致";

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

// カスケードの競合を仕込んだ 2 枚目のスタイルシート（後から読み込まれるテーマ層に相当）。
// 現行アプリ（基礎スタイルシート → テーマ層 → 個別テーマの順に読み込み、後段が同一セレクタ・
// 同一プロパティを再宣言して上書きする構成）で実際に起きた 2 形を、ブラウザに解決させて再現する:
//
//   width          インライン 10px（非 !important）が、テーマ層の 60px !important に**負ける**。
//                  基礎側は 40px。素朴な読み方は 10px（インラインだけ読む）か 40px（matched の最初）になる
//                  （`button` の UA 既定は border-box なので rect.width がそのまま 60 になる）
//   letter-spacing 基礎の normal を、テーマ層の 1px が**上書きする**。matched の最初を採ると normal になる
//
// どちらも trait-capture.mjs の FIXED_PROPERTIES に無いプロパティを選んである。集合にある
// プロパティで競合を作ると、traits.json の計算値が勝者をそのまま持ってしまい、
// 「カスケードを解いたか」を測れない（採取物が答えを持っている状態になる）。
const THEME_CSS = `.searchbox-btn { width: 60px !important; }
.btn { letter-spacing: 1px; }
`;

// 競合用ページの基礎スタイルシート。APP_CSS に、テーマ層が上書きする側の宣言を足す。
const CASCADE_BASE_CSS = `${APP_CSS}.searchbox-btn { width: 40px; }
.btn { letter-spacing: normal; }
`;

const page = (title, button, css = APP_CSS, extraCss = null) =>
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${title}</title>` +
  `<style>${css}</style>${extraCss === null ? "" : `<style>${extraCss}</style>`}` +
  `</head><body style="margin:0">` +
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

const CASCADE_PAGES = {
  "/orders": page(
    "注文",
    '<button class="btn btn-primary searchbox-btn" style="width: 10px" ' +
      'data-testid="order-search-submit">検索</button>',
    CASCADE_BASE_CSS,
    THEME_CSS,
  ),
  "/users": page(
    "利用者",
    '<button class="btn btn-secondary" data-testid="user-create-submit">利用者を作成</button>',
    CASCADE_BASE_CSS,
    THEME_CSS,
  ),
};

const INSTANCES = [
  { id: "orders-search", page: "/orders", selector: '[data-testid="order-search-submit"]' },
  { id: "users-create", page: "/users", selector: '[data-testid="user-create-submit"]' },
];
const STATES = ["default", "hover", "active", "disabled"];

// 採取物の組。同じ採取を複数の fixture へ書くものと、別のページから採るものを分ける。
const VARIANTS = [
  { pages: PAGES, fixtures: ["catalog-unset", "breaking-change-request"].map(fixtureDir) },
  { pages: CASCADE_PAGES, fixtures: [fixtureDir("cascade-conflict")] },
];

// 1 回の CDP 呼び出し・HTTP 取得に許す時間。全体の timeout で切ると、どの呼び出しで止まったかが
// 出力に残らない（http へのナビゲーションが開始しない環境で実際に起きた）。呼び出しごとに切って名前を出す。
const CALL_TIMEOUT_MS = 30000;
// SIGTERM 後に Chrome の終了を待つ上限。固まった Chrome や SIGTERM を無視するラッパー（CHROME で指定）だと
// 上限なしの待ちは終わらず、起動・ハンドシェイクの元のエラーも出ず、プロファイルも消えない。
// 超えたら SIGKILL へ切り替える。テストで短くするためだけに環境変数で上書きできる。
const SHUTDOWN_TIMEOUT_MS = Number(process.env.PARITY_FIXTURES_SHUTDOWN_TIMEOUT_MS) || 10000;

// `exit` を ms 以内に待つ。来れば true、上限を超えたら false。
const waitForExit = (proc, ms) =>
  new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => {
      proc.off("exit", onExit);
      resolve(false);
    }, ms);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    proc.once("exit", onExit);
  });

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
  let ws = null;
  // Chrome は SIGTERM 後もしばらくプロファイルへ書くので、終了を待ってから消す
  // （待たずに消すと ENOTEMPTY で finally が throw し、成功した生成が非 0 終了に化ける）。
  // 起動・ハンドシェイクの途中で失敗したときも同じ片付けを通す（通さないと Chrome とプロファイルが残る）。
  const shutdown = async () => {
    if (ws) ws.close();
    let stuck = false;
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill("SIGTERM");
      if (!(await waitForExit(proc, SHUTDOWN_TIMEOUT_MS))) {
        console.error(
          `Chrome が SIGTERM から ${SHUTDOWN_TIMEOUT_MS}ms 以内に終了しないので SIGKILL する`,
        );
        proc.kill("SIGKILL");
        stuck = !(await waitForExit(proc, SHUTDOWN_TIMEOUT_MS));
      }
    }
    // 終了を確かめられなくてもプロファイルの削除は試みる（残すと一時ディレクトリが溜まる）。
    rmSync(userDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    if (stuck) throw new Error(`Chrome (pid ${proc.pid}) が SIGKILL 後も終了しない`);
  };

  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(() => reject(new Error(`Chrome が起動しない: ${buf}`)), 20000);
      proc.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      proc.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Chrome が終了した (exit ${code}): ${buf}`));
      });
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
    const getJson = async (path) =>
      (
        await fetch(`http://127.0.0.1:${port}${path}`, {
          signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        })
      ).json();
    const targets = await getJson("/json");
    const browser = (await getJson("/json/version")).Browser;
    const page = targets.find((t) => t.type === "page");
    if (!page) throw new Error("CDP のページターゲットが見つからない");
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("CDP の WebSocket が開かない")),
        CALL_TIMEOUT_MS,
      );
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("CDP の WebSocket の接続に失敗した"));
      };
    });

    let nextId = 0;
    let closedReason = null;
    const pending = new Map();
    // 接続が切れたら待っている呼び出しを全部落とす。応答メッセージだけを見ていると、
    // Chrome が生きたまま接続だけ切れたときに send() が永久に解決せず、finally の片付けにも届かない。
    const failAll = (reason) => {
      closedReason = closedReason || reason;
      for (const { reject, timer } of pending.values()) {
        clearTimeout(timer);
        reject(new Error(closedReason));
      }
      pending.clear();
    };
    ws.onclose = () => failAll("CDP の WebSocket が閉じた");
    ws.onerror = () => failAll("CDP の WebSocket でエラーが起きた");
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject, timer } = pending.get(msg.id);
        clearTimeout(timer);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      }
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        if (closedReason) {
          reject(new Error(`${method}: ${closedReason}`));
          return;
        }
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method}: ${CALL_TIMEOUT_MS}ms 以内に応答が無い`));
        }, CALL_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify({ id, method, params }));
      });
    return { send, close: shutdown, browser };
  } catch (err) {
    // 片付けの失敗で元のエラーを上書きしない（原因が表面化しなくなる）。片付けの失敗は併記する。
    try {
      await shutdown();
    } catch (cleanupErr) {
      console.error(`片付けにも失敗した: ${cleanupErr.message}`);
    }
    throw err;
  }
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

async function captureOnce(cdp, pages, instance, state) {
  const { frameTree } = await cdp.send("Page.getFrameTree");
  await cdp.send("Page.setDocumentContent", {
    frameId: frameTree.frame.id,
    html: pages[instance.page],
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
  // 要素スクショの clip は element-shot.mjs に決めさせる（矩形の丸めの正本。
  // 生の rect を渡すと小数座標のぶん寸法が揺れ、寸法一致を要求する画素比較の入力にならない）。
  const clip = elementShot.planElementClip(traits.rect, VIEWPORT);
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    clip: { ...clip, scale: 1 },
  });
  // 総称ファミリー（sans-serif）が実際に何のフォントで描かれたかを残す（撮影環境の記録に要る）。
  const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  const platformFonts = fonts.map((f) => f.familyName).sort();
  return { traits, rules, png: Buffer.from(shot.data, "base64"), platformFonts };
}

// 整形は「このスクリプトが書いた JSON」だけに当てる。手順書で人に `oxfmt <ディレクトリ>` を
// 実行させると、oxfmt は渡された Markdown も整形するので fixture の表が巻き込まれる（4 回踏んだ）。
const writtenJson = [];

const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  if (!writtenJson.includes(path)) writtenJson.push(path);
};

// 書いた JSON をリポジトリの整形規約（lefthook の oxfmt-json）へ揃える。
// 0 件で oxfmt を起動すると引数なし実行になり対象が広がるので、その場合は何もしない。
const formatWrittenJson = () => {
  if (writtenJson.length === 0) {
    console.error("整形対象の JSON が 0 件のため oxfmt を起動しない");
    return;
  }
  const result = spawnSync("pnpm", ["exec", "oxfmt", ...writtenJson], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`oxfmt が失敗した (exit ${result.status}): ${writtenJson.length} 件`);
  }
  console.log(`formatted ${writtenJson.length} json files`);
};

const cdp = await launchChrome();
let generationError = null;
try {
  await cdp.send("Page.enable");
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    ...VIEWPORT,
    deviceScaleFactor: 1,
    mobile: false,
  });

  for (const variant of VARIANTS) {
    const captured = [];
    for (const instance of INSTANCES) {
      for (const state of STATES) {
        // ノイズ基準値: 同一条件で 2 回採り、特性とバイト列が一致することを確かめる。
        const first = await captureOnce(cdp, variant.pages, instance, state);
        const second = await captureOnce(cdp, variant.pages, instance, state);
        const traitsNoise = isDeepStrictEqual(first.traits, second.traits) ? 0 : 1;
        const pixelNoise = first.png.equals(second.png) ? 0 : 1;
        if (traitsNoise || pixelNoise || !isDeepStrictEqual(first.rules, second.rules)) {
          throw new Error(`${instance.id} / ${state}: 2 回の採取が一致しない（決定論的でない）`);
        }
        captured.push({ instance, state, ...first });
      }
    }

    for (const dir of variant.fixtures) {
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
        element_shot_version: elementShot.VERSION,
        css_rules_version: cssRules.VERSION,
        axis_diff_version: axisDiff.VERSION,
      };
      const unresolved = captured.reduce((n, c) => n + c.rules.unresolved.length, 0);
      const inaccessible = captured.reduce((n, c) => n + c.rules.inaccessible.length, 0);
      meta.capture_gaps = { inaccessible_sheets: inaccessible, unresolved_selectors: unresolved };
      // 撮影条件とノイズ基準値は、既存の値の有無（null のプレースホルダを含む）に依らず採取から書く。
      // 真偽で分岐すると null の fixture が `capture.complete: true` のまま条件も基準値も持たず残り、
      // `build` の照合が同一条件を再現できない。
      const fontsUsed = [...new Set(captured.flatMap((c) => c.platformFonts))].sort();
      if (fontsUsed.length === 0) throw new Error("描画に使われたフォントを取得できない");
      meta.capture_conditions = {
        environment: `${cdp.browser}（headless）/ Linux / DPR 1。"Noto Sans JP", sans-serif は ${fontsUsed.join(" / ")} に解決`,
        // 想定利用者環境との一致は採取からは決まらない fixture の前提。両 fixture の gaps.md（採取環境依存の未検証: なし）と
        // 揃えて「一致」とする（既存値の有無で分けると、null だった fixture だけ別の前提になり gaps.md と食い違う）
        viewer_environment: VIEWER_ENVIRONMENT,
        viewports: [{ ...VIEWPORT, label: "desktop" }],
        animations: "disabled",
        element_screenshot: true,
        masks: [],
      };
      // 2 回の採取が特性・画素とも一致しなければ上で停止しているので、ここに来た組み合わせの差分は 0。
      meta.noise_baseline = captured.map(({ instance, state }) => ({
        instance: instance.id,
        state,
        viewport: "desktop",
        pixel: 0,
        traits: 0,
      }));
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
      captured
        .filter((c) => c.state === "default")
        .map((c) => [c.instance.id, c.traits.rect.width]),
    );
    const summaryAxes = JSON.parse(readFileSync(join(variant.fixtures[0], "axes.json"), "utf8"));
    console.log(
      JSON.stringify(
        {
          browser: cdp.browser,
          fixtures: variant.fixtures.map((d) => d.slice(repoRoot.length + 1)),
          widths,
          variable: summaryAxes.variable.map((v) => `${v.state} / ${v.axis}`),
          measured: summaryAxes.measured,
        },
        null,
        2,
      ),
    );
  }
  formatWrittenJson();
} catch (err) {
  generationError = err;
}
// 起動失敗の経路と同じく、片付けの失敗（SIGKILL 後も終了しない等）で生成の元のエラーを上書きしない。
try {
  await cdp.close();
} catch (cleanupErr) {
  if (!generationError) throw cleanupErr;
  console.error(`片付けにも失敗した: ${cleanupErr.message}`);
}
if (generationError) throw generationError;
