// Document checks, text extraction and passage splitting (Stage 9).
//
// Everything here treats the file as UNTRUSTED:
//   • the type is decided from the file's own bytes, never from its name or
//     the browser's claim;
//   • PDFs are read with Mozilla's pdf.js for TEXT only (no rendering, no
//     fonts, no forms, no scripts), with a page limit and a time limit;
//   • the extracted text is stored as plain text and only ever shown as text.
import "server-only";
import { createHash } from "node:crypto";
import { ALLOWED_MIME, MAX_DOCUMENT_BYTES, type AllowedMime } from "@/lib/validation/knowledge";

export const MAX_PAGES = 2000;
export const MAX_CHUNKS = 4000;
const EXTRACT_TIMEOUT_MS = 60_000;
const PASSAGE_WORDS = 220;
const OVERLAP_WORDS = 30;

export class FileRejected extends Error {}

export type CheckedFile = { mime: AllowedMime; filename: string; sizeBytes: number; sha256: string; bytes: Uint8Array };

/** A safe display filename: no path, no control characters, at most 200 characters. */
export function safeFilename(name: string, mime: AllowedMime): string {
  const base = (name.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "").trim() || "document";
  const ext = mime === "application/pdf" ? ".pdf" : mime === "text/markdown" ? ".md" : ".txt";
  const stem = base.replace(/\.[A-Za-z0-9]{1,8}$/, "").slice(0, 180) || "document";
  return `${stem}${ext}`;
}

function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Checks size and content type. Throws FileRejected with a message safe to show. */
export function checkFile(name: string, bytes: Uint8Array): CheckedFile {
  if (bytes.byteLength === 0) throw new FileRejected("The file is empty.");
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new FileRejected("Documents must be 20 MB or smaller.");
  const head = Buffer.from(bytes.subarray(0, 5)).toString("latin1");
  let mime: AllowedMime;
  if (head === "%PDF-") mime = "application/pdf";
  else if (isUtf8Text(bytes)) mime = /\.(md|markdown)$/i.test(name) ? "text/markdown" : "text/plain";
  else throw new FileRejected("Only PDF, plain text (.txt) and Markdown (.md) documents are accepted.");
  if (!(ALLOWED_MIME as readonly string[]).includes(mime)) throw new FileRejected("Unsupported document type.");
  return {
    mime,
    filename: safeFilename(name, mime),
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes,
  };
}

/** Keeps letters, digits, punctuation and line breaks; drops control characters. */
export function cleanText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ue000-\uf8ff]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type Page = { page: number | null; heading: string | null; text: string };
export type Extraction = {
  status: "INDEXED" | "NO_TEXT" | "FAILED";
  pageCount: number | null;
  pages: Page[];
  note: string | null;
};

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function extractPdf(bytes: Uint8Array): Promise<Extraction> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes), // pdf.js takes ownership of the buffer
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  try {
    const doc = await withTimeout(task.promise, EXTRACT_TIMEOUT_MS);
    const pageCount = doc.numPages;
    if (pageCount > MAX_PAGES) {
      return {
        status: "FAILED",
        pageCount,
        pages: [],
        note: `The PDF has ${pageCount} pages; the limit is ${MAX_PAGES}.`,
      };
    }
    const pages: Page[] = [];
    const started = Date.now();
    for (let i = 1; i <= pageCount; i++) {
      if (Date.now() - started > EXTRACT_TIMEOUT_MS) {
        return { status: "FAILED", pageCount, pages: [], note: "Reading the PDF took too long." };
      }
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "")).join("");
      const cleaned = cleanText(text);
      if (cleaned) pages.push({ page: i, heading: null, text: cleaned });
      page.cleanup();
    }
    if (!pages.length) {
      return {
        status: "NO_TEXT",
        pageCount,
        pages: [],
        note: "No text layer found (for example a scanned document). OCR is not available, so it cannot be searched.",
      };
    }
    return { status: "INDEXED", pageCount, pages, note: null };
  } catch (error) {
    const name = (error as { name?: string })?.name;
    const note =
      name === "PasswordException"
        ? "The PDF is password-protected."
        : (error as Error)?.message === "timeout"
          ? "Reading the PDF took too long."
          : "The PDF could not be read (damaged or unsupported).";
    return { status: "FAILED", pageCount: null, pages: [], note };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

function extractText(bytes: Uint8Array, mime: AllowedMime): Extraction {
  const raw = cleanText(new TextDecoder("utf-8").decode(bytes));
  if (!raw) return { status: "NO_TEXT", pageCount: null, pages: [], note: "The document has no text." };
  if (mime !== "text/markdown")
    return { status: "INDEXED", pageCount: null, pages: [{ page: null, heading: null, text: raw }], note: null };
  // Markdown: keep each section with its heading.
  const pages: Page[] = [];
  let heading: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    const t = buf.join("\n").trim();
    if (t) pages.push({ page: null, heading, text: t });
    buf = [];
  };
  for (const line of raw.split("\n")) {
    const m = /^#{1,6}\s+(.{1,200})$/.exec(line);
    if (m) {
      flush();
      heading = m[1].trim();
    } else buf.push(line);
  }
  flush();
  return { status: pages.length ? "INDEXED" : "NO_TEXT", pageCount: null, pages, note: null };
}

export async function extract(file: { bytes: Uint8Array; mime: AllowedMime }): Promise<Extraction> {
  return file.mime === "application/pdf" ? extractPdf(file.bytes) : extractText(file.bytes, file.mime);
}

export type Passage = {
  chunkNo: number;
  pageFrom: number | null;
  pageTo: number | null;
  heading: string | null;
  content: string;
};

/**
 * Splits each page (or Markdown section) into passages of about 220 words
 * with a small overlap. A passage never spans two pages, so every citation
 * points at exactly one page.
 */
export function toPassages(pages: Page[]): Passage[] {
  const out: Passage[] = [];
  for (const p of pages) {
    const words = p.text.split(/\s+/).filter(Boolean);
    for (let start = 0; start < words.length; start += PASSAGE_WORDS - OVERLAP_WORDS) {
      const slice = words.slice(start, start + PASSAGE_WORDS).join(" ");
      out.push({
        chunkNo: out.length + 1,
        pageFrom: p.page,
        pageTo: p.page,
        heading: p.heading,
        content: slice.slice(0, 20_000),
      });
      if (out.length >= MAX_CHUNKS) return out;
      if (start + PASSAGE_WORDS >= words.length) break;
    }
  }
  return out;
}

/**
 * Stage 10 fix: a note when the passage limit cut a long document short, so
 * nobody assumes the whole file is searchable (previously silent). Null when
 * everything was indexed.
 */
export function passageLimitNote(passages: Passage[]): string | null {
  if (passages.length < MAX_CHUNKS) return null;
  const last = passages[passages.length - 1]?.pageTo ?? null;
  return (
    `Only ${last ? `pages 1–${last}` : "the first part"} could be made searchable (limit: ${MAX_CHUNKS} passages). ` +
    "The rest of the file is stored and can be opened, but it is not searched and IntellAssist does not use it. " +
    "Split the document into smaller files to make all of it searchable."
  );
}
