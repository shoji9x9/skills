#!/usr/bin/env node
// shell ファイルと markdown 内の shell コードブロックを走査し、ページネーション未処理の
// API 取得を検出する。指定件数以上のデータがあると取りこぼす典型バグの再発防止。
//
// 検出する内容:
//   - GraphQL: `gh api graphql` で `first:` / `last:` を使うのに `pageInfo` も `--paginate` も無い
//   - REST:    `gh api` のコレクション取得（末尾が comments/reviews/... 等、または per_page/page= 使用）で
//              `--paginate` が無い（GET 相当のみ。POST/PATCH/PUT/DELETE は対象外）
//
// 意図的に 1 ページだけ取得する場合は、当該コマンドの行に `# pagination-ok` を付けて抑制する。
//
// 中核の判定は純粋関数 `lint(path, content)` に切り出してある（scripts/lint-pagination.test.js でテスト）。
//
// 使い方: node scripts/lint-pagination.js [files...]
//   引数なし: リポジトリ内の *.sh と *.md を全件走査。
//   引数あり: 渡されたファイルだけを走査する（無視規則は適用しない。lefthook が staged file を渡す経路）。
//
// 引数なしの走査対象は **git の無視規則をそのまま使って**決める（`git ls-files --cached --others
// --exclude-standard`）。ディレクトリを素朴に辿ると `.gitignore` 済みの生成物まで読むため、
// CI（クリーンな checkout ＝ tracked のみ）では出ない指摘が手元でだけ出る。
// 実際に `tests/*/iteration-*/eval-*/`（.gitignore 済みの eval 実行成果物。エージェントの応答が
// そのまま入っており、こちらが書いたコードではない）で 2 件の偽の赤が出て、CI が緑なのに
// 手元が赤いという食い違いになった。git を使えない場所（git 未導入・work tree の外）では
// 走査を止めず、従来のディレクトリ走査へ落ちる（無視規則は効かないぶん過検出側に倒す）。

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const COLLECTION_SEGMENTS = new Set([
  "comments",
  "reviews",
  "commits",
  "files",
  "issues",
  "pulls",
  "labels",
  "assignees",
  "events",
  "runs",
  "jobs",
  "releases",
  "tags",
  "branches",
  "members",
  "collaborators",
  "notifications",
  "requested_reviewers",
  "reactions",
  "statuses",
  "hooks",
  "keys",
  "deployments",
  "stargazers",
  "subscribers",
  "forks",
  "teams",
  "milestones",
]);
const SHELL_LANGS = new Set(["bash", "sh", "shell"]);
// 後続トークンを値として消費するフラグ（その値を位置引数=エンドポイントと誤認しないため）。
const VALUE_FLAGS = new Set([
  "-H",
  "--header",
  "-f",
  "--field",
  "-F",
  "--raw-field",
  "-q",
  "--jq",
  "-X",
  "--method",
  "-t",
  "--template",
  "--hostname",
  "--cache",
  "--input",
]);
const SUPPRESS = "pagination-ok";
const GRAPHQL_MSG =
  "GraphQL の first:/last: にページング処理が無い。pageInfo{ hasNextPage endCursor } と --paginate で全件取得するか、`# pagination-ok` で単発取得を明示する。";
const REST_MSG =
  "gh api のコレクション取得に --paginate が無い。全ページ取得するか、`# pagination-ok` で単発取得を明示する。";

// クォート（' "）を尊重して空白でトークン分割する。素朴な split より誤りにくい。
export function tokenize(s) {
  const tokens = [];
  let cur = "",
    has = false,
    quote = null;
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      cur += ch;
      has = true;
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (has) {
        tokens.push(cur);
        cur = "";
        has = false;
      }
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has) tokens.push(cur);
  return tokens;
}

