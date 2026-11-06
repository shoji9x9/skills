// CodeQL の検出を確かめるための probe（PR #920 で取り消す）。
import http from "node:http";

http
  .createServer((req, res) => {
    const code = new URL(req.url ?? "/", "http://localhost").searchParams.get("c") ?? "";
    res.end(String(eval(code)));
  })
  .listen(0);
