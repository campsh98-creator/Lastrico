import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lastrico — Milano senza sobbalzi",
  description: "Confronta il percorso più rapido con quello che evita pavé e sanpietrini a Milano.",
  applicationName: "Lastrico",
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
};

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
