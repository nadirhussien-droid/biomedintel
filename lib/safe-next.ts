// "Return to this page after sign-in" — limited to a strict allow-list so a
// crafted link can never send someone to another website (open redirect).
// Only an asset page or the barcode scan page is accepted.
const ALLOWED = [/^\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, /^\/assets\/scan$/];

export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || value.length > 100) return null;
  return ALLOWED.some((re) => re.test(value)) ? value : null;
}
