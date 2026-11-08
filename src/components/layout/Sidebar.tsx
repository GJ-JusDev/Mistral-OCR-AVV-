"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
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
  UserCheck,
  ShieldCheck,
  ExternalLink,
  School
} from "lucide-react";
import { LogoutButton } from "@/components/auth/LogoutButton";

const teacherNavigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Upload Document", href: "/upload", icon: Upload },
  { name: "Documents", href: "/documents", icon: FileText },
  { name: "Review Queue", href: "/review", icon: CheckSquare },
  { name: "Students", href: "/students", icon: Users },
  { name: "Settings", href: "/settings", icon: Settings },
];

const adminNavigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Upload Document", href: "/upload", icon: Upload },
  { name: "Documents", href: "/documents", icon: FileText },
  { name: "Review Queue", href: "/review", icon: CheckSquare },
  { name: "Students", href: "/students", icon: Users },
  { name: "User Management", href: "/admin/users", icon: UserCheck },
  { name: "Audit Logs", href: "/admin/audit-logs", icon: ShieldCheck },
  { name: "Settings", href: "/settings", icon: Settings },
];

const principalNavigation = [
  { name: "Executive Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Student Directory", href: "/principal/students", icon: Users },
  { name: "Document Summary", href: "/principal/documents", icon: FileText },
  { name: "Academic Overview", href: "/principal/academic", icon: GraduationCap },
  { name: "Institutional Reports", href: "/reports", icon: BarChart3 },
  { name: "Settings", href: "/settings", icon: Settings },
];

export default function Sidebar({ role = "teacher" }: { role?: string }) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  // Never render on public auth or landing pages
  if (pathname === "/login" || pathname === "/register" || pathname === "/landing") {
    return null;
  }

  const normalizedRole = (role || "teacher").toLowerCase();
  const isPrincipal = normalizedRole === "principal";
  const isAdmin = normalizedRole === "admin";

  let navigation = teacherNavigation;
  let roleLabel = "Teacher";
  let roleBadgeStyle = "bg-emerald-500/15 text-emerald-300 border-emerald-400/30";

  if (isPrincipal) {
    navigation = principalNavigation;
    roleLabel = "School Principal";
    roleBadgeStyle = "bg-[#F4C542]/20 text-[#F4C542] border-[#F4C542]/40";
  } else if (isAdmin) {
    navigation = adminNavigation;
    roleLabel = "Administrator";
    roleBadgeStyle = "bg-blue-400/20 text-blue-300 border-blue-400/30";
  }

  return (
    <>
      {/* Mobile Hamburger Button */}
      <button 
        className="md:hidden fixed top-3 left-4 z-50 p-2 bg-[#0B1F33] text-white rounded-lg shadow-md border border-white/10 hover:bg-[#102A43] transition-colors"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle navigation drawer"
      >
        {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Mobile Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-[#0B1F33]/70 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar Drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 transform flex flex-col bg-[#0B1F33] text-white border-r border-white/10 transition-transform duration-200 ease-in-out md:sticky md:top-0 md:flex md:translate-x-0 h-screen shrink-0 ${
          isOpen ? "flex translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Institutional Branding Header */}
        <div className="flex h-20 shrink-0 items-center gap-3 border-b border-white/10 px-5 bg-[#0B1F33]">
          <div className="relative h-11 w-11 shrink-0 rounded-full bg-white/10 p-0.5 border border-white/20">
            <Image
              src="/images/tris-logo.png"
              alt="Taysan Resettlement Integrated School Official Seal"
              width={44}
              height={44}
              priority
              className="h-full w-full object-contain"
            />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-white text-base tracking-tight leading-tight">
                AVV System
              </span>
            </div>
            <span className="text-[11px] text-[#CBD5E1] truncate font-medium">
              Taysan Resettlement IS
            </span>
            <div className="mt-1 flex items-center gap-1">
              <span className={`inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-semibold border ${roleBadgeStyle}`}>
                {roleLabel}
              </span>
              <span className="text-[9px] text-slate-400">ID 300792</span>
            </div>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Main Menu
          </div>
          {navigation.map((item) => {
            const isActive =
              pathname === item.href ||
              (pathname.startsWith(item.href) && item.href !== "/");

            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs sm:text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? "bg-[#174EA6] text-white shadow-sm font-semibold border-l-3 border-[#F4C542]"
                    : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <item.icon
                  className={`h-4 w-4 shrink-0 transition-colors ${
                    isActive ? "text-[#F4C542]" : "text-slate-400 group-hover:text-white"
                  }`}
                />
                <span className="truncate">{item.name}</span>
              </Link>
            );
          })}

          {/* Quick link back to landing page */}
          <div className="pt-4 mt-4 border-t border-white/10">
            <Link
              href="/?view=landing"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-colors"
            >
              <ExternalLink className="h-4 w-4 shrink-0 text-slate-400" />
              <span>Public Landing Page</span>
            </Link>
          </div>
        </nav>

        {/* Principal School Head Governance Notice */}
        {isPrincipal && (
          <div className="mx-3 mb-3 p-3 bg-white/5 border border-white/10 rounded-xl">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#F4C542]">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span>School Head Monitor</span>
            </div>
            <p className="text-[10px] text-slate-300 mt-1 leading-snug">
              DepEd K–12 Senior High School Progression & Graduation Eligibility Oversight.
            </p>
          </div>
        )}

        {/* User / Sign Out Footer */}
        <div className="border-t border-white/10 p-3 bg-[#0B1F33] shrink-0">
          <LogoutButton />
        </div>
      </aside>
    </>
  );
}
