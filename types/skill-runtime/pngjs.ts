// 配布スキルのスクリプトが実行時に利用者のプロジェクトから読み込む `pngjs` の型（このリポジトリの依存に無い）。
// `tsconfig.skills.json` の `paths` がこのファイルへ解決する。型を any にしないよう、スクリプトが使う形だけを書く。
// 使う欄を増やしたら、ここにも足す。
export declare class PNG {
  constructor(options?: { width?: number; height?: number });
  width: number;
  height: number;
  data: Buffer;
  static sync: {
    read(buffer: Buffer): PNG;
    write(png: PNG): Buffer;
  };
}
