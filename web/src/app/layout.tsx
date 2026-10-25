import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/components/Providers";
import NavBar from "@/components/NavBar";

export const metadata: Metadata = {
  title: "Card Credit",
  description: "Borrow USDC against your tokenized graded cards. Solana devnet demo.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>
          <div className="bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Devnet demo, no real money, not financial advice.
          </div>
          <NavBar />
          <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
