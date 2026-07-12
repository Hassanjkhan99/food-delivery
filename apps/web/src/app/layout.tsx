import type { Metadata, Viewport } from "next";
import { Cinzel, Geist_Mono, Inter, Poppins } from "next/font/google";
import { GraphQLProvider } from "@/lib/urql";
import { I18nProvider } from "@/i18n/provider";
import { PwaSetup } from "@/components/PwaSetup";
import "./globals.css";

// Design-system fonts (founder spec): Poppins for headings, Inter for body/UI.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// KhaanaDo brand serif (inscriptional Roman) — used only by the Wordmark component.
const cinzel = Cinzel({
  variable: "--font-herald",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "KhaanaDo — Food Delivery",
  description: "Restaurant-first delivery marketplace",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#ea580c",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // lang/dir default to en/ltr for SSR; I18nProvider updates them on the client
    // when the stored locale is Urdu (RTL). See src/i18n for the scaffolding note.
    <html
      lang="en"
      dir="ltr"
      className={`${poppins.variable} ${inter.variable} ${geistMono.variable} ${cinzel.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <I18nProvider>
          <GraphQLProvider>{children}</GraphQLProvider>
        </I18nProvider>
        <PwaSetup />
      </body>
    </html>
  );
}
