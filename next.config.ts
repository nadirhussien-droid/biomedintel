import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Content Security Policy: only BiomedIntel.ai's own origin may load scripts,
// styles, fonts and images. Next.js needs inline scripts for hydration; a
// nonce-based policy is planned before the pilot (see README, security limits).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Camera: this site only (optional barcode scanning, asked only when the user taps "Start camera").
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg", "sharp", "pdfjs-dist", "pdfkit", "exceljs"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Stored knowledge files set their own, stricter policy (see app/(app)/knowledge/files).
      { source: "/((?!knowledge/files/).*)", headers: [{ key: "Content-Security-Policy", value: csp }] },
    ];
  },
};

export default nextConfig;
