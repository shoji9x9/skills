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
// プロパティ集合・軸の件数を実物の値で更新する。整合は scripts/eval/parity-component-fixtures.test.ts が CI で検査する。
//
// ページは HTTP で配信せず文書として流し込む。開発環境（WSL2 上の headless Chrome 149）で
// http(s) へのナビゲーションが開始すらしない（data: は通る）ことを実測したため。
// そのためスタイルシートは `<style>` 要素で、css-rules.json の `href` は null になる。
//
// 前提: ローカルに Chrome（既定 /usr/bin/google-chrome。CHROME で上書き）があること。
// CI では実行しない（ブラウザが無い）。書き出した JSON の整形はこのスクリプトが自分で行う
// （書いたファイルを列挙して oxfmt へ渡し、同じディレクトリの既存の JSON を書き換えないため）。
//
// 使い方: node scripts/eval/generate-parity-component-fixtures.ts

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { errorMessage } from "../lib/errors.ts";
import { parseJsonAs } from "../lib/parse-as.ts";
import * as traitCapture from "../../skills/parity-suite/scripts/trait-capture.mjs";
import * as cssRules from "../../skills/parity-component/scripts/css-rules-capture.mjs";
import * as axisDiff from "../../skills/parity-component/scripts/axis-diff.mjs";
import * as elementShot from "../../skills/parity-suite/scripts/element-shot.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const fixtureDir = (name: string) =>
  join(repoRoot, "evals/parity-component/fixtures", name, ".replace/components/button");
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
//   width          インライン 10px（`!important` なし）が、テーマ層の 60px `!important` に**負ける**。
//                  基礎側は 40px。素朴な読み方では 10px（インラインだけ読む）か 40px（matched の最初）になる。
//                  `button` の UA のデフォルトは border-box なので、rect.width がそのまま 60 になる
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

