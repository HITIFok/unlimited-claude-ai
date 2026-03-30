import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Claude Interface - Unlimited Free AI",
  description:
    "A fully functional, self-hosted web interface for Anthropic's Claude AI, powered by Puter.js. 100% free, no backend required.",
  keywords: ["Claude", "AI", "Chat", "Puter", "Anthropic", "Free AI"],
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/claude-icon.png", sizes: "1024x1024", type: "image/png" },
    ],
    apple: "/claude-icon.png",
  },
  openGraph: {
    title: "Claude Interface - Unlimited Free AI",
    description:
      "Free, self-hosted Claude AI interface powered by Puter.js",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        style={{ margin: 0, padding: 0 }}
      >
        {children}
      </body>
    </html>
  );
}
