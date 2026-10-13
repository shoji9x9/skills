// 利用者のプロジェクトにある pngjs を読み込む。

/** @typedef {{ width:number, height:number, data:Uint8Array }} PngImage */

/**
 * pngjs を動的 import する（未導入なら null）。
 *
 * @returns {Promise<{ new (opts:{ width:number, height:number }): PngImage,
 *   sync: { read(buf: Uint8Array): PngImage, write(png: PngImage): Uint8Array } } | null>}
 */
async function loadPng() {
  try {
    const mod = await import("pngjs");
    return mod.PNG;
  } catch {
    return null;
  }
}

export { loadPng };
