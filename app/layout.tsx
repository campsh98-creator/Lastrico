import type { Metadata, Viewport } from "next";
import "./globals.css";

export function generateMetadata(): Metadata {
  const title = "Lastrico — Road-surface-aware navigation";
  const description = "Compare routes for cars, motorcycles, and bicycles using known road-surface data. Experimental beta coverage is currently limited to Milan.";
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
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#122023",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
