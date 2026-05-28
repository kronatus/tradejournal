import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import Header from "@/components/header";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Trade Journal",
  description: "Options trading journal for tracking performance and metrics",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-bg text-text antialiased">
        <AuthProvider>
          <div className="min-h-screen">
            <Header />
            <main className="mx-auto max-w-7xl px-6 py-10">{children}</main>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
