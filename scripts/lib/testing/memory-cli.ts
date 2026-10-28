// 検査をする CLI の main を、メモリ上のファイルで実行するテストのヘルパー。
import { parseJsonAs } from "../parse-as.ts";

/** main が受け取る入出力。 */
export type MemoryIo = {
  cwd: string;
  readFile: (path: string) => string;
  write: (s: string) => void;
  writeErr?: (s: string) => void;
};

/**
 * main をメモリ上のファイルで実行し、終了コードと stdout の JSON を返す。
 * cwd は /w に固定し、files に無いパスの読み取りは ENOENT にする。stdout が空なら result は null。
 * captureStderr のときだけ stderr を返り値に集める。そうでなければ main のデフォルト（process.stderr）に出し、失敗の理由をテストの出力に残す。
 */
export function runInMemory<Result>(
  main: (argv: string[], io: MemoryIo) => number,
  argv: string[],
  options: { files: Record<string, string>; captureStderr: true },
): { code: number; stderr: string; result: Result | null };
export function runInMemory<Result>(
  main: (argv: string[], io: MemoryIo) => number,
  argv: string[],
  options: { files: Record<string, string>; captureStderr?: false },
): { code: number; result: Result | null };
export function runInMemory<Result>(
  main: (argv: string[], io: MemoryIo) => number,
  argv: string[],
  { files, captureStderr = false }: { files: Record<string, string>; captureStderr?: boolean },
) {
  let output = "";
  let stderr = "";
  const io: MemoryIo = {
    cwd: "/w",
    readFile: (path) => {
      if (!Object.hasOwn(files, path)) throw new Error("ENOENT");
      return files[path];
    },
    write: (s) => {
      output += s;
    },
  };
  if (captureStderr) {
    io.writeErr = (s) => {
      stderr += s;
    };
  }
  const code = main(argv, io);
  const result = output === "" ? null : parseJsonAs<Result>(output);
  // 集めていない stderr は返さない。空の文字列で返すと、出たエラーを確かめないまま空として扱われる
  return captureStderr ? { code, stderr, result } : { code, result };
}
