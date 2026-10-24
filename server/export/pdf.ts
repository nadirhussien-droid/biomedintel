// PDF rendering of an ExportDoc: an A4 report a hospital can print or attach.
//
// Header: the organisation's optional logo and name, the report title, and the
// filters used. Tables wrap long text, repeat their header row on every page
// and switch to landscape when they have many columns. Every page carries
// "Page x of y" and a footer saying who exported it, when, and that it holds
// equipment records only.
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { cellText, friendlyTime, type Cell, type ChartSpec, type ExportDoc } from "./document";

/** Very long tables are cut in the PDF (with a note); Excel and CSV carry every row. */
export const PDF_MAX_ROWS = 2000;

const NAVY = "#102D46";
const TEAL = "#55D6C2";
const ZEBRA = "#F4F7FA";
const LINE = "#9AA9B8";

const FONT_DIR = path.join(process.cwd(), "node_modules", "dejavu-fonts-ttf", "ttf");
const FONT_REGULAR = path.join(FONT_DIR, "DejaVuSans.ttf");
const FONT_BOLD = path.join(FONT_DIR, "DejaVuSans-Bold.ttf");

function display(c: Cell): string {
  if (c instanceof Date) return `${c.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  return cellText(c);
}

export async function toPdf(
  doc: ExportDoc,
  opts: { exportedBy: string; exportedAt: Date; logo?: { content: Uint8Array } | null },
): Promise<Buffer> {
  const wide = Math.max(0, ...doc.sections.map((s) => s.columns?.length ?? 0)) > 6;
  const pdf = new PDFDocument({
    size: "A4",
    layout: wide ? "landscape" : "portrait",
    margins: { top: 40, bottom: 48, left: 36, right: 36 },
    bufferPages: true,
    info: { Title: `${doc.title} - ${doc.organization}`, Author: "BiomedIntel.ai", Creator: "BiomedIntel.ai" },
  });
  const chunks: Buffer[] = [];
  pdf.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });

  // Unicode font (names, units such as Ω, dashes). Falls back to the built-in font if missing.
  let regular = "Helvetica";
  let bold = "Helvetica-Bold";
  if (fs.existsSync(FONT_REGULAR) && fs.existsSync(FONT_BOLD)) {
    pdf.registerFont("Body", FONT_REGULAR);
    pdf.registerFont("Body-Bold", FONT_BOLD);
    regular = "Body";
    bold = "Body-Bold";
  }
  const safe = (s: string) => (regular === "Helvetica" ? s.replace(/[^\x20-\x7e\xa0-\xff]/g, "?") : s);

  const left = pdf.page.margins.left;
  const width = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
  const bottom = () => pdf.page.height - pdf.page.margins.bottom;

  // ── Header ──
  let y = pdf.page.margins.top;
  let textX = left;
  if (opts.logo) {
    try {
      pdf.image(Buffer.from(opts.logo.content), left, y, { fit: [113, 40] });
      textX = left + 125;
    } catch {
      // An unreadable logo never stops the report.
    }
  }
  pdf
    .font(bold)
    .fontSize(15)
    .fillColor(NAVY)
    .text(safe(doc.organization), textX, y, { width: width - (textX - left) });
  pdf
    .font(regular)
    .fontSize(11)
    .fillColor("black")
    .text(safe(doc.title), textX, pdf.y + 2, {
      width: width - (textX - left),
    });
  y = Math.max(pdf.y, y + 42) + 8;
  pdf
    .moveTo(left, y)
    .lineTo(left + width, y)
    .lineWidth(1.5)
    .strokeColor(NAVY)
    .stroke();
  y += 6;
  const meta = doc.meta.filter(([k]) => k !== "Report" && k !== "Organisation");
  pdf.fontSize(8);
  for (const [k, v] of meta) {
    pdf
      .font(bold)
      .fillColor("black")
      .text(safe(`${k.replace(" (UTC)", "")}: `), left, y, { continued: true, width });
    pdf.font(regular).text(safe(friendlyTime(v)), { width });
    y = pdf.y + 1;
  }
  y += 6;

  // ── Tables ──
  const drawTable = (columns: string[], allRows: Cell[][]) => {
    const rows = allRows.slice(0, PDF_MAX_ROWS);
    const fontSize = columns.length > 9 ? 6.5 : 7.5;
    pdf.fontSize(fontSize);
    // Column widths, measured in the real font: never narrower than the longest single word
    // (so words are not split), then the spare width goes to columns with longer text.
    const pad = 3;
    const sample = rows.slice(0, 300);
    const wordW = (t: string, font: string) => {
      pdf.font(font).fontSize(fontSize);
      return Math.max(
        0,
        ...safe(t)
          .split(/\s+/)
          .map((w) => pdf.widthOfString(w)),
      );
    };
    const minW = columns.map((c, i) =>
      Math.min(
        width * 0.3,
        Math.max(wordW(c, bold), ...sample.map((r) => wordW(display(r[i]), regular))) + pad * 2 + 1,
      ),
    );
    const wantW = columns.map((c, i) => {
      pdf.font(regular).fontSize(fontSize);
      const lens = sample.map((r) => pdf.widthOfString(safe(display(r[i])))).sort((x, y) => x - y);
      const typical = lens.length ? lens[Math.floor(lens.length * 0.9)] : 0;
      return Math.max(minW[i], Math.min(width * 0.4, typical + pad * 2 + 1));
    });
    const minSum = minW.reduce((x, y) => x + y, 0);
    let colW: number[];
    if (minSum >= width) {
      colW = minW.map((w) => (w * width) / minSum); // too many columns: shrink evenly
    } else {
      const extra = width - minSum;
      const need = wantW.map((w, i) => w - minW[i]);
      const needSum = need.reduce((x, y) => x + y, 0);
      if (needSum >= extra) colW = minW.map((w, i) => w + (needSum ? (extra * need[i]) / needSum : 0));
      else {
        const wantSum = wantW.reduce((x, y) => x + y, 0);
        colW = wantW.map((w) => w + ((extra - needSum) * w) / wantSum);
      }
    }
    // A column is right-aligned when every filled cell is a number.
    const numericCol = columns.map((_, i) => {
      const filled = rows.filter((r) => r[i] !== null && r[i] !== undefined && r[i] !== "");
      return filled.length > 0 && filled.every((r) => typeof r[i] === "number");
    });

    const heightOf = (texts: string[], font: string) => {
      pdf.font(font).fontSize(fontSize);
      return (
        Math.max(...texts.map((t, i) => pdf.heightOfString(safe(t) || " ", { width: colW[i] - pad * 2 }))) + pad * 2
      );
    };
    const drawRow = (texts: string[], opt: { header?: boolean; zebra?: boolean; numeric?: boolean[] }) => {
      const font = opt.header ? bold : regular;
      const h = heightOf(texts, font);
      if (y + h > bottom()) {
        pdf.addPage();
        y = pdf.page.margins.top;
        if (!opt.header) drawRow(columns, { header: true, numeric: numericCol });
      }
      if (opt.header) pdf.rect(left, y, width, h).fill(NAVY);
      else if (opt.zebra) pdf.rect(left, y, width, h).fill(ZEBRA);
      let x = left;
      texts.forEach((t, i) => {
        pdf
          .font(font)
          .fontSize(fontSize)
          .fillColor(opt.header ? "white" : "black")
          .text(safe(t), x + pad, y + pad, {
            width: colW[i] - pad * 2,
            align: opt.numeric?.[i] ? "right" : "left",
          });
        x += colW[i];
      });
      y += h;
      pdf
        .moveTo(left, y)
        .lineTo(left + width, y)
        .lineWidth(0.3)
        .strokeColor(LINE)
        .stroke();
    };

    if (y + 40 > bottom()) {
      pdf.addPage();
      y = pdf.page.margins.top;
    }
    drawRow(columns, { header: true, numeric: numericCol });
    rows.forEach((r, i) =>
      drawRow(
        columns.map((_, c) => display(r[c])),
        { zebra: i % 2 === 1, numeric: numericCol },
      ),
    );
    if (!rows.length) {
      pdf
        .font(regular)
        .fontSize(8)
        .fillColor("#555555")
        .text("No rows for these filters.", left, y + 4, { width });
      y = pdf.y;
    }
    if (allRows.length > rows.length) {
      pdf
        .font(bold)
        .fontSize(8)
        .fillColor("black")
        .text(
          `Showing the first ${PDF_MAX_ROWS.toLocaleString("en-GB")} of ${allRows.length.toLocaleString("en-GB")} rows. Export to Excel for the full list.`,
          left,
          y + 4,
          { width },
        );
      y = pdf.y;
    }
    y += 10;
  };

  // ── Charts: donuts and bars drawn as vectors, two to a row ──
  const drawCharts = (charts: ChartSpec[]) => {
    const gap = 16;
    const cw = (width - gap) / 2;
    const ch = 118;
    for (let i = 0; i < charts.length; i += 2) {
      if (y + ch + 8 > bottom()) {
        pdf.addPage();
        y = pdf.page.margins.top;
      }
      charts.slice(i, i + 2).forEach((c, j) => {
        const x0 = left + j * (cw + gap);
        pdf.roundedRect(x0, y, cw, ch, 4).lineWidth(0.6).strokeColor(LINE).stroke();
        pdf
          .font(bold)
          .fontSize(8.5)
          .fillColor(NAVY)
          .text(safe(c.title), x0 + 8, y + 7, { width: cw - 16, lineBreak: false });
        const top = y + 24;
        const total = c.items.reduce((a, it) => a + it.value, 0);
        if (c.kind === "donut") {
          const r = 38;
          const cx = x0 + 12 + r;
          const cy = top + r + 2;
          if (total <= 0) pdf.circle(cx, cy, r).fill("#E3E9EF");
          else {
            let a0 = -Math.PI / 2;
            for (const it of c.items.filter((it) => it.value > 0)) {
              if (it.value === total) {
                pdf.circle(cx, cy, r).fill(it.color);
                break;
              }
              const a1 = a0 + (it.value / total) * Math.PI * 2;
              const p = (a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
              pdf
                .path(`M ${cx} ${cy} L ${p(a0)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)} Z`)
                .fill(it.color);
              a0 = a1;
            }
          }
          pdf.circle(cx, cy, r * 0.62).fill("white");
          if (c.centre) {
            pdf
              .font(bold)
              .fontSize(14)
              .fillColor(NAVY)
              .text(safe(c.centre.value), cx - r * 0.6, cy - 9, { width: r * 1.2, align: "center", lineBreak: false });
            pdf
              .font(regular)
              .fontSize(6)
              .fillColor("#555555")
              .text(safe(c.centre.label), cx - r * 0.6, cy + 7, { width: r * 1.2, align: "center", lineBreak: false });
          }
          let ly = top + 14;
          const lx = cx + r + 14;
          for (const it of c.items) {
            pdf.rect(lx, ly + 1, 8, 8).fill(it.color);
            const pct = total > 0 ? ` (${Math.round((it.value / total) * 100)}%)` : "";
            pdf
              .font(bold)
              .fontSize(7.5)
              .fillColor("black")
              .text(safe(`${it.value}${pct}`), lx + 13, ly, { width: x0 + cw - lx - 18, lineBreak: false });
            pdf
              .font(regular)
              .fontSize(7)
              .fillColor("#444444")
              .text(safe(it.label), lx + 13, ly + 9, { width: x0 + cw - lx - 18, lineBreak: false });
            ly += 26;
          }
        } else {
          const max = Math.max(1, ...c.items.map((it) => it.value));
          const labelW = 112;
          const barX = x0 + 8 + labelW;
          const barMax = cw - 16 - labelW - 24;
          let by = top + 2;
          for (const it of c.items) {
            pdf
              .font(regular)
              .fontSize(6.8)
              .fillColor("#333333")
              .text(safe(it.label), x0 + 8, by + 1, { width: labelW - 4, lineBreak: false, ellipsis: true });
            pdf.rect(barX, by, barMax, 9).fill("#EEF2F6");
            if (it.value > 0) pdf.rect(barX, by, Math.max(2, (it.value / max) * barMax), 9).fill(it.color);
            pdf
              .font(bold)
              .fontSize(7.5)
              .fillColor("black")
              .text(String(it.value), barX + barMax + 4, by + 1, { width: 20, lineBreak: false });
            by += 17;
          }
        }
      });
      y += ch + 10;
    }
  };

  for (const s of doc.sections) {
    if (s.title) {
      if (y + 40 > bottom()) {
        pdf.addPage();
        y = pdf.page.margins.top;
      }
      pdf.font(bold).fontSize(10).fillColor(NAVY).text(safe(s.title), left, y, { width });
      y = pdf.y + 3;
    }
    if (s.note) {
      pdf.font(regular).fontSize(8).fillColor("#333333").text(safe(s.note), left, y, { width });
      y = pdf.y + 6;
    }
    if (s.charts?.length) drawCharts(s.charts);
    if (s.columns) drawTable(s.columns, s.rows ?? []);
  }

  // ── Footer on every page ──
  const range = pdf.bufferedPageRange();
  const when = `${opts.exportedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  for (let i = 0; i < range.count; i++) {
    pdf.switchToPage(range.start + i);
    const savedBottom = pdf.page.margins.bottom;
    pdf.page.margins.bottom = 0; // writing in the margin must not add a page
    const fy = pdf.page.height - 32;
    pdf
      .moveTo(left, fy - 4)
      .lineTo(left + width, fy - 4)
      .lineWidth(0.5)
      .strokeColor(TEAL)
      .stroke();
    pdf
      .font(regular)
      .fontSize(7)
      .fillColor("#444444")
      .text(
        safe(
          `Exported from BiomedIntel.ai by ${opts.exportedBy} on ${when}. Equipment records only, no patient information.`,
        ),
        left,
        fy,
        { width: width - 80, lineBreak: false },
      );
    pdf.text(`Page ${i + 1} of ${range.count}`, left + width - 80, fy, { width: 80, align: "right", lineBreak: false });
    pdf.page.margins.bottom = savedBottom;
  }
  pdf.end();
  return done;
}