// `gh api` の最初の位置引数（エンドポイント）の末尾セグメントを返す。graphql / 取得不能なら null。
export function restEndpointSegment(cmd) {
  const toks = tokenize(cmd);
  let api = -1;
  for (let i = 0; i < toks.length - 1; i++) {
    if (toks[i] === "gh" && toks[i + 1] === "api") {
      api = i;
      break;
    }
  }
  if (api < 0) return null;
  for (let i = api + 2; i < toks.length; i++) {
    const t = toks[i];
    if (t.startsWith("-")) {
      if (VALUE_FLAGS.has(t.split("=")[0]) && !t.includes("=")) i++; // 値トークンを飛ばす
      continue;
    }
    const ep = t
      .replace(/^['"]|['"]$/g, "")
      .split("?")[0]
      .replace(/\/+$/, "");
    if (!ep.includes("/")) return null; // 例: graphql
    return ep.split("/").pop();
  }
  return null;
}

// 1 ファイルから「shell ユニット」を取り出す。各ユニットは行（{ n, text }）の配列。
// .sh はファイル全体で 1 ユニット。.md は bash/sh/shell コードブロックごとに 1 ユニット。
export function unitsFromFile(path, content) {
  const lines = content.split("\n");
  if (path.endsWith(".sh")) return [lines.map((text, i) => ({ n: i + 1, text }))];
  const units = [];
  let cur = null,
    fenceChar = null;
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^\s*(`{3,}|~{3,})\s*([A-Za-z0-9_-]*)/);
    if (!cur && open && SHELL_LANGS.has(open[2].toLowerCase())) {
      cur = [];
      fenceChar = open[1][0];
      continue;
    }
    if (cur) {
      const close = lines[i].match(/^\s*(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fenceChar) {
        units.push(cur);
        cur = null;
        fenceChar = null;
      } else cur.push({ n: i + 1, text: lines[i] });
    }
  }
  return units;
}

// 行末 `\` の継続を論理行に結合する（n は先頭の行番号）。
export function logicalLines(unit) {
  const out = [];
  let buf = null;
  for (const it of unit) {
    if (!buf) buf = { n: it.n, text: it.text };
    else buf.text += " " + it.text;
    if (/\\\s*$/.test(it.text)) buf.text = buf.text.replace(/\\\s*$/, " ");
    else {
      out.push(buf);
      buf = null;
    }
  }
  if (buf) out.push(buf);
  return out;
}

// 中核の判定。findings の配列（{ path, n, msg }）を返す純粋関数。
export function lint(path, content) {
  const findings = [];
  for (const unit of unitsFromFile(path, content)) {
    const unitText = unit.map((l) => l.text).join("\n");

    // GraphQL: コマンド単位で判定（同ブロックの別コマンドの --paginate に惑わされない）。
    const reGraphql = /gh\s+api\s+graphql\b[^\n]*?-f\s+query=(['"])([\s\S]*?)\1[^\n]*/g;
    let gm;
    while ((gm = reGraphql.exec(unitText)) !== null) {
      const cmd = gm[0],
        body = gm[2];
      // --paginate は query の前後どちらに書かれてもよいので、コマンド全体（gm[0]）で判定する。
      if (!/\b(first|last):/.test(body) || /pageInfo/.test(body) || /--paginate/.test(cmd))
        continue;
      const startIdx = unitText.slice(0, gm.index).split("\n").length - 1;
      const endIdx = unitText.slice(0, gm.index + gm[0].length).split("\n").length - 1;
      let suppressed = false; // 抑制は当該コマンドが占める行のみで判定する
      for (let i = startIdx; i <= endIdx; i++)
        if (unit[i]?.text.includes(SUPPRESS)) suppressed = true;
      if (!suppressed) findings.push({ path, n: (unit[startIdx] ?? unit[0]).n, msg: GRAPHQL_MSG });
    }

    // REST: コレクション取得の --paginate 漏れ。
    for (const ll of logicalLines(unit)) {
      const c = ll.text;
      if (!/gh\s+api\s/.test(c) || /gh\s+api\s+graphql/.test(c)) continue;
      if (c.includes(SUPPRESS) || /--paginate/.test(c)) continue;
      if (/(--method|-X)\s+(POST|PUT|PATCH|DELETE)/i.test(c)) continue; // 変更系は対象外
      const seg = restEndpointSegment(c);
      const hasPageParam = /per_page=|[?&]page=/.test(c);
      if ((seg && COLLECTION_SEGMENTS.has(seg)) || hasPageParam) {
        findings.push({ path, n: ll.n, msg: REST_MSG });
      }
    }
  }
  return findings;
}

/** インストール済みコピー（生成物）とツールの作業領域。どちらの列挙経路でも外す。 */
const SKIP_DIRS = new Set(["node_modules", ".git", ".agents", ".claude"]);

export function isLintable(path) {
  return path.endsWith(".sh") || path.endsWith(".md");
}

/** dir 配下を素朴に辿る（git を使えないときのフォールバック。無視規則は効かない）。 */
export function walkFiles(dir, deps = {}) {
  const readdir = deps.readdirSync ?? readdirSync;
  const stat = deps.statSync ?? statSync;
  const out = [];
  for (const name of readdir(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (stat(p).isDirectory()) out.push(...walkFiles(p, deps));
    else if (isLintable(name)) out.push(p);
  }
  return out;
}

/**
 * git の無視規則に従って走査対象を列挙する。git work tree の外・git 不在なら null を返す
 * （呼び出し側が walkFiles へ落ちる。ここで空配列を返すと「対象ゼロ＝指摘ゼロ」で緑になる）。
 */
export function gitFiles(dir, deps = {}) {
  const run = deps.execFileSync ?? execFileSync;
  let stdout;
  try {
    stdout = run(
      "git",
      ["-C", dir, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } catch {
    return null;
  }
  if (typeof stdout !== "string") return null;
  const base = resolve(dir);
  const out = [];
  for (const entry of stdout.split("\0")) {
    if (entry === "") continue;
    if (!isLintable(entry)) continue;
    // 除外は **dir からの相対パス**（git の出力そのもの）で判定する。cwd 相対に直してから
    // 判定すると、dir の外側のディレクトリ名（`node_modules/` 配下への checkout・`../` を挟む
    // 呼び出し）を拾って、走査対象を丸ごと落としてしまう。
    if (entry.split("/").some((segment) => SKIP_DIRS.has(segment))) continue;
    // git は起動時の cwd（`-C dir` なので dir）からの相対で返す。読める形へ直して返す。
    const abs = resolve(base, entry);
    out.push(relative(process.cwd(), abs) || entry);
  }
  return out;
}

/** 走査対象の列挙（引数なしの実行で使う）。 */
export function listFiles(dir = ".", deps = {}) {
  return gitFiles(dir, deps) ?? walkFiles(dir, deps);
}

export function main(argv = process.argv.slice(2), deps = {}) {
  const read = deps.readFileSync ?? readFileSync;
  const log = deps.log ?? console.log;
  const err = deps.error ?? console.error;
  // 引数ありは「これを見ろ」という明示なので無視規則を当てない（lefthook の staged file 経路）。
  const targets = (argv.length ? argv : listFiles(".", deps)).filter(isLintable);
  // 対象 0 件を成功に倒さない。列挙が壊れると「指摘 0 件」と見分けが付かなくなる。
  if (targets.length === 0) {
    err(
      `error: 走査対象が 0 件（cwd: ${process.cwd()}）。列挙が壊れているか、対象の *.sh / *.md が無い`,
    );
    return 2;
  }
  const findings = [];
  let scanned = 0;
  let unreadable = 0;
  for (const path of targets) {
    let content;
    try {
      content = read(path, "utf8");
    } catch {
      unreadable += 1;
      continue;
    }
    scanned += 1;
    findings.push(...lint(path, content));
  }
  // 読めなかったファイルは走査していない。**1 件でも読めなければ合格に倒さない**——
  // その中の違反は「無い」ではなく「見ていない」で、OK と印字した瞬間に見分けが付かなくなる。
  // 全件読めない場合は列挙かパスの解決が壊れているので、理由を分けて出す。
  const unread = unreadable > 0 ? `・${unreadable} ファイルは読めず未走査` : "";
  if (findings.length) {
    findings.sort((a, b) => a.path.localeCompare(b.path) || a.n - b.n);
    for (const f of findings) err(`${f.path}:${f.n}: ${f.msg}`);
    err(`\npagination-lint: ${scanned} ファイル走査・${findings.length} 件の指摘${unread}`);
    return 1;
  }
  if (scanned === 0) {
    err(
      `error: ${targets.length} 件の対象を 1 件も読めなかった（cwd: ${process.cwd()}）。列挙かパスの解決が壊れている`,
    );
    return 2;
  }
  if (unreadable > 0) {
    err(
      `error: ${targets.length} 件のうち ${unreadable} 件を読めず走査していない（cwd: ${process.cwd()}）。` +
        `残り ${scanned} 件に指摘は無いが、読めなかったぶんは検査していないので合格にしない`,
    );
    return 2;
  }
  log(`pagination-lint: OK（${scanned} ファイル走査）`);
  return 0;
}

// CLI として実行されたときだけ走らせる（テストから import しても main は動かない）。
// import.meta.url との比較は pathToFileURL で正規化する（相対パス/URL エスケープ差分での不一致を避ける）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
