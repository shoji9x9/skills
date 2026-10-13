// パスを実パスに解決する helper。

import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/**
 * 実在する最も深い祖先まで `realpathSync` で解いてから、残りの区間を継ぎ足して実パスを組む。
 *
 * **まだ存在しないパスでも実パスで判定できるようにする**。存在しないことを理由に
 * 文字列のまま扱うと、途中のディレクトリがシンボリックリンクでも閉じ込めを確かめられない。
 * ENOENT 以外（ELOOP・EACCES など）は「解けなかった」であって「外でない」ではないので、
 * 合格として扱わず null を返す。
 * @param {string} p
 * @returns {string | null}
 */
function realPathOf(p) {
  let current = resolve(p);
  /** @type {string[]} */
  const tail = [];
  for (;;) {
    try {
      const real = realpathSync(current);
      return tail.length === 0 ? real : join(real, ...tail);
    } catch (e) {
      const code = e instanceof Error && "code" in e ? e.code : undefined;
      if (code !== "ENOENT") return null;
    }
    const parent = dirname(current);
    // ルートまで遡っても解けない（存在しないドライブ等）。文字列のまま通さない。
    if (parent === current) return null;
    tail.unshift(basename(current));
    current = parent;
  }
}

export { realPathOf };
