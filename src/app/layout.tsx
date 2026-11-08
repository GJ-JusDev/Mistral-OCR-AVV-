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
  title: "Automated Visual Validation System (AVV) — Taysan Resettlement Integrated School",
  description: "Upload, validate, and manage school documents with OCR-powered field extraction and automated validation.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  let role = user?.user_metadata?.role?.toLowerCase() || "teacher";
  let isApproved = false;
  if (user) {
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role, account_status")
      .eq("user_id", user.id)
      .maybeSingle();
    if (roleRow?.role) {
      role = roleRow.role.toLowerCase();
    }
    isApproved = roleRow?.account_status === "Approved" || user?.user_metadata?.account_status === "Approved";
  }

  const isDashboardUser = Boolean(user && isApproved);

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body
        className={
          isDashboardUser
            ? "h-screen flex bg-background text-foreground overflow-hidden"
            : "min-h-screen bg-[#0B1F33] text-white flex flex-col"
        }
      >
        <ToastProvider>
          {isDashboardUser ? <Sidebar role={role} /> : null}
          <main
            className={
              isDashboardUser
                ? "flex-1 flex flex-col h-full overflow-y-auto"
                : "flex-1 w-full flex flex-col"
            }
          >
            {children}
          </main>
        </ToastProvider>
      </body>
    </html>
  );
}
