// append-only-check.test.ts のヘルパー。
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDirFactory } from "../../lib/testing/test-tmpdir.ts";
import { spawnAsync } from "../../lib/spawn-async.ts";
import { parseJsonAs } from "../../lib/parse-as.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const script = join(repoRoot, "skills/replace-strategy/scripts/append-only-check.mjs");

// **テストは `test.concurrent` で並べて実行する**（Issue #590）。どのテストも git とチェックの子プロセスの終了を待つだけなので、
// 並べた分だけ 1 回の実行が縮み、ミューテーションテストでは変異の数だけ反映される。
// そのため、テストの間で状態を共有しない。fixture はテストごとに別の一時ディレクトリに作る（`tempDir`）。
export const tempDir = makeTempDirFactory("append-only-check-");

/** parity の metadata.json の未測定の項目（PARITY_METADATA の形）。 */
export type UnmeasuredEntry = {
  item: string;
  reason: string;
  disposition: string;
  approved_by: string | null;
  approved_at: string | null;
};
/** parity の metadata.json（PARITY_METADATA の形）。 */
export type ParityMetadataDoc = {
  slug: string;
  unmeasured: { declared: boolean; entries: UnmeasuredEntry[]; reason: string | null };
  performance?: unknown;
};

export const FEATURES = [
  "# 機能一覧",
  "",
  "- 最終更新: 2026-09-01T00:00:00Z",
  "",
  "| slug | 名前 | 状態 | Issue |",
  "|---|---|---|---|",
  "| order-list | 注文一覧 | 済 | #11 |",
  "| order-edit | 注文編集 | 未 | 未起票 |",
  "",
].join("\n");

export const DATASET = `${JSON.stringify({ version: 1, changes: [{ version: 1, affects: ["orders"] }] }, null, 2)}\n`;

export const EXCEPTIONS = `${JSON.stringify(
  {
    version: 1,
    slug: "order-list",
    component_diff_exception_causes: [
      {
        id: "font-subset",
        reason: "サブセット差",
        evidence: "component-diff-exceptions.md#font-subset",
      },
    ],
    component_diff_exceptions: [
      {
        slug: "order-list",
        page: "/orders",
        element: "grid",
        cause: "font-subset",
        approved_at: "2026-09-01T00:00:00Z",
      },
      {
        slug: "order-list",
        page: "/users",
        element: "grid",
        cause: "font-subset",
        approved_at: "2026-09-10T00:00:00Z",
      },
    ],
  },
  null,
  2,
)}\n`;

export const PARITY_METADATA = `${JSON.stringify(
  {
    slug: "order-list",
    unmeasured: {
      declared: true,
      entries: [
        {
          item: "一覧の空状態",
          reason: "シードが無い",
          disposition: "blocking",
          approved_by: null,
          approved_at: null,
        },
        {
          item: "モバイル幅",
          reason: "撮っていない",
          disposition: "blocking",
          approved_by: null,
          approved_at: null,
        },
      ],
      reason: null,
    },
  },
  null,
  2,
)}\n`;

export const ASSETS = [
  "# 移行元の静的資産の台帳（assets）",
  "",
  "- 最終更新: 2026-09-01T00:00:00Z",
  "",
  "## 方針",
  "",
  "| 種類 | ファイル・出どころ | 方針 | 宣言 | 状態 | 決定日・決めた工程 | 理由 |",
  "|---|---|---|---|---|---|---|",
  "| ロゴ | `logo.png` | 実体をコピーする | - | 有効 | 2026-09-01・setup | 再配布可を確認済み |",
  "| 本文の書体 | `body.woff2` | 実体をコピーする | - | 有効 | 2026-09-01・setup | 字形を一致させるため |",
  "",
].join("\n");

export const DEPENDENCIES = [
  "# 依存パッケージの決定記録（dependencies）",
  "",
  "- 最終更新: 2026-09-01T00:00:00Z",
  "- 方針の所在: 未確認",
  "",
  "## 本文フォント: example-font@1.2.3",
  "",
  "- 要件（現行と一致させる条件）: 版とヒンティング命令の有無が一致すること",
  "- ライセンス: MIT",
  "",
].join("\n");

