import type { Metadata } from "next";
import "./globals.css";
import Nav from "../components/Nav";

export const metadata: Metadata = {
  title: "AHA · Ayni — Find a Circle Near You",
  description:
    "Ancestral Humanity Anonymous — find a fellowship Circle near you, read the Daily Reflection, and browse shared documents. Anonymous, owner-less, on Solana.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="container">{children}</main>
        <footer className="footer">
          AHA — Ancestral Humanity Anonymous · governed by group conscience, not by an owner.
        </footer>
      </body>
    </html>
  );
}
