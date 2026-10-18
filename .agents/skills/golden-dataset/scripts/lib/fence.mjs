// Markdown のコードフェンスを読む helper。フェンスの開閉はここで判定し、各スクリプトで書き直さない。
// このファイルは、同じ内容を複数の配布スキルが持つ。スキルの中で完結させるため、共有せずにコピーする。

/**
 * コードフェンスを開く記号を返す（フェンスを開く行でなければ null）。
 * CommonMark では、` ``` ` で開くフェンスの情報文字列にバッククォートを書けない。
 * そのため、行頭の ` ```x``` ` のようなインラインのコードではフェンスを開かない。
 * @param {string | undefined} line
 * @returns {string | null}
 */
function fenceOf(line) {
  if (line === undefined) return null;
  // 情報文字列に行区切りの文字（U+2028 など）があっても開くよう、`s` で `.` を全文字に一致させる。
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/su.exec(line);
  if (match === null) return null;
  if (match[1][0] === "`" && match[2].includes("`")) return null;
  return match[1];
}

/**
 * フェンスの状態を 1 行分進める。
 * 開いていなければ、fenceOf が記号を返す行で開く。
 * 開いていれば、開いた記号と同じ文字で同じ長さ以上の記号だけが続き、後ろが空白だけの行で閉じる。
 * CommonMark では閉じるフェンスに情報文字列を付けられないので、` ```bash ` のような行では閉じない。
 * @param {string | null} fence 開いているフェンスの記号（開いていなければ null）
 * @param {string | undefined} line
 * @returns {{ fence: string | null, marker: boolean }} 次の状態と、その行がフェンスを開いたか閉じたか
 */
function stepFence(fence, line) {
  if (fence === null) {
    const opened = fenceOf(line);
    return { fence: opened, marker: opened !== null };
  }
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(line ?? "");
  const closes = match !== null && match[1][0] === fence[0] && match[1].length >= fence.length;
  return { fence: closes ? null : fence, marker: closes };
}

/**
 * 末尾まで閉じないフェンスを、利用者に返す文にする（このファイルを持つスキルで同じ文にする）。
 * 閉じる行の条件は、stepFence の閉じる行の判定（字下げは半角の空白 3 個まで・開いた記号と同じ文字を同じ長さ以上・後ろは空白とタブだけ）をそのまま書く。
 * @param {number} line フェンスを開いた行の番号（1 始まり）
 * @returns {string}
 */
function unclosedFenceMessage(line) {
  return `${line} 行目で開いたコードフェンスが末尾まで閉じていない。フェンスの後ろの表を読めない。閉じる行は、字下げを半角の空白 3 個までにし、開いた記号と同じ文字を開いた数か、それより多く並べ、後ろには半角の空白とタブのほかに何も書かない`;
}

export { stepFence, unclosedFenceMessage };
