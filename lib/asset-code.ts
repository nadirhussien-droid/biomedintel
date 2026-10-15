// Interpreting what a barcode scanner (camera or handheld) or a person typing
// gives us.
//
// Scanned text is UNTRUSTED: anyone can print a barcode. This parser never
// navigates anywhere. It only accepts a short, plain code:
//   • a BiomedIntel.ai asset ID, e.g. INF-0412 (what our labels contain), or
//   • a hospital inventory number from the hospital's own older labels.
// Links, scripts and anything long or containing control characters are
// refused. The server then looks the code up inside the user's organisation
// and scope and returns an in-app address built from the asset's id.

export const ASSET_TAG_PATTERN = /^[A-Z0-9][A-Z0-9./-]{0,39}$/;
const MAX_CODE_LENGTH = 40;
// No control characters (handheld scanners end with Enter, which is trimmed).
const PRINTABLE = /^[^\u0000-\u001f\u007f]+$/;
// Anything that looks like a link or a script, e.g. https://…, javascript:…, data:…
const LINK_LIKE = /^[a-z][a-z0-9+.-]*:|\/\/|^www\./i;

export type ParsedAssetCode = { kind: "code"; code: string; isAssetTag: boolean } | { kind: "invalid"; reason: string };

export function parseAssetCode(raw: string): ParsedAssetCode {
  const text = raw.trim();
  if (!text) return { kind: "invalid", reason: "Nothing was scanned or entered." };
  if (LINK_LIKE.test(text)) {
    return {
      kind: "invalid",
      reason: "This barcode contains a web link, not a BiomedIntel.ai asset ID. It was not opened.",
    };
  }
  if (text.length > MAX_CODE_LENGTH || !PRINTABLE.test(text)) {
    return { kind: "invalid", reason: "This is not a BiomedIntel.ai asset ID or inventory number." };
  }
  return { kind: "code", code: text, isAssetTag: ASSET_TAG_PATTERN.test(text.toUpperCase()) };
}
