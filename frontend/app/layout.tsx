import type { Metadata } from "next";
import "./globals.css";
import Nav from "../components/Nav";
import WalletProviders from "../components/WalletProviders";
import SettingsProvider from "../components/SettingsProvider";
import SeatMessagingGate from "../components/SeatMessagingGate";
import Footer from "../components/Footer";

export const metadata: Metadata = {
  title: "AHA · Ayni — Find a Circle Near You",
  description:
    "Ancestral Humanity Anonymous — find a fellowship Circle near you, read the Daily Reflection, and browse shared documents. Anonymous, owner-less, on Solana.",
  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon.ico" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

// Set theme + language on <html> before paint (no flash, correct dir for RTL).
const noFlash = `(function(){try{var t=localStorage.getItem('aha:theme')||'light';var l=localStorage.getItem('aha:lang')||'en';var e=document.documentElement;e.dataset.theme=t;e.lang=l;e.dir=(l==='ar')?'rtl':'ltr';}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlash }} />
      </head>
      <body>
        <SettingsProvider>
          <WalletProviders>
            <Nav />
            <SeatMessagingGate />
            <main className="container">{children}</main>
            <Footer />
          </WalletProviders>
        </SettingsProvider>
      </body>
    </html>
  );
}
