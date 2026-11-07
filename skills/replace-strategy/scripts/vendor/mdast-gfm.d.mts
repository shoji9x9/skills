// mdast-gfm.mjs の型。配布元（shoji9x9/skills）の check-vendor.ts --fix で作る。手で直さない。
export interface Point {
  line: number;
  column: number;
  offset?: number;
}
export interface Position {
  start: Point;
  end: Point;
}
export interface Node {
  type: string;
  position?: Position;
  value?: string;
  children?: Node[];
  data?: Record<string, unknown>;
}
/** 木を作る処理が handler に渡す文脈。stack は作りかけの節（一番上が最後）である。 */
export interface CompileContext {
  stack: Node[];
}
/** 木を作る処理に足す handler。キーは micromark のトークンの種類（codeFencedFence など）である。 */
export interface Extension {
  enter?: Record<string, (this: CompileContext, token: unknown) => void>;
  exit?: Record<string, (this: CompileContext, token: unknown) => void>;
}
/** Markdown を GFM（GitHub Flavored Markdown）の規則で読み、mdast の木を返す。 */
export function parseGfm(text: string, mdastExtensions?: Extension[]): Node;
