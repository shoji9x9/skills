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
//   引数なし: リポジトリ内の *.sh と *.md を全件走査（node_modules / .git を除外）。

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === ".agents" || name === ".claude")
      continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else if (name.endsWith(".sh") || name.endsWith(".md")) out.push(p);
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const targets = args.length ? args : listFiles(".");
  const findings = [];
  for (const path of targets) {
    if (!(path.endsWith(".sh") || path.endsWith(".md"))) continue;
    let content;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    findings.push(...lint(path, content));
  }
  if (findings.length) {
    findings.sort((a, b) => a.path.localeCompare(b.path) || a.n - b.n);
    for (const f of findings) console.error(`${f.path}:${f.n}: ${f.msg}`);
    console.error(`\npagination-lint: ${findings.length} 件の指摘`);
    process.exit(1);
  }
  console.log("pagination-lint: OK");
}

// CLI として実行されたときだけ走らせる（テストから import しても main は動かない）。
// import.meta.url との比較は pathToFileURL で正規化する（相対パス/URL エスケープ差分での不一致を避ける）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
