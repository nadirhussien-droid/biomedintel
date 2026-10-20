// Liveness check (Stage 10): "is the BiomedIntel.ai process running?"
// Public, no database access, no details. Hosting platforms poll this.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
