// セッションの開始時にエージェントが読み込む文書のバイト数を数える（Issue #1095）。
// check-cost-metrics.ts が週次の指標の 1 つとして呼び、合計が上限に近づいた週に候補として挙げる。
//
// 読み込む文書は、起点のファイル（CLAUDE.md など）と、そこから `@path` で取り込む文書を辿って決める。
// 取り込みの規則は Claude Code のドキュメント（https://code.claude.com/docs/en/memory「Import additional files」）に合わせる。
// - `@` は行頭に限らず、文の途中でも取り込みになる。直前は行頭か空白に限る（`"@x"` のように引用符で囲んだものは取り込まない）
// - コードスパンとフェンスで囲んだコードブロックの中は取り込まない
// - 相対パスは、取り込む側のファイルの場所を基準にする。`~/` で始まるパスはホームディレクトリを基準にする。パスの中の空白は `\ ` と書く
// - 取り込みは 4 段まで辿る。それより深い取り込みは読み込まれないので数えない
// 取り込み先のファイルが無いときの扱いはドキュメントに無い。0 バイトとして数えると合計を小さく見積もるので、例外にする。
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";

/** Claude Code が辿る取り込みの段数の上限。 */
const MAX_HOPS = 4;

const IMPORT = /(?:^|\s)@((?:[^\s\\]|\\ )+)/gu;

type MdNode = { type: string; value?: unknown; children?: MdNode[] };

/** 木の text ノードの値を集める。コード（inlineCode・code）と HTML は text ノードを持たないので、自然に外れる。 */
function textValues(node: MdNode, out: string[]): string[] {
  if (node.type === "text" && typeof node.value === "string") out.push(node.value);
  for (const child of node.children ?? []) textValues(child, out);
  return out;
}

/** Markdown の本文から、取り込むパス（書かれたままの形。`\ ` は空白に戻す）を出現順に返す。 */
export function importPaths(markdown: string): string[] {
  const tree: MdNode = fromMarkdown(markdown);
  const paths: string[] = [];
  for (const value of textValues(tree, [])) {
    for (const match of value.matchAll(IMPORT)) {
      const raw = match[1];
      if (raw !== undefined) paths.push(raw.replaceAll("\\ ", " "));
    }
  }
  return paths;
}

export type ContextFile = { path: string; bytes: number; hops: number };

/** 取り込むパスを絶対パスにする。`~/` はホームディレクトリ、相対パスは取り込む側のファイルの場所を基準にする。 */
function resolveImport(path: string, from: string): string {
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return isAbsolute(path) ? path : resolve(dirname(from), path);
}

/**
 * 起点のファイルから取り込みを辿り、読み込む文書を最初に現れた順で返す。path は root からの相対パスである。
 * 同じファイル（シンボリックリンクで指すものを含む）を 2 回取り込んでも 1 回だけ数え、hops は最も浅い段にする。
 * 深い段で先に見つけたファイルを浅い段でもう一度見つけたら、浅い段から取り込み先を辿り直す。
 * 起点か取り込み先が無いときは例外にする。
 */
export function sessionContextFiles(root: string, entries: readonly string[]): ContextFile[] {
  const files: ContextFile[] = [];
  const seen = new Map<string, ContextFile>();
  const visit = (absolute: string, hops: number, from: string): void => {
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      throw new Error(`${from} が読み込むファイルが無い: ${relative(root, absolute)}`);
    }
    const real = realpathSync(absolute);
    const known = seen.get(real);
    if (known !== undefined && known.hops <= hops) return;
    const text = readFileSync(absolute, "utf8");
    if (known === undefined) {
      const file = { path: relative(root, absolute), bytes: Buffer.byteLength(text), hops };
      seen.set(real, file);
      files.push(file);
    } else {
      known.hops = hops;
    }
    if (hops >= MAX_HOPS) return;
    for (const path of importPaths(text)) {
      visit(resolveImport(path, absolute), hops + 1, relative(root, absolute));
    }
  };
  for (const entry of entries) visit(join(root, entry), 0, "session_context.entries");
  return files;
}
