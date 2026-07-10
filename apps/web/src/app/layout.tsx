import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Cinzel } from "next/font/google";
import { GraphQLProvider } from "@/lib/urql";
import { I18nProvider } from "@/i18n/provider";
import { PwaSetup } from "@/components/PwaSetup";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Herald brand serif (inscriptional Roman) — used only by the Wordmark component.
const cinzel = Cinzel({
  variable: "--font-herald",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Herald — Food Delivery",
  description: "Restaurant-first delivery marketplace",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#e11d48",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // lang/dir default to en/ltr for SSR; I18nProvider updates them on the client
    // when the stored locale is Urdu (RTL). See src/i18n for the scaffolding note.
    <html lang="en" dir="ltr" className={`${geistSans.variable} ${geistMono.variable} ${cinzel.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <I18nProvider>
          <GraphQLProvider>{children}</GraphQLProvider>
        </I18nProvider>
        <PwaSetup />
      </body>
    </html>
  );
}
