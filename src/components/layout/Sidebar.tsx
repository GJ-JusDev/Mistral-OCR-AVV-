"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  LayoutDashboard, 
  Upload, 
  FileText, 
  CheckSquare, 
  Users, 
  BarChart3, 
  Settings,
  GraduationCap,
  Menu,
  X,
  UserCheck
} from "lucide-react";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { createClient } from "@/lib/supabase/client";

const baseNavigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Upload Document", href: "/upload", icon: Upload },
  { name: "Documents", href: "/documents", icon: FileText },
  { name: "Review Queue", href: "/review", icon: CheckSquare },
  { name: "Students", href: "/students", icon: Users },
  { name: "Reports", href: "/reports", icon: BarChart3 },
  { name: "Settings", href: "/settings", icon: Settings },
];

export default function Sidebar({ role = "teacher" }: { role?: string }) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  if (pathname === "/login" || pathname === "/register") {
    return null;
  }

  const navigation = [...baseNavigation];
  if (role === "admin") {
    if (!navigation.find(n => n.name === "Users")) {
      navigation.splice(5, 0, { name: "Users", href: "/admin/users", icon: UserCheck });
    }
  }

  // We rely on onClick in the Link elements to close the sidebar instead of useEffect

  return (
    <>
      <button 
        className="md:hidden fixed top-3 left-4 z-50 p-2 bg-white rounded-md shadow-sm border border-[#dee2e6]"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? <X className="h-5 w-5 text-[#212529]" /> : <Menu className="h-5 w-5 text-[#212529]" />}
      </button>

      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      <div className={`fixed inset-y-0 left-0 z-40 w-64 transform flex-col border-r border-[#dee2e6] bg-[#f8f9fa] transition-transform duration-200 ease-in-out md:sticky md:top-0 md:flex md:translate-x-0 h-screen ${isOpen ? "flex translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-16 shrink-0 items-center gap-2 border-b border-[#dee2e6] px-6 bg-white">
          <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-[#212529] text-white">
            <GraduationCap className="h-5 w-5" />
          </div>
          <span className="font-semibold text-[#212529] text-lg tracking-tight">DocuValidate</span>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {navigation.map((item) => {
            const isActive = pathname === item.href || (pathname.startsWith(item.href) && item.href !== "/");
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className={`flex items-center gap-3 px-3 py-2 text-[0.875rem] font-medium ${
                  isActive
                    ? "bg-[#e9ecef] text-[#212529] border-l-2 border-[#212529]"
                    : "text-[#495057] hover:bg-[#e9ecef] border-l-2 border-transparent"
                }`}
              >
                <item.icon className={`h-4 w-4 ${isActive ? "text-[#212529]" : "text-[#6c757d]"}`} />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[#dee2e6] p-4 bg-white shrink-0">
          <LogoutButton />
        </div>
      </div>
    </>
  );
}