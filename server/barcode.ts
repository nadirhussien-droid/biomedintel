// Code 128 barcodes for equipment labels.
//
// The barcode holds ONLY the asset ID (e.g. INF-0412) — the same text printed
// under it. No password, session, database id, patient data or other equipment
// details. It is an identifier, not a key: looking it up still requires a
// signed-in user with access to the asset's hospital and department.
//
// Code 128 is the usual symbology for hospital asset labels: compact, read by
// every handheld scanner and by phone cameras through the app's Scan page.
import bwipjs from "bwip-js";
import { ASSET_TAG_PATTERN } from "@/lib/asset-code";

/** White margin each side, in modules. Code 128 needs at least 10. */
export const QUIET_ZONE = 10;

export type Barcode = {
  /** Total width in modules, including both quiet zones. */
  modules: number;
  /** Black bars as [x, width] in modules. */
  bars: [number, number][];
};

export function code128(assetTag: string): Barcode {
  if (!ASSET_TAG_PATTERN.test(assetTag)) throw new Error("Not a valid asset ID for a barcode");
  const [symbol] = bwipjs.raw({ bcid: "code128", text: assetTag });
  const bars: [number, number][] = [];
  let x = QUIET_ZONE;
  symbol.sbs.forEach((width, i) => {
    if (i % 2 === 0) bars.push([x, width]); // even entries are bars, odd are spaces
    x += width;
  });
  return { modules: x + QUIET_ZONE, bars };
}

/** Width of one module in mm when the barcode fills `widthMm`. Below ~0.25 mm scanners struggle. */
export function moduleWidthMm(barcode: Barcode, widthMm: number): number {
  return widthMm / barcode.modules;
}

/** Stage 8: Code 128 barcode of a spare part's internal part number (same symbology as equipment labels). */
export function partCode128(partNumber: string): Barcode {
  if (!/^[A-Z0-9][A-Z0-9./_-]{0,39}$/.test(partNumber)) throw new Error("Not a valid part number for a barcode");
  const [symbol] = bwipjs.raw({ bcid: "code128", text: partNumber });
  const bars: [number, number][] = [];
  let x = QUIET_ZONE;
  symbol.sbs.forEach((width, i) => {
    if (i % 2 === 0) bars.push([x, width]);
    x += width;
  });
  return { modules: x + QUIET_ZONE, bars };
}
