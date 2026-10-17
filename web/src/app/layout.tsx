import type { Metadata } from "next";
import { Inter, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const deva = Noto_Sans_Devanagari({ variable: "--font-deva", subsets: ["devanagari"], weight: ["400", "600", "700"] });

export const metadata: Metadata = {
  title: "Kavach - Check a suspicious message | Shravan Kasar",
  description: "Paste an SMS or WhatsApp message to see if it's a scam, why, and what to do if you've already lost money. English, Hindi and Marathi.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${deva.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
