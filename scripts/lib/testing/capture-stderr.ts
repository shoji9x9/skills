// CLI の main を同じプロセスで呼び、終了コードと stderr に書いた内容を受け取る（テスト用）。
import { vi } from "vitest";

/** main を呼ぶ間だけ process.stderr.write を差し替え、書いた内容を集める。 */
export async function runCapturingStderr(
  main: (argv: string[]) => number | Promise<number>,
  argv: string[],
) {
  const written: string[] = [];
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  try {
    const code = await main(argv);
    return { code, stderr: written.join("") };
  } finally {
    stderr.mockRestore();
  }
}
