import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Inter is bundled with the app (no request to an external font service).
const inter = localFont({
  src: [
    { path: "./fonts/Inter-Regular.woff2", weight: "400" },
    { path: "./fonts/Inter-Medium.woff2", weight: "500" },
    { path: "./fonts/Inter-SemiBold.woff2", weight: "600" },
    { path: "./fonts/Inter-Bold.woff2", weight: "700" },
  ],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "BiomedIntel.ai", template: "%s · BiomedIntel.ai" },
  description: "Smarter Maintenance. Safer Healthcare.",
  icons: { icon: "/brand/favicon.svg" },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
