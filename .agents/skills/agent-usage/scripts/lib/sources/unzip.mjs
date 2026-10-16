// zip（GitHub Actions の artifact）を展開する。外部のコマンドやパッケージを使わず、中央ディレクトリを読んで
// 無圧縮（0）と deflate（8）の項目だけを取り出す。それ以外の圧縮方式・暗号化・ZIP64 はエラーにする。

import { inflateRawSync } from "node:zlib";

/**
 * @param {Buffer} buf
 * @returns {Map<string, Buffer>} ファイル名 → 中身（ディレクトリの項目は除く）
 */
export function unzip(buf) {
  const eocdSig = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i -= 1) {
    if (buf.readUInt32LE(i) === eocdSig) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip の終わりの記録が無い");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || off === 0xffffffff) throw new Error("ZIP64 には対応していない");
  /** @type {Map<string, Buffer>} */
  const out = new Map();
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error("zip の中央ディレクトリが不正");
    const flags = buf.readUInt16LE(off + 8);
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString("utf8");
    off += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (flags & 1) throw new Error(`暗号化された項目には対応していない: ${name}`);
    if (buf.readUInt32LE(local) !== 0x04034b50)
      throw new Error(`zip のローカルヘッダが不正: ${name}`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compSize);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data));
    else throw new Error(`対応していない圧縮方式 ${method}: ${name}`);
  }
  return out;
}
