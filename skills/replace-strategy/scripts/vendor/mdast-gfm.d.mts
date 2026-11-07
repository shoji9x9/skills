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
}
/** Markdown を GFM（GitHub Flavored Markdown）の規則で読み、mdast の木を返す。 */
export function parseGfm(text: string): Node;
