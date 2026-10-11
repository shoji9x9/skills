// 配布スキルのスクリプトが実行時に利用者のプロジェクトから読み込む、このリポジトリの依存に無いモジュール。
// 型を any にしないよう、スクリプトが使う形だけを書く。使う欄を増やしたら、ここにも足す。
// import も export も持たない大域の宣言として読ませるため、`tsconfig.skills.json` は `moduleDetection: legacy` にしている。
declare module "pngjs" {
  export class PNG {
    constructor(options?: { width?: number; height?: number });
    width: number;
    height: number;
    data: Buffer;
    static sync: {
      read(buffer: Buffer): PNG;
      write(png: PNG): Buffer;
    };
  }
}

// `playwright` の型は、devDependencies の `@playwright/test` が同じものを公開している。
declare module "playwright" {
  export type { Locator, Page } from "@playwright/test";
}
