import type { Metadata } from "next";
import Providers from "./providers";
import Header from "@/components/Header";
import "./globals.css";

export const metadata: Metadata = {
  title: "HoloLend",
  description: "Borrow against tokenized Pokémon cards, priced by a card safety score, with collateral held in escrow on Solana.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Header />
          <main>{children}</main>
          <footer className="foot">
            Hackathon demo on Solana devnet. Not financial advice; devnet SOL has no value.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
