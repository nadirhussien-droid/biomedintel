// "Return to this page after sign-in" — limited to a strict allow-list so a
// crafted link can never send someone to another website (open redirect).
// Only an asset page, a work order page or the barcode scan page is accepted.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ALLOWED = [
  new RegExp(`^/assets/${UUID}$`, "i"),
  /^\/assets\/scan$/,
  new RegExp(`^/work-orders/${UUID}$`, "i"),
  /^\/work-orders\/new$/,
];

export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || value.length > 100) return null;
  return ALLOWED.some((re) => re.test(value)) ? value : null;
}