// css と extraCss は、競合用ページだけが基礎スタイルシートとテーマ層を差し替えるために渡す。
const page = ({
  title,
  button,
  css = APP_CSS,
  extraCss = null,
}: {
  title: string;
  button: string;
  css?: string;
  extraCss?: string | null;
}) =>
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${title}</title>` +
  `<style>${css}</style>${extraCss === null ? "" : `<style>${extraCss}</style>`}` +
  `</head><body style="margin:0">` +
  `<main style="padding:16px">${button}</main></body></html>`;

const PAGES = {
  "/orders": page({
    title: "注文",
    button: '<button class="btn btn-primary" data-testid="order-search-submit">検索</button>',
  }),
  "/users": page({
    title: "利用者",
    button:
      '<button class="btn btn-secondary" data-testid="user-create-submit">利用者を作成</button>',
  }),
};

const CASCADE_PAGES = {
  "/orders": page({
    title: "注文",
    button:
      '<button class="btn btn-primary searchbox-btn" style="width: 10px" ' +
      'data-testid="order-search-submit">検索</button>',
    css: CASCADE_BASE_CSS,
    extraCss: THEME_CSS,
  }),
  "/users": page({
    title: "利用者",
    button:
      '<button class="btn btn-secondary" data-testid="user-create-submit">利用者を作成</button>',
    css: CASCADE_BASE_CSS,
    extraCss: THEME_CSS,
  }),
};

const INSTANCES = [
  { id: "orders-search", page: "/orders", selector: '[data-testid="order-search-submit"]' },
  { id: "users-create", page: "/users", selector: '[data-testid="user-create-submit"]' },
];
const STATES = ["default", "hover", "active", "disabled"];
const MOTIONS_NONE_REASON =
  "部品に当たる規則に transition / animation の宣言が無く、動きを起こす JavaScript も無い（css-rules.json と現行のソースで数えた）";

// 操作の結果（Issue #446）。build の前提は全インスタンスの baseline/<instance>/behaviors.json を要求するので、
// 無いと build 系の eval が前提判定で止まり、目的の分岐（カタログ未整備・カスケードの競合・破壊的変更）へ届かない。
// 流し込むページはフォームもイベントハンドラも持たないので、押しても送信されず例外も出ない。その挙動をそのまま
// 値にする（submitted: false）。ブラウザでは採らず fixture の前提として固定する（VIEWER_ENVIRONMENT と同じ扱い）が、
// ページの実際の挙動と食い違う値を置かない。形は behavior-compare.mjs の基準側の検査を通ること（parity-component-fixtures.test.ts）。
const OPERATIONS = [
  {
    id: "click-submit",
    description: "既定の状態のボタンを押す",
    steps: "ボタン（role=button ＋アクセシブルネーム）をクリックする",
    observe: ["submitted", "page_errors"],
  },
];
const OPERATION_SOURCE = "app-ui";
const behaviorsOf = (instanceId: string) => ({
  instance: instanceId,
  results: [{ operation: "click-submit", observed: { submitted: false, page_errors: 0 } }],
});

// 採取物の組。同じ採取を複数の fixture へ書くものと、別のページから採るものを分ける。
const VARIANTS = [
  {
    pages: PAGES,
    fixtures: ["catalog-unset", "breaking-change-request", "lifecycle-binding"].map(fixtureDir),
  },
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
const waitForExit = (proc: ChildProcess, ms: number) =>
  new Promise<boolean>((resolve) => {
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

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

// One message from the CDP WebSocket.
type CdpMessage = { id?: number; result?: unknown; error?: { message: string; code: number } };

/** 一時プロファイルを作り、headless の Chrome をリモートデバッグのポートを開けて起動する。 */
function spawnChrome() {
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
  return { proc, userDir };
}

/** Chrome の DevTools への接続。接続が閉じるまでは ws を持つ。 */
type Connection = { ws: WebSocket | null };

/**
 * Chrome とプロファイルを片付ける関数を返す。`connection.ws` は、開いた後に呼び出し側が入れる。
 *
 * Chrome は SIGTERM 後もしばらくプロファイルへ書くので、終了を待ってから消す
 * （待たずに消すと ENOTEMPTY で finally が throw し、成功した生成が非 0 の終了になってしまう）。
 * 起動・ハンドシェイクの途中で失敗したときも同じ片付けを通す（通さないと Chrome とプロファイルが残る）。
 */
function makeShutdown(proc: ChildProcess, userDir: string, connection: Connection) {
  return async () => {
    if (connection.ws) connection.ws.close();
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
}

/** Chrome の stderr から DevTools の WebSocket の URL を読む。起動しないときや終了したときは reject する。 */
function waitForDevToolsUrl(proc: ReturnType<typeof spawnChrome>["proc"]) {
  return new Promise<string>((resolve, reject) => {
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
}

/**
 * DevTools の HTTP エンドポイントからページのターゲットとブラウザの版を取得し、ページへの WebSocket を開く。
 * 開く前の socket も `connection.ws` に入れ、shutdown が閉じられるようにする。
 */
async function openPageSocket(wsUrl: string, connection: Connection) {
  const port = new URL(wsUrl).port;
  // The endpoint decides the shape of what it returns.
  const getJson = async <T>(path: string) =>
    parseJsonAs<T>(
      await (
        await fetch(`http://127.0.0.1:${port}${path}`, {
          signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        })
      ).text(),
    );
  const targets = await getJson<{ type: string; webSocketDebuggerUrl: string }[]>("/json");
  const browser = (await getJson<{ Browser: string }>("/json/version")).Browser;
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("CDP のページターゲットが見つからない");
  // shutdown が閉じられるよう外側の ws にも入れ、ここから先は null でない socket を使う。
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  connection.ws = socket;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("CDP の WebSocket が開かない")),
      CALL_TIMEOUT_MS,
    );
    socket.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error("CDP の WebSocket の接続に失敗した"));
    };
  });
  return { socket, browser };
}

