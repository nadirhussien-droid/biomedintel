// Code 128 barcodes, scanned-content parsing, label rendering and other Stage 4 helpers.
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  BarcodeFormat,
  BinaryBitmap,
  Code128Reader,
  DecodeHintType,
  HybridBinarizer,
  RGBLuminanceSource,
} from "@zxing/library";
import { code128, moduleWidthMm, QUIET_ZONE, type Barcode } from "@/server/barcode";
import { parseAssetCode } from "@/lib/asset-code";
import { safeNextPath } from "@/lib/safe-next";
import { csvCell } from "@/server/services/assets";
import { assetQuerySchema, createAssetSchema } from "@/lib/validation/assets";
import { BarcodeSvg } from "@/components/assets/barcode-svg";

/** Rasterises a barcode (as printed) and decodes it with ZXing — the library the camera scanner uses. */
function decode(barcode: Barcode, scale = 3, height = 40): string {
  const width = barcode.modules * scale;
  const luminance = new Uint8ClampedArray(width * height).fill(255);
  for (const [x, w] of barcode.bars) {
    for (let px = x * scale; px < (x + w) * scale; px++) {
      for (let y = 0; y < height; y++) luminance[y * width + px] = 0;
    }
  }
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminance, width, height)));
  const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]]]);
  return new Code128Reader().decode(bitmap, hints).getText();
}

describe("Code 128 barcodes", () => {
  it("decode back to exactly the asset ID, for typical asset ID shapes", () => {
    for (const tag of ["INF-0412", "BMI-000123", "VEN-0001", "A1", "RGH/ICU/0007", "DEF.2026.15"]) {
      expect(decode(code128(tag))).toBe(tag);
    }
  });

  it("are still readable at a small print size (1 pixel per bar module)", () => {
    expect(decode(code128("INF-0412"), 1)).toBe("INF-0412");
  });

  it("are stable: the same asset ID always gives the same bars", () => {
    expect(code128("INF-0412")).toEqual(code128("INF-0412"));
    expect(code128("INF-0412")).not.toEqual(code128("INF-0413"));
  });

  it("include white quiet zones of at least 10 modules on both sides", () => {
    const b = code128("INF-0412");
    expect(b.bars[0][0]).toBe(QUIET_ZONE);
    const [lastX, lastW] = b.bars[b.bars.length - 1];
    expect(b.modules - (lastX + lastW)).toBe(QUIET_ZONE);
  });

  it("contain only the asset ID: no database id, session, key, URL or other details", () => {
    const payload = decode(code128("INF-0412"));
    expect(payload).toBe("INF-0412");
    expect(payload).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-|https?:|session|token|key|serial|patient/i);
  });

  it("refuse values that are not valid asset IDs", () => {
    for (const bad of ["", "inf-0412", "INF 0412", "https://x.example", "X".repeat(41), "INF-0412\n"]) {
      expect(() => code128(bad)).toThrow();
    }
  });

  it("have bars wide enough for ordinary scanners on both label sizes", () => {
    // Typical asset IDs on a 63.5 mm (A4 sheet) or 62 mm (label printer) label.
    expect(moduleWidthMm(code128("INF-0412"), 58)).toBeGreaterThan(0.25);
    expect(moduleWidthMm(code128("BMI-000123"), 58)).toBeGreaterThan(0.25);
    // A 40-character ID is too dense; the label page warns about it.
    expect(moduleWidthMm(code128("ABCDEFGHIJKLMNOPQRSTUVWXYZ-ABCDEFGHIJKLM"), 58)).toBeLessThan(0.25);
  });

  it("render as a printable SVG without injected markup", () => {
    const html = renderToStaticMarkup(
      createElement(BarcodeSvg, { barcode: code128("INF-0412"), label: "Code 128 barcode for INF-0412" }),
    );
    expect(html).toMatch(/^<svg[^>]+viewBox="0 0 \d+ 40"[^>]+aria-label="Code 128 barcode for INF-0412"/);
    expect(html).toContain('fill="#000000"');
    expect(html).not.toContain("<script");
  });
});

describe("scanned content is untrusted", () => {
  it("accepts asset IDs (any case) and plain inventory numbers, as handheld scanners send them", () => {
    expect(parseAssetCode("INF-0412\r\n")).toEqual({ kind: "code", code: "INF-0412", isAssetTag: true });
    expect(parseAssetCode("  inf-0412 ")).toEqual({ kind: "code", code: "inf-0412", isAssetTag: true });
    expect(parseAssetCode("RGH 2019 004512")).toEqual({ kind: "code", code: "RGH 2019 004512", isAssetTag: false });
  });

  it("refuses links, scripts and look-alikes so a barcode can never navigate anywhere", () => {
    for (const evil of [
      "https://evil.example/assets/1",
      "http://localhost:3000/admin",
      "javascript:alert(document.cookie)",
      "data:text/html,<script>alert(1)</script>",
      "//evil.example",
      "www.evil.example",
      "mailto:a@b.example",
    ]) {
      expect(parseAssetCode(evil).kind).toBe("invalid");
    }
  });

  it("rejects empty, oversized and control-character input", () => {
    expect(parseAssetCode("").kind).toBe("invalid");
    expect(parseAssetCode("   ").kind).toBe("invalid");
    expect(parseAssetCode("X".repeat(41)).kind).toBe("invalid");
    expect(parseAssetCode("INF\u0000-0412").kind).toBe("invalid");
  });
});

describe("return-after-sign-in addresses", () => {
  it("allow only asset pages and the scan page", () => {
    expect(safeNextPath("/assets/0b7e7f0e-3f1d-4c55-9a39-2f3c8e0b9a11")).not.toBeNull();
    expect(safeNextPath("/assets/scan")).toBe("/assets/scan");
    for (const bad of [
      "//evil.example",
      "https://evil.example",
      "/admin",
      "/a/Ab3dEf6hIj9kLm2nOp5qRs",
      "/assets/../admin",
      null,
    ]) {
      expect(safeNextPath(bad)).toBeNull();
    }
  });
});

describe("CSV export cells", () => {
  it("neutralise spreadsheet formulas and escape quotes", () => {
    expect(csvCell("=1+1")).toBe(`"'=1+1"`);
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvCell('Pump "A"')).toBe(`"Pump ""A"""`);
    expect(csvCell("INF-0412")).toBe(`"INF-0412"`);
  });
});

describe("asset validation", () => {
  it("normalises asset IDs to capitals and turns blank optional fields into nothing", () => {
    const parsed = createAssetSchema.parse({
      name: "Pump",
      assetTag: " inf-0412 ",
      modelId: "0b7e7f0e-3f1d-4c55-9a39-2f3c8e0b9a11",
      hospitalId: "0b7e7f0e-3f1d-4c55-9a39-2f3c8e0b9a12",
      departmentId: "0b7e7f0e-3f1d-4c55-9a39-2f3c8e0b9a13",
      status: "IN_SERVICE",
      serialNumber: "  ",
      purchaseCost: "",
      purchaseCurrency: "",
    });
    expect(parsed.assetTag).toBe("INF-0412");
    expect(parsed.serialNumber).toBeNull();
    expect(parsed.purchaseCost).toBeNull();
  });

  it("register queries fall back to safe defaults for anything unexpected", () => {
    const q = assetQuerySchema.parse({
      sort: "password",
      dir: "x",
      page: "-5",
      status: "BROKEN",
      hospital: "1 OR 1=1",
    });
    expect(q).toMatchObject({ sort: "assetTag", dir: "asc", page: 1, archived: "exclude" });
    expect(q.status).toBeUndefined();
    expect(q.hospital).toBeUndefined();
  });
});
