import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "Lastrico — Milano senza sobbalzi";
  const description = "Confronta il percorso più rapido con quello che evita pavé e sanpietrini a Milano.";
  return {
    title,
    description,
    applicationName: "Lastrico",
    authors: [{ name: "Domenico Campanella Scali" }],
    creator: "Domenico Campanella Scali",
    publisher: "Domenico Campanella Scali",
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      title: "Lastrico",
      statusBarStyle: "black-translucent",
    },
    icons: {
      icon: "/favicon.svg",
      apple: "/favicon.svg",
    },
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1672, height: 941, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${origin}/og.png`],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#122023",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