/** 開いた WebSocket で CDP のメソッドを呼び、応答を id で対応づけて返す send を作る。 */
function createSender(socket: WebSocket) {
  let nextId = 0;
  let closedReason: string | null = null;
  const pending = new Map<number, PendingCall>();
  // 接続が切れたら待っている呼び出しを全部落とす。応答メッセージだけを見ていると、
  // Chrome が生きたまま接続だけ切れたときに send() が永久に解決せず、finally の片付けにも届かない。
  const failAll = (reason: string) => {
    closedReason = closedReason || reason;
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new Error(closedReason));
    }
    pending.clear();
  };
  socket.onclose = () => failAll("CDP の WebSocket が閉じた");
  socket.onerror = () => failAll("CDP の WebSocket でエラーが起きた");
  socket.onmessage = (ev) => {
    const msg = parseJsonAs<CdpMessage>(ev.data);
    const call = msg.id ? pending.get(msg.id) : undefined;
    if (msg.id && call) {
      const { resolve, reject, timer } = call;
      clearTimeout(timer);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else resolve(msg.result);
    }
  };
  // The CDP method decides the shape of its result.
  const send = <T = unknown>(method: string, params: object = {}) =>
    new Promise<T>((resolve, reject) => {
      if (closedReason) {
        reject(new Error(`${method}: ${closedReason}`));
        return;
      }
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method}: ${CALL_TIMEOUT_MS}ms 以内に応答が無い`));
      }, CALL_TIMEOUT_MS);
      // oxlint-disable-next-line typescript/consistent-type-assertions -- CDP の結果の形はメソッドごとに決まり、応答の JSON からは型の検査で T を確かめられない。呼び出し側が T で宣言する
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  return send;
}

async function launchChrome() {
  const { proc, userDir } = spawnChrome();
  const connection: Connection = { ws: null };
  const shutdown = makeShutdown(proc, userDir, connection);

  try {
    const wsUrl = await waitForDevToolsUrl(proc);
    const { socket, browser } = await openPageSocket(wsUrl, connection);
    const send = createSender(socket);
    return { send, close: shutdown, browser };
  } catch (err) {
    // 片付けの失敗で元のエラーを上書きしない（原因が表面化しなくなる）。片付けの失敗は併記する。
    try {
      await shutdown();
    } catch (cleanupErr) {
      console.error(`片付けにも失敗した: ${errorMessage(cleanupErr)}`);
    }
    throw err;
  }
}

// Playwright の locator.evaluate(fn, arg) と同じ取り決め（関数を文字列化して要素と引数で呼ぶ）の最小実装。
type Cdp = Awaited<ReturnType<typeof launchChrome>>;
type Instance = (typeof INSTANCES)[number];

const locator = (cdp: Cdp, selector: string) => ({
  async evaluate(fn: (...args: never[]) => unknown, arg: unknown) {
    const r = await cdp.send<{
      exceptionDetails?: { exception?: { description?: string }; text?: string };
      result: { value: unknown };
    }>("Runtime.evaluate", {
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

// getBoundingClientRect() の値（ビューポート座標）。
type Rect = { x: number; y: number; width: number; height: number };

// 1 回の採取の入力。pages はバリアントのページ、instance と state は採る部品インスタンスと状態。
type CaptureTarget = { pages: Record<string, string>; instance: Instance; state: string };

/** ページを流し込み、部品の要素を探して、状態（hover・active・disabled）を当てる。要素の nodeId を返す。 */
async function loadAndApplyState(cdp: Cdp, { pages, instance, state }: CaptureTarget) {
  const { frameTree } = await cdp.send<{ frameTree: { frame: { id: string } } }>(
    "Page.getFrameTree",
  );
  await cdp.send("Page.setDocumentContent", {
    frameId: frameTree.frame.id,
    html: pages[instance.page],
  });
  const { root } = await cdp.send<{ root: { nodeId: number } }>("DOM.getDocument", { depth: -1 });
  const { nodeId } = await cdp.send<{ nodeId: number }>("DOM.querySelector", {
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
  return nodeId;
}

/** 部品の矩形から要素のスクリーンショットを撮り、PNG と element.shot.json の記録を返す。 */
async function captureElementShot(cdp: Cdp, rect: Rect) {
  // 要素スクショの clip は element-shot.mjs に決めさせる（矩形の丸めの原本。
  // 生の rect を渡すと小数座標のぶん寸法が揺れ、寸法一致を要求する画素比較の入力にならない）。
  const clip = elementShot.planElementClip(rect, VIEWPORT);
  const shot = await cdp.send<{ data: string }>("Page.captureScreenshot", {
    format: "png",
    clip: { ...clip, scale: 1 },
  });
  const png = Buffer.from(shot.data, "base64");
  // element.png の隣の記録（element.shot.json）も element-shot.mjs が原本として定める形で組み立てる。
  // fixture は最上位フレームの要素だけで、ページにアニメーションを持たないので、
  // page_rect は rect と同じ・animations は capture_conditions の記録どおり "disabled"。
  const shotRecord = elementShot.buildShotRecord({
    clip,
    png: elementShot.readPngSize(png),
    rect,
    page_rect: rect,
    frame_depth: 0,
    animations: "disabled",
  });
  return { png, shotRecord };
}

async function captureOnce(cdp: Cdp, target: CaptureTarget) {
  const nodeId = await loadAndApplyState(cdp, target);
  const { instance } = target;
  const name = `button@${instance.id}`;
  const el = locator(cdp, instance.selector);
  const [traits] = await traitCapture.captureTraits([{ name, locator: el }]);
  const [rules] = await cssRules.captureMatchedRules([{ name, locator: el }]);
  const { png, shotRecord } = await captureElementShot(cdp, traits.rect);
  // 総称ファミリー（sans-serif）が実際に何のフォントで描かれたかを残す（撮影環境の記録に要る）。
  const { fonts } = await cdp.send<{ fonts: { familyName: string }[] }>(
    "CSS.getPlatformFontsForNode",
    { nodeId },
  );
  const platformFonts = fonts.map((f) => f.familyName).sort();
  return { traits, rules, png, shotRecord, platformFonts };
}

// 整形は「このスクリプトが書いた JSON」だけに当てる。以前は手順書で人に `oxfmt <ディレクトリ>` を
// 実行させ、渡された Markdown まで整形されて fixture の表が巻き込まれた（4 回踏んだ）。
// 今は oxfmt.config.ts の許可リストで Markdown を外しているが、書いていない JSON を書き換えないよう列挙は残す。
const writtenJson: string[] = [];

const writeJson = (path: string, value: unknown) => {
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

// The parts of metadata.json this rewrites.
type FixtureMetadata = {
  capture: { [key: string]: unknown; tools?: Record<string, unknown> };
  axes?: Record<string, unknown>;
  [key: string]: unknown;
};

// 1 つのインスタンス × 状態の採取物。
type Captured = { instance: Instance; state: string } & Awaited<ReturnType<typeof captureOnce>>;

/** バリアントの全インスタンス × 状態を 2 回ずつ採り、一致を確かめてから 1 回目の採取物を返す。 */
async function captureVariant(cdp: Cdp, pages: Record<string, string>) {
  const captured: Captured[] = [];
  for (const instance of INSTANCES) {
    for (const state of STATES) {
      // ノイズ基準値: 同一条件で 2 回採り、特性とバイト列が一致することを確かめる。
      const first = await captureOnce(cdp, { pages, instance, state });
      const second = await captureOnce(cdp, { pages, instance, state });
      const traitsNoise = isDeepStrictEqual(first.traits, second.traits) ? 0 : 1;
      const pixelNoise = first.png.equals(second.png) ? 0 : 1;
      if (traitsNoise || pixelNoise || !isDeepStrictEqual(first.rules, second.rules)) {
        throw new Error(`${instance.id} / ${state}: 2 回の採取が一致しない（決定論的でない）`);
      }
      captured.push({ instance, state, ...first });
    }
  }
  return captured;
}

/** fixture の baseline に、インスタンス × 状態ごとの採取物と、インスタンスごとの behaviors.json を書く。 */
function writeBaseline(dir: string, captured: Captured[]): void {
  for (const { instance, state, traits, rules, png, shotRecord } of captured) {
    const base = join(dir, "baseline", instance.id, state);
    mkdirSync(base, { recursive: true });
    writeJson(join(base, "traits.json"), traits);
    writeJson(join(base, "css-rules.json"), rules);
    writeFileSync(join(base, "element.png"), png);
    writeJson(join(base, "element.shot.json"), shotRecord);
  }
  for (const instance of INSTANCES) {
    writeJson(join(dir, "baseline", instance.id, "behaviors.json"), behaviorsOf(instance.id));
  }
}

/** metadata.json の capture（状態・操作・動き・ツールの版）を、このスクリプトの宣言と同梱のツールの版で上書きする。 */
function updateCaptureDeclarations(meta: FixtureMetadata): void {
  meta.capture.states = STATES;
  meta.capture.operations = OPERATIONS;
  meta.capture.operation_source = OPERATION_SOURCE;
  meta.capture.operations_none_reason = null;
  // 動き（Issue #456）。APP_CSS / THEME_CSS は transition / animation を宣言せず、JS も持たないので動きの無い部品として宣言する。
  // build の前提は capture.motions の宣言を要求する（無いと motion-compare.mjs が型崩れで落ちる）。
  meta.capture.motions = {
    source_scan: [],
    transitions: [],
    none_reason: MOTIONS_NONE_REASON,
  };
  meta.capture.tools = {
    ...meta.capture.tools,
    motion_probe: null,
    motion_probe_version: null,
    traits_version: traitCapture.VERSION,
    traits_property_set: [...traitCapture.FIXED_PROPERTIES].sort(),
    element_shot_version: elementShot.VERSION,
    css_rules_version: cssRules.VERSION,
    axis_diff_version: axisDiff.VERSION,
  };
}

/** metadata.json の採取の抜け・撮影条件・ノイズ基準値を、採取物から書く。 */
function updateCaptureResults(meta: FixtureMetadata, captured: Captured[], browser: string): void {
  const unresolved = captured.reduce((n, c) => n + c.rules.unresolved.length, 0);
  const inaccessible = captured.reduce((n, c) => n + c.rules.inaccessible.length, 0);
  meta.capture_gaps = { inaccessible_sheets: inaccessible, unresolved_selectors: unresolved };
  // 撮影条件とノイズ基準値は、既存の値の有無（null のプレースホルダを含む）に依らず採取から書く。
  // 真偽で分岐すると null の fixture が `capture.complete: true` のまま条件も基準値も持たず残り、
  // `build` の照合が同一条件を再現できない。
  const fontsUsed = [...new Set(captured.flatMap((c) => c.platformFonts))].sort();
  if (fontsUsed.length === 0) throw new Error("描画に使われたフォントを取得できない");
  meta.capture_conditions = {
    environment: `${browser}（headless）/ Linux / DPR 1。"Noto Sans JP", sans-serif は ${fontsUsed.join(" / ")} に解決`,
    // 想定する利用者の環境との一致は、採取からは決まらない fixture の前提。両 fixture の gaps.md（採取環境依存の未検証: なし）と
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
}

/** fixture 1 つに、baseline・metadata.json・axes.json を書く。 */
function writeFixture(dir: string, captured: Captured[], browser: string): void {
  writeBaseline(dir, captured);
  const metaPath = join(dir, "metadata.json");
  const meta = parseJsonAs<FixtureMetadata>(readFileSync(metaPath, "utf8"));
  updateCaptureDeclarations(meta);
  updateCaptureResults(meta, captured, browser);
  // 軸の件数は axes.json から転記する。先に metadata を書かないと --baseline がプロパティ集合を読めない。
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

/** バリアントの幅・可変の軸・測った軸の件数を、確認用に stdout へ出す。 */
function printVariantSummary(
  variant: (typeof VARIANTS)[number],
  captured: Captured[],
  browser: string,
): void {
  const widths = Object.fromEntries(
    captured.filter((c) => c.state === "default").map((c) => [c.instance.id, c.traits.rect.width]),
  );
  const summaryAxes = parseJsonAs<{
    variable: { state: string; axis: string }[];
    measured: unknown;
  }>(readFileSync(join(variant.fixtures[0], "axes.json"), "utf8"));
  console.log(
    JSON.stringify(
      {
        browser,
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

/** CDP のドメインを有効にしてビューポートを固定し、全バリアントの fixture を生成して整形する。 */
async function generate(cdp: Cdp): Promise<void> {
  await cdp.send("Page.enable");
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    ...VIEWPORT,
    deviceScaleFactor: 1,
    mobile: false,
  });

  for (const variant of VARIANTS) {
    const captured = await captureVariant(cdp, variant.pages);
    for (const dir of variant.fixtures) writeFixture(dir, captured, cdp.browser);
    printVariantSummary(variant, captured, cdp.browser);
  }
  formatWrittenJson();
}

const cdp = await launchChrome();
let generationError: unknown = null;
try {
  await generate(cdp);
} catch (err) {
  generationError = err;
}
// 起動に失敗したときの処理と同じく、片付けの失敗（SIGKILL 後も終了しない等）で生成の元のエラーを上書きしない。
try {
  await cdp.close();
} catch (cleanupErr) {
  if (!generationError) throw cleanupErr;
  console.error(`片付けにも失敗した: ${errorMessage(cleanupErr)}`);
}
if (generationError) throw generationError;
