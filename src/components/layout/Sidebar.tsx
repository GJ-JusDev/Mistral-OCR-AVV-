"use client";

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
  GraduationCap
} from "lucide-react";
import { LogoutButton } from "@/components/auth/LogoutButton";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Upload Document", href: "/upload", icon: Upload },
  { name: "Documents", href: "/documents", icon: FileText },
  { name: "Review Queue", href: "/review", icon: CheckSquare },
  { name: "Students", href: "/students", icon: Users },
  { name: "Reports", href: "/reports", icon: BarChart3 },
  { name: "Settings", href: "/settings", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();

  // Do not show sidebar on auth pages
  if (pathname === "/login" || pathname === "/register") {
    return null;
  }

  return (
    <div className="flex h-screen w-64 flex-col border-r border-[#dee2e6] bg-[#f8f9fa]">
      <div className="flex h-16 items-center gap-2 border-b border-[#dee2e6] px-6 bg-white">
        <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-[#212529] text-white">
          <GraduationCap className="h-5 w-5" />
        </div>
        <span className="font-semibold text-[#212529] text-lg tracking-tight">DocuValidate</span>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {navigation.map((item) => {
          const isActive = pathname === item.href;
          return (
             <Link
              key={item.name}
              href={item.href}
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

      <div className="border-t border-[#dee2e6] p-4 bg-white">
        <LogoutButton />
      </div>
    </div>
  );
}