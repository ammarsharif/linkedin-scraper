import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { EscalationNotifier } from "@/components/EscalationNotifier";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "LinkedIn Scraper — Profile & Posts Scraper",
  description:
    "Scrape LinkedIn profiles and posts with ease. Export results to CSV. Powered by LinkedIn session cookies for reliable data extraction.",
  keywords: ["LinkedIn", "scraper", "profile", "posts", "CSV", "export"],
  openGraph: {
    title: "LinkedIn Scraper",
    description: "Scrape LinkedIn profiles and posts, export to CSV",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <EscalationNotifier />
        {children}
      </body>
    </html>
  );
}
