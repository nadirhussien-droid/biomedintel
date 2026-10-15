// Builds a small, valid text-only PDF (one page per entry) for FICTIONAL demo
// and test documents. No external library: Helvetica text objects, a correct
// cross-reference table. Not used for anything a user uploads.
export function buildDemoPdf(pages: string[][], title = "Fictional demo document"): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, "?");
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add(""); // placeholder 1
  const pagesObj = add(""); // placeholder 2
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const info = add(`<< /Title (${esc(title)}) /Producer (BiomedIntel.ai demo builder) >>`);
  const kids: number[] = [];
  for (const lines of pages) {
    const ops = ["BT", "/F1 11 Tf", "14 TL", "56 780 Td"];
    for (const l of lines) ops.push(`(${esc(l)}) Tj T*`);
    ops.push("ET");
    const stream = ops.join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}
