// 検査をする CLI の main を、メモリ上のファイルで実行するテストのヘルパー。
import { parseJsonAs } from "../parse-as.ts";

/** main が受け取る入出力。 */
export type MemoryIo = {
  cwd: string;
  readFile: (path: string) => string;
  write: (s: string) => void;
  writeErr: (s: string) => void;
};

/**
 * main をメモリ上のファイルで実行し、終了コード・stdout の JSON・stderr を返す。
 * cwd は /w に固定し、files に無いパスの読み取りは ENOENT にする。stdout が空なら result は null。
 */
export function runInMemory<Result>(
  main: (argv: string[], io: MemoryIo) => number,
  argv: string[],
  files: Record<string, string>,
) {
  let output = "";
  let stderr = "";
  const code = main(argv, {
    cwd: "/w",
    readFile: (path) => {
      if (!(path in files)) throw new Error("ENOENT");
      return files[path];
    },
    write: (s) => {
      output += s;
    },
    writeErr: (s) => {
      stderr += s;
    },
  });
  return { code, stderr, result: output === "" ? null : parseJsonAs<Result>(output) };
}
