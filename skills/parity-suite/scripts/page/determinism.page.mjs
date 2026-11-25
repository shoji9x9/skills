// 撮影の前に乱数を固定する処理のうち、ページで実行するコード。determinism.mjs が installSeededRandom を import し、
// page.addInitScript へそのまま渡す。
// addInitScript は関数のソースだけをページへ送るので、installSeededRandom は本体の外の名前を参照しない。
// 本体が呼ぶ関数はすべて本体の中に入れ子で書き、読むのは引数と素のグローバル（Math・crypto など）だけにする。
// このファイルは import を持たない。determinism.mjs と一緒に、その隣の page/ へコピーして使う。
// 乱数の列・差し替える関数・印を変えたら、determinism.mjs の VERSION とこのファイルの PAGE_VERSION を同じ値に上げる。

/** このファイルのバージョン。determinism.mjs の VERSION と同じ値にする。 */
export const PAGE_VERSION = "1";

/**
 * ページの乱数を seed 付きの関数に差し替える（ページへ渡す関数の本体）。
 * addInitScript は関数のソースだけをページへ送るので、本体の外の名前を参照しない。
 * 乱数の列は mulberry32 で作る。`crypto.getRandomValues` は元の関数で引数の型と長さを確かめてから、
 * 同じ配列を seed の列で上書きする（元と同じ例外を出すため）。
 * 差し替えたことと seed を、列挙されない `__parityRandomSeed` に残す（verifyDeterminism が読む）。
 * @param {number} seed
 */
export function installSeededRandom(seed) {
  let state = seed >>> 0;
  /** @returns {number} 32 ビットの符号なし整数 */
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  const random = () => next() / 4294967296;
  Math.random = random;
  /**
   * 差し替えた関数。verifyDeterminism が、撮る前もこの関数のままかを確かめる。
   * @type {{ random: () => number, getRandomValues: unknown, randomUUID: unknown }}
   */
  const installed = { random, getRandomValues: undefined, randomUUID: undefined };
  const cryptoObject = globalThis.crypto;
  if (cryptoObject && typeof cryptoObject.getRandomValues === "function") {
    const original = cryptoObject.getRandomValues.bind(cryptoObject);
    /**
     * @template {ArrayBufferView<ArrayBuffer>} T
     * @param {T} array
     * @returns {T}
     */
    const getRandomValues = (array) => {
      original(array);
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < bytes.length; i += 4) {
        const value = next();
        for (let k = 0; k < 4 && i + k < bytes.length; k += 1)
          bytes[i + k] = (value >>> (8 * k)) & 0xff;
      }
      return array;
    };
    Object.defineProperty(cryptoObject, "getRandomValues", {
      value: getRandomValues,
      configurable: true,
      writable: true,
    });
    installed.getRandomValues = getRandomValues;
    if (typeof cryptoObject.randomUUID === "function") {
      const randomUUID = () => {
        const bytes = getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      };
      Object.defineProperty(cryptoObject, "randomUUID", {
        value: randomUUID,
        configurable: true,
        writable: true,
      });
      installed.randomUUID = randomUUID;
    }
  }
  Object.defineProperty(globalThis, "__parityRandomSeed", { value: seed, configurable: true });
  Object.defineProperty(globalThis, "__parityRandomApis", { value: installed, configurable: true });
}
