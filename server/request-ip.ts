// The visitor's IP address, read from the header the hosting proxy sets
// (TRUSTED_IP_HEADER, default x-forwarded-for). Used only for audit records
// and the per-IP rate limit. A client can forge this header when no proxy
// overwrites it, so nothing security-critical depends on it: the per-account
// limits in server/auth/throttle.ts do not use it.
export function clientIp(headers: Headers | undefined | null): string | null {
  if (!headers) return null;
  const name = process.env.TRUSTED_IP_HEADER?.trim().toLowerCase() || "x-forwarded-for";
  const value = headers.get(name);
  if (!value) return null;
  const first = value.split(",")[0]?.trim() ?? "";
  return first ? first.slice(0, 64) : null;
}
