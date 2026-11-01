import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Meridian Exchange — 24/7 US Equity Trading",
  description:
    "Trade US equities around the clock on Meridian Exchange (MRX). Real-time quotes, Level-2 depth, $0 commission trading, and a full REST trading API.",
  keywords: ["Meridian Exchange", "MRX", "stock trading", "24/7 market", "equities", "trading API"],
  authors: [{ name: "Meridian Markets LLC" }],
  icons: {
    icon: "/mrx-logo.svg",
  },
  openGraph: {
    title: "Meridian Exchange — 24/7 US Equity Trading",
    description: "The market that never closes. Trade 40+ listed securities with $0 commission and 2x margin.",
    siteName: "Meridian Exchange",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0e13",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#0b0e13] text-neutral-200`}
      >
        {children}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
