"use client";

import { useEffect, useState, type MouseEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Menu, X } from "lucide-react";
import { landingStyles } from "./content";

interface LandingNavbarProps {
  user?: any;
}

const navItems = [
  { id: "home", label: "Home" },
  { id: "features", label: "Features" },
  { id: "how-it-works", label: "How It Works" },
  { id: "about", label: "About" },
];

export default function LandingNavbar({ user }: LandingNavbarProps) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeId, setActiveId] = useState("home");

  useEffect(() => {
    const handleScroll = () => {
      // Check both window and any potential scrolling parent
      const scrollY = window.scrollY || document.querySelector("main")?.scrollTop || 0;
      setIsScrolled(scrollY > 20);
    };

    handleScroll();
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

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        }
      },
      { rootMargin: "-40% 0px -55% 0px" }
    );

    for (const item of navItems) {
      const section = document.getElementById(item.id);
      if (section) observer.observe(section);
    }

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileMenuOpen]);

  const scrollToSection = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    setMobileMenuOpen(false);
    const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";

    if (id === "home") {
      const mainEl = document.querySelector("main");
      if (mainEl) {
        mainEl.scrollTo({ top: 0, behavior });
      }
      window.scrollTo({ top: 0, behavior });
      return;
    }

    document.getElementById(id)?.scrollIntoView({ behavior, block: "start" });
  };

  const focusRing =
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8CF06F]";

  return (
    <header
      className={`sticky top-0 z-50 w-full transition-colors duration-300 ${
        isScrolled || mobileMenuOpen
          ? "bg-[#00212B]/95 shadow-[0_8px_24px_rgba(0,20,26,0.3)] backdrop-blur-md"
          : "bg-transparent"
      }`}
    >
      {/* Equal side columns keep the nav links centered in the window from lg up. */}
      <div
        className={`${landingStyles.container} flex h-[72px] items-center justify-between lg:grid lg:h-20 lg:grid-cols-[1fr_auto_1fr] lg:gap-x-4`}
      >
        <Link
          href="#home"
          onClick={(e) => scrollToSection(e, "home")}
          aria-label="AVV System home"
          className={`flex min-w-0 items-center gap-2.5 justify-self-start rounded-lg lg:min-w-max ${focusRing}`}
        >
          <span className="relative flex h-11 w-11 shrink-0 items-center justify-center min-[1366px]:h-[52px] min-[1366px]:w-[52px] min-[1536px]:h-14 min-[1536px]:w-14">
            <Image
              src="/images/tris-logo.png"
              alt="Taysan Resettlement Integrated School Official Seal"
              width={56}
              height={56}
              priority
              className="h-full w-full object-contain"
            />
          </span>
          <span className="min-w-0 whitespace-nowrap">
            <span className="flex items-center gap-2">
              <span
                className={`${landingStyles.heading} text-xl font-bold leading-tight text-white min-[1366px]:text-2xl min-[1536px]:text-[28px]`}
              >
                AVV System
              </span>
              {/* Hidden where it would crowd the menu button or the Login buttons. */}
              <span className="hidden rounded-full border border-[#F5C451]/60 bg-[#F5C451]/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#F5C451] min-[420px]:inline-block min-[640px]:hidden min-[768px]:inline-block min-[1366px]:px-3 min-[1366px]:py-1 min-[1366px]:text-xs min-[1536px]:text-[13px]">
                Senior High School
              </span>
            </span>
            <span className="mt-0.5 block text-xs leading-tight text-white/85 min-[420px]:text-[13px] min-[640px]:text-xs min-[768px]:text-[13px] min-[1366px]:text-[15px] min-[1536px]:text-base">
              Taysan Resettlement Integrated School
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-6 lg:flex xl:gap-9" aria-label="Main Navigation">
          {navItems.map((item) => {
            const isActive = activeId === item.id;
            return (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={(e) => scrollToSection(e, item.id)}
                aria-current={isActive ? "location" : undefined}
                className={`relative py-2 text-base font-medium transition-colors min-[1280px]:text-[17px] min-[1536px]:text-lg after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-[#5FDC4B] after:transition-transform after:duration-200 ${focusRing} ${
                  isActive
                    ? "text-white after:scale-x-100"
                    : "text-white/85 after:scale-x-0 hover:text-white"
                }`}
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        <div className="flex items-center gap-2.5 justify-self-end">
          <div className="hidden items-center gap-2.5 sm:flex">
            <Link
              href="/login"
              className={`${landingStyles.outlineButton} px-6 text-sm min-[1024px]:text-[15px] min-[1280px]:text-base min-[1536px]:text-[17px]`}
            >
              Login
            </Link>
            <Link
              href="/register"
              className={`${landingStyles.primaryButton} px-6 text-sm min-[1024px]:text-[15px] min-[1280px]:text-base min-[1536px]:text-[17px]`}
            >
              Get Started
            </Link>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
            aria-controls="landing-mobile-menu"
            className={`inline-flex h-11 w-11 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10 lg:hidden ${focusRing}`}
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div
          id="landing-mobile-menu"
          className="absolute inset-x-0 top-full border-t border-white/10 bg-[#00212B] shadow-[0_16px_32px_rgba(0,20,26,0.4)] lg:hidden"
        >
          <nav className={`${landingStyles.container} flex flex-col gap-1 py-4`} aria-label="Mobile Navigation">
            {navItems.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={(e) => scrollToSection(e, item.id)}
                aria-current={activeId === item.id ? "location" : undefined}
                className={`rounded-lg px-3 py-3 text-lg font-medium transition-colors hover:bg-white/10 ${focusRing} ${
                  activeId === item.id ? "text-[#5FDC4B]" : "text-white"
                }`}
              >
                {item.label}
              </a>
            ))}
            <div className="mt-3 flex flex-col gap-2.5 border-t border-white/10 pt-4">
              <Link
                href="/login"
                onClick={() => setMobileMenuOpen(false)}
                className={`${landingStyles.outlineButton} px-6 text-base`}
              >
                Sign In to Account
              </Link>
              <Link
                href="/register"
                onClick={() => setMobileMenuOpen(false)}
                className={`${landingStyles.primaryButton} px-6 text-base`}
              >
                Get Started
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
