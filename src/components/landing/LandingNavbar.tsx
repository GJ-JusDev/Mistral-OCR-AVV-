"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { Menu, X, ArrowRight, LogIn } from "lucide-react";

interface LandingNavbarProps {
  user?: any;
}

export default function LandingNavbar({ user }: LandingNavbarProps) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      // Check both window and any potential scrolling parent
      const scrollY = window.scrollY || document.querySelector("main")?.scrollTop || 0;
      setIsScrolled(scrollY > 20);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    const mainEl = document.querySelector("main");
    if (mainEl) {
      mainEl.addEventListener("scroll", handleScroll, { passive: true });
    }

    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (mainEl) {
        mainEl.removeEventListener("scroll", handleScroll);
      }
    };
  }, []);

  const scrollToSection = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    setMobileMenuOpen(false);

    if (id === "home") {
      const mainEl = document.querySelector("main");
      if (mainEl) {
        mainEl.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      return;
    }

    const target = document.getElementById(id);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <header
      className={`sticky top-0 z-50 w-full transition-all duration-300 ${
        isScrolled
          ? "bg-[#0B1F33]/95 backdrop-blur-md border-b border-white/10 shadow-lg shadow-black/20 py-2.5"
          : "bg-[#0B1F33]/80 backdrop-blur-sm border-b border-white/5 py-4"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          {/* Logo and Brand */}
          <Link
            href="#home"
            onClick={(e) => scrollToSection(e, "home")}
            className="flex items-center gap-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4C542] rounded-lg p-1"
            aria-label="AVV System - Taysan Resettlement Integrated School"
          >
            <div className="relative h-11 w-11 sm:h-12 sm:w-12 shrink-0 rounded-full bg-white/5 p-0.5 border border-white/10 group-hover:border-[#F4C542]/50 transition-colors">
              <Image
                src="/images/tris-logo.png"
                alt="Taysan Resettlement Integrated School Official Seal"
                width={48}
                height={48}
                priority
                className="h-full w-full object-contain"
              />
            </div>
            <div className="flex flex-col text-left">
              <div className="flex items-center gap-2">
                <span className="text-white font-bold text-lg sm:text-xl tracking-tight">
                  AVV System
                </span>
                <span className="hidden sm:inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-[#F4C542]/15 text-[#F4C542] border border-[#F4C542]/30">
                  Senior High School
                </span>
              </div>
              <span className="text-[11px] sm:text-xs text-[#CBD5E1] font-medium leading-tight truncate max-w-[220px] sm:max-w-none">
                Taysan Resettlement Integrated School
              </span>
            </div>
          </Link>

          {/* Desktop Navigation Links (>= 1024px) */}
          <nav className="hidden lg:flex items-center gap-1.5" aria-label="Main Navigation">
            <a
              href="#home"
              onClick={(e) => scrollToSection(e, "home")}
              className="px-3.5 py-2 text-sm font-medium text-[#CBD5E1] hover:text-white rounded-full hover:bg-white/5 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4C542]"
            >
              Home
            </a>
            <a
              href="#features"
              onClick={(e) => scrollToSection(e, "features")}
              className="px-3.5 py-2 text-sm font-medium text-[#CBD5E1] hover:text-white rounded-full hover:bg-white/5 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4C542]"
            >
              Features
            </a>
            <a
              href="#how-it-works"
              onClick={(e) => scrollToSection(e, "how-it-works")}
              className="px-3.5 py-2 text-sm font-medium text-[#CBD5E1] hover:text-white rounded-full hover:bg-white/5 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4C542]"
            >
              How It Works
            </a>
            <a
              href="#about"
              onClick={(e) => scrollToSection(e, "about")}
              className="px-3.5 py-2 text-sm font-medium text-[#CBD5E1] hover:text-white rounded-full hover:bg-white/5 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4C542]"
            >
              About
            </a>
          </nav>

          {/* Action Buttons (Desktop & Tablet) */}
          <div className="hidden sm:flex items-center gap-2.5">
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-[#CBD5E1] hover:text-white rounded-full hover:bg-white/10 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4C542]"
            >
              <LogIn className="h-4 w-4" />
              <span>Login</span>
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center gap-1.5 px-4 sm:px-5 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold text-white bg-[#174EA6] hover:bg-[#123e85] active:scale-[0.98] rounded-full shadow-md shadow-[#174EA6]/30 border border-white/15 hover:border-white/30 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4C542]"
            >
              <span>Get Started</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {/* Mobile & Tablet Hamburger Toggle (< 1024px) */}
          <div className="flex lg:hidden items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg text-[#CBD5E1] hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4C542]"
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>

        {/* Mobile & Tablet Dropdown Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden pt-4 pb-6 border-t border-white/10 mt-3 animate-in fade-in slide-in-from-top-2 duration-200">
            <nav className="flex flex-col space-y-1">
              <a
                href="#home"
                onClick={(e) => scrollToSection(e, "home")}
                className="px-4 py-2.5 text-base font-medium text-white hover:bg-white/10 rounded-lg transition-colors"
              >
                Home
              </a>
              <a
                href="#features"
                onClick={(e) => scrollToSection(e, "features")}
                className="px-4 py-2.5 text-base font-medium text-[#CBD5E1] hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              >
                Features
              </a>
              <a
                href="#how-it-works"
                onClick={(e) => scrollToSection(e, "how-it-works")}
                className="px-4 py-2.5 text-base font-medium text-[#CBD5E1] hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              >
                How It Works
              </a>
              <a
                href="#about"
                onClick={(e) => scrollToSection(e, "about")}
                className="px-4 py-2.5 text-base font-medium text-[#CBD5E1] hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              >
                About
              </a>
              <div className="pt-4 mt-2 border-t border-white/10 flex flex-col gap-2.5">
                <Link
                  href="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-white bg-white/10 hover:bg-white/15 rounded-full transition-colors text-center"
                >
                  <LogIn className="h-4 w-4" />
                  <span>Sign In to Account</span>
                </Link>
                <Link
                  href="/register"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-white bg-[#174EA6] hover:bg-[#123e85] rounded-full transition-colors text-center shadow-md shadow-[#174EA6]/30"
                >
                  <span>Get Started — Register Account</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
