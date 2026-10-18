import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const deva = Noto_Sans_Devanagari({ variable: "--font-deva", subsets: ["devanagari"], weight: ["400", "600", "700"] });

export const metadata: Metadata = {
  title: "Kavach - Check a suspicious message | Shravan Kasar",
  description: "Paste or share an SMS, WhatsApp message or screenshot to see if it's a scam, why, and what to do if you've already lost money. English, Hindi and Marathi.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
  appleWebApp: { capable: true, title: "Kavach" },
};

export const viewport: Viewport = { themeColor: "#1f5eff", width: "device-width", initialScale: 1 };

// registers the service worker that receives "Share to Kavach"
const swScript = `if("serviceWorker" in navigator){window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){})})}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${deva.variable}`}>
      <body className="min-h-screen antialiased">
        {children}
        <script dangerouslySetInnerHTML={{ __html: swScript }} />
      </body>
    </html>
  );
}
