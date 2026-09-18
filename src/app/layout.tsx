import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/layout/Sidebar";
import { ToastProvider } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/server";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Automated Visual Validation System — Taysan Resettlement Integrated School",
  description: "Upload, validate, and manage school documents with OCR-powered field extraction and automated validation.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = user?.user_metadata?.role?.toLowerCase() || "teacher";

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-screen flex bg-background text-foreground overflow-hidden">
        <ToastProvider>
          <Sidebar role={role} />
          <main className="flex-1 flex flex-col h-full overflow-y-auto">
            {children}
          </main>
        </ToastProvider>
      </body>
    </html>
  );
}
