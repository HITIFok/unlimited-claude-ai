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
  title: "Super Z — Premium AI Assistant",
  description:
    "Super Z is the most powerful AI assistant — expert-level skills across every domain. Free, unlimited, by Super Z.",
  keywords: ["Super Z", "AI", "Chat", "Premium AI", "Z.ai", "Free AI", "Code", "Assistant", "Full-stack"],
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/superz-icon.png", sizes: "1024x1024", type: "image/png" },
    ],
    apple: "/superz-icon.png",
  },
  openGraph: {
    title: "Super Z — Premium AI Assistant",
    description:
      "Free, unlimited premium AI assistant by Super Z.",
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
