// "Return to this page after sign-in" — limited to a strict allow-list so a
// crafted link can never send someone to another website (open redirect).
// Only an asset page, a work order page, the barcode scan page or (Stage 6) a
// maintenance plan or safety hold page is accepted.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ALLOWED = [
  new RegExp(`^/assets/${UUID}$`, "i"),
  /^\/assets\/scan$/,
  new RegExp(`^/work-orders/${UUID}$`, "i"),
  /^\/work-orders\/new$/,
  new RegExp(`^/maintenance/(plans|holds)/${UUID}$`, "i"),
  /^\/maintenance(\/(schedule|calendar|review|holds|reports))?$/,
  // Stage 7: report pages and generated report snapshots (notification links).
  /^\/reports(\/(pm-compliance|work-orders|reliability|safety|governance|lifecycle|scheduled))?$/,
  new RegExp(`^/reports/scheduled/${UUID}$`, "i"),
  /^\/reports\/costs$/,
  // Stage 8: inventory, purchase requests and suppliers (reminder links).
  /^\/inventory(\/(work-orders|movements|purchasing|stores|settings))?$/,
  new RegExp(`^/inventory/(parts|purchasing)/${UUID}$`, "i"),
  /^\/suppliers(\/(warranties|services))?$/,
  new RegExp(`^/suppliers/${UUID}$`, "i"),
  // Stage 9: knowledge base and troubleshooting sessions.
  /^\/knowledge$/,
  new RegExp(`^/knowledge/${UUID}$`, "i"),
  /^\/assist(\/settings)?$/,
  new RegExp(`^/assist/${UUID}$`, "i"),
];

export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || value.length > 100) return null;
  return ALLOWED.some((re) => re.test(value)) ? value : null;
}
