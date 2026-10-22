// aggregate.test.ts のヘルパー。

/** HTML の heading から始まる節（次の </section> まで）にある表の行を、セルの中身の配列にして返す。 */
export function sectionTableRows(html: string, heading: string): string[][] {
  const start = html.indexOf(heading);
  const section = html.slice(start, html.indexOf("</section>", start));
  return [...section.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) =>
    [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => c[1]),
  );
}
