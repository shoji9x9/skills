// テストで pngjs の代わりに読み込ませる、PNG の読み書きの偽物。
//
// pngjs はこのリポジトリに入れない（利用者のプロジェクトにあるものをスキルが動的 import する）。
// そこで、スキルのスクリプトが使う範囲（`PNG` の `new PNG({ width, height })`・`width`・`height`・`data`・
// `PNG.sync.read`・`PNG.sync.write`）だけを、同じ形で持つ偽物を置く。
// 読み書きするのは RGBA 8 bit・インターレースなし・フィルタ 0 の PNG で、テストが encodePng で書いたものだけを読む。
// それ以外の形（パレット・16 bit・ほかのフィルタなど）と、PNG の署名が無い入力は例外にする。
// 子プロセスから `pngjs` として読み込ませる方法は `fake-pngjs-hooks.ts` にある。

import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** CRC-32（PNG のチャンクの検査値）の表。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

/** pngjs の PNG と同じ形の画像。data は長さ width * height * 4 の RGBA。 */
export class PNG {
  width: number;
  height: number;
  data: Buffer;

  constructor(opts: { width: number; height: number }) {
    this.width = opts.width;
    this.height = opts.height;
    this.data = Buffer.alloc(opts.width * opts.height * 4);
  }

  static sync = {
    read(buf: Uint8Array): PNG {
      return decodePng(buf);
    },
    write(png: { width: number; height: number; data: Uint8Array }): Buffer {
      return encodePng(png.width, png.height, png.data);
    },
  };
}

/** RGBA の画素を PNG のバイト列にする。 */
export function encodePng(width: number, height: number, data: Uint8Array): Buffer {
  if (data.length !== width * height * 4)
    throw new Error("data の長さが width * height * 4 でない");
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/** PNG のバイト列を RGBA の画像に戻す。 */
export function decodePng(input: Uint8Array): PNG {
  const buf = Buffer.from(input);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE))
    throw new Error("Invalid file signature");
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const body = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0)
        throw new Error("RGBA 8 bit・インターレースなし以外は読まない");
    } else if (type === "IDAT") {
      idat.push(body);
    }
    offset += 12 + length;
  }
  if (width === 0 || height === 0) throw new Error("IHDR が無い");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    if (filter !== 0) throw new Error(`フィルタ 0 以外は読まない: ${String(filter)}`);
    png.data.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return png;
}