export const GAPS = [
  "# 未検証領域",
  "",
  "| 箇所 | 種別 | 理由 |",
  "|---|---|---|",
  "| 一覧の空状態 | データ不足 | シードが無い |",
  "",
].join("\n");

export const EMPTY_EXCEPTIONS = `${JSON.stringify(
  {
    version: 1,
    slug: "order-list",
    component_diff_exception_causes: [],
    component_diff_exceptions: [],
  },
  null,
  2,
)}\n`;

/**
 * git が使えるコミット済みのプロジェクトを作る。
 * @param {{ emptyExceptions?: boolean }} [opts]
 */
export async function makeRepo(opts: { emptyExceptions?: boolean } = {}) {
  const root = tempDir("append-only-");
  mkdirSync(join(root, ".replace/parity/order-list"), { recursive: true });
  mkdirSync(join(root, ".replace/dataset"), { recursive: true });
  writeFileSync(join(root, ".replace/features.md"), FEATURES);
  writeFileSync(join(root, ".replace/parity/order-list/gaps.md"), GAPS);
  writeFileSync(join(root, ".replace/assets.md"), ASSETS);
  writeFileSync(join(root, ".replace/dependencies.md"), DEPENDENCIES);
  writeFileSync(join(root, ".replace/dataset/metadata.json"), DATASET);
  writeFileSync(
    join(root, ".replace/parity/order-list/component-diff-exceptions.json"),
    opts.emptyExceptions === true ? EMPTY_EXCEPTIONS : EXCEPTIONS,
  );
  writeFileSync(join(root, ".replace/parity/order-list/metadata.json"), PARITY_METADATA);
  for (const args of [
    ["init", "-q", "."],
    ["config", "user.email", "test@example.com"],
    ["config", "user.name", "test"],
    ["add", "-A"],
    ["commit", "-qm", "seed"],
  ]) {
    const r = await spawnAsync("git", ["-C", root, ...args], { timeout: CHILD_TIMEOUT_MS });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
  return root;
}

/**
 * @param {string} root
 * @param {string[]} [extra]
 */
export async function run(root: string, extra: string[] = []) {
  const r = await spawnAsync(process.execPath, [script, "--root", root, ...extra], {
    timeout: CHILD_TIMEOUT_MS,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/**
 * 一覧を差し替える（unit の語彙・組み合わせを測るため）。
 * @param {string} root
 * @param {unknown[]} artifacts
 * @returns {string}
 */
export function writeManifest(root: string, artifacts: unknown[]): string {
  const path = join(root, "manifest.json");
  writeFileSync(path, JSON.stringify({ version: "2", artifacts }));
  return path;
}

/**
 * 同梱の一覧の project-config を、YAML の設定ファイル（skills.yml）を lines で守る項目に替えた一覧。
 * 同梱の一覧は JSONC の設定ファイルを jsonc-tree で守る。lines の registry_groups・growable_containers・mutable_blocks は、
 * 一覧をコピーして YAML の成果物を守る利用者のために残しているので、その機能をこの一覧で確かめる。
 * @param {string} root
 * @returns {string}
 */
export function yamlConfigManifest(root: string): string {
  const bundled = parseJsonAs<{ artifacts: { id: string }[] }>(
    readFileSync(
      join(repoRoot, "skills/replace-strategy/assets/append-only-manifest.json"),
      "utf8",
    ),
  );
  const artifacts = bundled.artifacts.map((a) =>
    a.id !== "project-config"
      ? a
      : {
          id: "project-config",
          pattern: ".config/skills/*/skills.yml",
          unit: "lines",
          registry_groups: [
            {
              id: "intentional-diffs",
              item_key: "item",
              paths: [
                "skills.replace-strategy.intentional_diffs.keep",
                "skills.replace-strategy.intentional_diffs.may_change",
                "skills.replace-strategy.intentional_diffs.pending",
              ],
            },
          ],
          growable_containers: ["skills.replace-strategy.component_diffs"],
        },
  );
  const path = join(root, "yaml-config-manifest.json");
  writeFileSync(path, JSON.stringify({ version: "2", artifacts }));
  return path;
}

/** YAML の設定ファイルを lines で守る一覧で実行する。 */
export async function runYaml(root: string, extra: string[] = []) {
  return run(root, ["--manifest", yamlConfigManifest(root), ...extra]);
}

// ---------------------------------------------------------------------------
// 設定ファイル（project-config）の可変領域（Issue #426）
//
// intentional_diffs.pending は設定ファイル上で唯一スキルが追記する記録で、棚卸しで人が
// keep / may_change へ文言を移す。行の多重集合で見ると、この正規の運用が誤って「行が失われた」と判定され、
// 指示どおり復元すると記録した保留が消える（データを失う方向へ誘導される）。
// 緩和の範囲が広すぎないことも、検出できることの確認で測る。キーごと消す・keep の要素を落とす・
// 要素を別物へ差し替える、はいずれも落ちなければならない。
// ---------------------------------------------------------------------------

// **実在する設定ファイルの入れ子で測る**（`skills.<スキル名>.…`。原本は replace-strategy の
// references/project-config.md）。mutable_blocks はルートからの完全なパスで探すので、
// 平らな YAML の fixture では「外せているか」を一度も実証できない。平らな fixture では
// パスが一致せず、検査が厳しい側と判定されるだけなので、緩和のテストが全部素通りする。
export const CONFIG = [
  "skills:",
  "  replace-strategy:",
  "    new:",
  "      stack: [typescript]",
  "    intentional_diffs:",
  '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
  "      may_change: [] # 変えてよい（例: ディレクトリ・ファイル名）",
  "      pending: [] # 保留（測定結果で決める）",
  "      # ↑ 外した領域の後ろに続く注記（構造行ではないのでブロックを閉じない）",
  "    component_diffs: []",
  "    bare_list: []",
  "",
].join("\n");

export const PENDING_BLOCK = [
  "      pending: # 保留（測定結果で決める）",
  "        - item: 一覧の並び順が変わる",
  "          slug: cross-cutting",
  "          added_by: replace-strategy",
  '          added_at: "2026-09-21"',
  "",
].join("\n");

/**
 * @param {string} root
 * @param {string} message
 */
export async function commit(root: string, message: string) {
  for (const args of [
    ["add", "-A"],
    ["commit", "-qm", message],
  ]) {
    const r = await spawnAsync("git", ["-C", root, ...args], { timeout: CHILD_TIMEOUT_MS });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
}

/** @param {string} root */
export function configPath(root: string) {
  return join(root, ".config/skills/acme/skills.yml");
}

/** @param {string} root */
export function readConfig(root: string) {
  return readFileSync(configPath(root), "utf8");
}

/**
 * @param {string} root
 * @param {string} text
 */
export function writeConfig(root: string, text: string) {
  writeFileSync(configPath(root), text);
}

/**
 * 設定ファイルを持つプロジェクトを作る（比較元にも在る状態で commit 済み）。
 * @param {string} [text]
 */
export async function makeConfigRepo(text = CONFIG) {
  const root = await makeRepo();
  mkdirSync(join(root, ".config/skills/acme"), { recursive: true });
  writeConfig(root, text);
  await commit(root, "config");
  return root;
}

/** pending に 1 件積んだ状態を比較元にする。 */
export async function makeConfigRepoWithPending() {
  const root = await makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace("      pending: [] # 保留（測定結果で決める）\n", PENDING_BLOCK),
  );
  await commit(root, "pending に 1 件");
  return root;
}

// ---------------------------------------------------------------------------
// 依存台帳の決定を覆す（Issue #428）
//
// 決定が覆ったら行を消さず「状態」列を 取り消し済み にして新しい行を追記する。
// 状態列だけが mutable_columns なので、それ以外の列の書き換えと行の削除は落ちる。
// ---------------------------------------------------------------------------

export const DEPENDENCY_TABLE = [
  "# 依存パッケージの決定記録（dependencies）",
  "",
  "- 最終更新: 2026-09-01T00:00:00Z",
  "- 方針の所在: 未確認",
  "",
  "## 一覧",
  "",
  "| 部品（用途） | 決定 | 採用したもの | 適用範囲 | 状態 | 決定時期 | 理由・引き取り手 |",
  "|---|---|---|---|---|---|---|",
  "| データグリッド | パッケージ採用 | example-grid@4.5.0 | 全機能 | 有効 | setup | - |",
  "| 確認ダイアログ | 未確認 | — | — | 有効 | setup | 削除ボタンでしか出せず現行 target で削除が禁止されている |",
  "",
].join("\n");

/** 依存台帳（表つき）を比較元に持つプロジェクトを作る。 */
export async function makeDependencyRepo() {
  const root = await makeRepo();
  writeFileSync(join(root, ".replace/dependencies.md"), DEPENDENCY_TABLE);
  await commit(root, "dependencies 台帳");
  return root;
}

/** @param {string} root */
export function readDependencies(root: string) {
  return readFileSync(join(root, ".replace/dependencies.md"), "utf8");
}

/**
 * @param {string} root
 * @param {string} text
 */
export function writeDependencies(root: string, text: string) {
  writeFileSync(join(root, ".replace/dependencies.md"), text);
}

// ---------------------------------------------------------------------------
// フロー形式の registry 要素・オプション間の入れ子（PR #429 のレビュー指摘・6 巡目）
// ---------------------------------------------------------------------------

export const FLOW_PENDING =
  "      pending: [{item: 合計の丸め, slug: cross-cutting, added_by: replace-strategy}] # 保留（測定結果で決める）\n";

/** pending にフロー形式のマッピング要素を 1 件積んだ状態を比較元にする。 */
export async function makeConfigRepoWithFlowPending() {
  const root = await makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace("      pending: [] # 保留（測定結果で決める）\n", FLOW_PENDING),
  );
  await commit(root, "pending にフロー形式で 1 件");
  return root;
}

// 1 行に収まらない照合キーの値（PR #429 のレビュー指摘・8 巡目）
// ---------------------------------------------------------------------------

export const MULTILINE_PENDING = [
  "      pending: # 保留（測定結果で決める）",
  "        - item:",
  "            合計の丸めが現行と違う",
  "          slug: cross-cutting",
  "          added_by: replace-strategy",
  "        - item: >-",
  "            確認ダイアログを出さない",
  "          slug: cross-cutting",
  "          added_by: parity-diff",
  "",
].join("\n");

/** 照合キーの値が 1 行に収まらない要素（プレーン多行スカラー・ブロックスカラー）を比較元にする。 */
export async function makeConfigRepoWithMultilinePending() {
  const root = await makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace("      pending: [] # 保留（測定結果で決める）\n", MULTILINE_PENDING),
  );
  await commit(root, "pending に 1 行に収まらない値の要素");
  return root;
}

// ---------------------------------------------------------------------------
export const QUOTED_COMMA_PENDING =
  '      pending: [{item: "順序は id, 名前の順", slug: cross-cutting}] # 保留（測定結果で決める）\n';

/** 引用符の中にカンマを持つフロー形式のマッピング要素を比較元にする。 */
export async function makeConfigRepoWithQuotedFlowPending() {
  const root = await makeConfigRepo();
  writeConfig(
    root,
    readConfig(root).replace(
      "      pending: [] # 保留（測定結果で決める）\n",
      QUOTED_COMMA_PENDING,
    ),
  );
  await commit(root, "pending に引用符つきカンマを含む要素");
  return root;
}

// --- 1 行で閉じないフロー形式のコンテナ（#430） ---
//
// `flowItems` は `raw.slice(1, -1)` で末尾 1 文字を閉じ括弧と決め打ちしていたため、折り返された
// コンテナを「読めた」ことにしていた（`[` は空、`[ "a",` は要素 1 件）。読めたことにすると
// 折り返しの中身が空に見え、要素を足しただけの編集が誤って縮小と判定される。

/**
 * growable_containers に a.keep を名指しした設定で、比較元 before を after へ書き換えて実行する。
 * @param {string} before
 * @param {string} after
 */
export async function runKeepEdit(before: string, after: string) {
  const { root, manifest } = await makeHintRepo({ growable_containers: ["a.keep"] }, before);
  writeConfig(root, after);
  const r = await run(root, ["--manifest", manifest]);
  rmSync(root, { recursive: true, force: true });
  return r;
}

/** keep を折り返した形で書いた設定ファイル。 */
export const WRAPPED_KEEP = [
  "      keep: [",
  '        "テーブル名を保つ",',
  '        "項目名を保つ"',
  "      ] # 変えない（例: テーブル名、項目名）",
].join("\n");

/** @param {string} root */
export async function makeWrappedConfigRepo() {
  return await makeConfigRepo(
    CONFIG.replace(
      '      keep: ["テーブル名を保つ"] # 変えない（例: テーブル名、項目名）',
      WRAPPED_KEEP,
    ),
  );
}

/**
 * @param {Record<string, unknown>} option
 * @param {string} before
 */
export async function makeHintRepo(option: Record<string, unknown>, before: string) {
  const root = await makeConfigRepo(before);
  const manifest = writeManifest(root, [
    { id: "c", pattern: ".config/skills/*/skills.yml", unit: "lines", ...option },
  ]);
  return { root, manifest };
}

// ---------------------------------------------------------------------------
// JSONC の設定ファイル（project-config。unit: jsonc-tree）
//
// 同梱の一覧は .config/skills/*/replace-strategy.jsonc を jsonc-tree で守る。
// 通す側（キー・要素・コメントを足す、pending の文言を keep へ移す）と、
// 落とす側（値の書き換え・キーの削除・要素の削除・コメントの削除・読めない JSONC）を両方測る。
// ---------------------------------------------------------------------------

export const JSONC_CONFIG = [
  "{",
  "  // 現行アプリ",
  '  "current": { "repo": "none", "stack": ["typescript"] },',
  '  "targets": [',
  '    { "name": "current-test", "side": "current", "url": "http://localhost:8080" }, // 測定の対象',
  "  ],",
  '  "references": { "architecture": "" },',
  '  "intentional_diffs": {',
  '    "keep": ["テーブル名を保つ"], // 変えない',
  '    "may_change": [],',
  '    "pending": [',
  '      { "item": "一覧の並び順が変わる", "slug": "cross-cutting", "added_by": "replace-strategy", "added_at": "2026-09-21" }, // 測定で決める',
  "    ],",
  "  },",
  '  "component_diffs": [{ "component": "heading", "property": "border-style", "current": "none", "new": "solid", "reason": "テーマ" }],',
  "}",
  "",
].join("\n");

/** @param {string} root */
export function jsoncPath(root: string) {
  return join(root, ".config/skills/shoji9x9/replace-strategy.jsonc");
}

/** JSONC の設定ファイルを持つプロジェクトを作る（比較元にも在る状態で commit 済み）。 */
export async function makeJsoncRepo(text = JSONC_CONFIG) {
  const root = await makeRepo();
  mkdirSync(dirname(jsoncPath(root)), { recursive: true });
  writeFileSync(jsoncPath(root), text);
  await commit(root, "jsonc config");
  return root;
}

/**
 * @param {string} from
 * @param {string} to
 */
export async function runJsoncEdit(from: string, to: string) {
  const root = await makeJsoncRepo();
  const before = readFileSync(jsoncPath(root), "utf8");
  if (!before.includes(from)) throw new Error(`置換元が無い: ${from}`);
  writeFileSync(jsoncPath(root), before.replace(from, to));
  const r = await run(root);
  rmSync(root, { recursive: true, force: true });
  return r;
}

// ---- --exclude（利用者の pre-commit・CI へ組み込むとき、設定ファイルを外す。#540）----

/** 設定ファイルの既存の値を書き換えた作業ツリー（他スキルの設定を直す正当な編集に当たる）。 */
export async function makeConfigRepoWithEditedValue() {
  const root = await makeJsoncRepo();
  writeFileSync(
    jsoncPath(root),
    JSONC_CONFIG.replace('"stack": ["typescript"]', '"stack": ["javascript"]'),
  );
  return root;
}

// ---------------------------------------------------------------------------
// 表の列の「空 → 非空だけ」（fill_only_columns。Issue #527）
//
// 空欄で追記し後で人が決定を埋める列は、mutable_columns に置くと決めた値の書き換えまで通り、
// どちらにも置かないと、空欄を埋めるだけの正規の編集が誤って縮小と判定される。
// 通す側（埋める）と落とす側（差し替え・消去）を両方測る。
// 台帳は同梱の一覧（デフォルトの --manifest）で測る。一覧の列名がテンプレートの列名と食い違うと、緩和が一度も適用されない。
// ---------------------------------------------------------------------------

export const WEAKNESS_HEADER =
  "| 弱点 | 分類 | 攻撃の流れ | 基準（1 / 2 / 3） | 仕分け | 宣言 | 扱う設計作業 | 露出を広げた差異 | 状態 | 決定日・決めた工程 | 根拠 |";
export const WEAKNESS_DECIDED =
  "| CSRF | A01 | `POST /api/orders` | 満 / 満 / 否 | 引き継ぐ | 書き込みの API は text/plain を受け付ける | #123 | - | 有効 | 2026-09-01・setup | 現行ソースのハンドラ |";
export const WEAKNESS_BLANK =
  "| IDOR | A01 | `GET /api/orders/:id` | 満 / 満 / 満 |  |  |  | - | 有効 |  | 現行ソースのハンドラ |";
export const WEAKNESS_UNCONFIRMED =
  "| XSS | A03 | `GET /settings` | 満 / 未確認 / 満 |  |  |  | - | 有効 |  | 保存した値を描画へ使う |";
export const WEAKNESS_NONE =
  "| 該当なし（A04） | A04 | - | - | 該当なし | - | - | - | 有効 | 2026-09-01・setup | 探した場所 |";

/** 弱点台帳と方針空欄の行を持つ資産台帳を比較元に持つプロジェクトを作る。 */
export async function makeFillOnlyRepo() {
  const root = await makeRepo();
  writeFileSync(
    join(root, ".replace/weaknesses.md"),
    [
      "# 現行の弱点の仕分け（weaknesses）",
      "",
      "- 最終更新: 2026-09-01T00:00:00Z",
      "",
      "## 仕分け",
      "",
      WEAKNESS_HEADER,
      "|---|---|---|---|---|---|---|---|---|---|---|",
      WEAKNESS_DECIDED,
      WEAKNESS_BLANK,
      WEAKNESS_UNCONFIRMED,
      WEAKNESS_NONE,
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(root, ".replace/assets.md"),
    [
      "# 移行元の静的資産の台帳（assets）",
      "",
      "- 最終更新: 2026-09-01T00:00:00Z",
      "",
      "## 方針",
      "",
      "| 種類 | ファイル・出どころ | 描き方と使われるページ | 方針 | 再配布の可否（根拠） | 同等物で残る差 | 宣言 | 状態 | 決定日・決めた工程 | 理由 |",
      "|---|---|---|---|---|---|---|---|---|---|",
      "| ロゴ | `logo.png` | `img`、ヘッダー | 実体をコピーする | 可（ライセンス・2026-09-01） | - | - | 有効 | 2026-09-01・setup | 字形を一致させるため |",
      "| 状態アイコン | `close.png` | `::before` のグリフ、/orders |  | 未確認 |  |  | 有効 |  | 再配布の可否を確認中 |",
      "",
    ].join("\n"),
  );
  await commit(root, "fill-only 台帳");
  return root;
}

/**
 * root の下の file で、from の最初の出現を to に置き換える。
 * @param {string} root
 * @param {string} file
 * @param {{ from: string, to: string }} change
 */
export function replaceIn(root: string, file: string, { from, to }: { from: string; to: string }) {
  const path = join(root, file);
  const text = readFileSync(path, "utf8");
  if (!text.includes(from)) throw new Error(`置換元が無い: ${from}`);
  writeFileSync(path, text.replace(from, to));
}

// pinned_values（Issue #582）。性能の許容幅の下限は利用者の決定で、採取から導けない。
// 手で緩めると本物の回帰が許容幅の中に入るので、履歴（floor_history）を追記しない変更を落とす。
// 落とす入力（追記なしの変更・記録と合わない追記・履歴の削除と書き換え）と同じ数だけ、通る入力
// （履歴を追記した変更・初めて書く・下限を変えない採り直し・他の項目だけの変更）を置く。

export const FLOORS = { lcp: 100, cls: 0.01, tbt: 50, ttfb: 50 };
export const RELATIVE_FLOORS = { lcp: 0.2, cls: 0, tbt: 0.2, ttfb: 0.2 };

/** 履歴の 1 件（perf-stats.mjs summarize --write が書く形）。 */
export const historyEntry = (
  floors: Record<string, number> = FLOORS,
  relativeFloors: Record<string, number> = RELATIVE_FLOORS,
  sha = "a".repeat(64),
) => ({
  floors,
  relative_floors: relativeFloors,
  samples_sha256: sha,
  measured_at: "2026-10-08T00:00:00.000Z",
});

/** parity の metadata.json の performance（seededPerformance の形）。 */
export type Performance = {
  floors: Record<string, number>;
  relative_floors: Record<string, number>;
  floor_history: ReturnType<typeof historyEntry>[];
  [key: string]: unknown;
};

/**
 * performance を持つ parity の metadata.json を commit したプロジェクトを作る。
 * @param {Record<string, unknown> | undefined} performance
 */
export async function makePerfRepo(performance: Record<string, unknown> | undefined) {
  const root = await makeRepo();
  const path = join(root, ".replace/parity/order-list/metadata.json");
  const doc = parseJsonAs<ParityMetadataDoc>(readFileSync(path, "utf8"));
  if (performance !== undefined) doc.performance = performance;
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  const r = await spawnAsync("git", ["-C", root, "commit", "-qam", "perf"], {
    timeout: CHILD_TIMEOUT_MS,
  });
  if (r.status !== 0 && performance !== undefined) throw new Error(r.stderr);
  /** @param {(perf: Record<string, unknown>, doc: Record<string, unknown>) => void} edit */
  const edit = (edit: (perf: Performance, doc: Record<string, unknown>) => void) => {
    const now = parseJsonAs<{ performance: Performance; [key: string]: unknown }>(
      readFileSync(path, "utf8"),
    );
    edit(now.performance, now);
    writeFileSync(path, `${JSON.stringify(now, null, 2)}\n`);
  };
  return { root, edit };
}

export const seededPerformance = () => ({
  declared: true,
  floors: { ...FLOORS },
  relative_floors: { ...RELATIVE_FLOORS },
  floor_history: [historyEntry()],
});

/** parity の metadata.json に当てる一覧の項目（pinned_values だけを差し替える）。 */
export const pinnedArtifact = (pinned: unknown) => ({
  id: "parity-unmeasured",
  pattern: ".replace/parity/*/metadata.json",
  unit: "json-arrays",
  arrays: ["unmeasured.entries"],
  key: "item",
  pinned_values: pinned,
});
