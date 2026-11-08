"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChevronDown, MapPin, ShieldCheck, FileCheck2, Sparkles } from "lucide-react";

export default function HeroSection() {
  const scrollToWorkflow = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const target = document.getElementById("how-it-works");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <section
      id="home"
      className="relative min-h-[92vh] flex items-center justify-center overflow-hidden bg-[#0B1F33] text-white"
    >
      {/* Background Image: Mayon Volcano Albay Landscape */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/images/mayon-hero.jpg"
          alt="Mayon Volcano and Albay Landscape near Taysan Resettlement Integrated School"
          fill
          priority
          quality={90}
          className="object-cover object-center scale-105 animate-in fade-in zoom-in-105 duration-1000"
        />
        {/* Dark Navy / Dark Slate Multi-Stop Gradient Overlays for Maximum Text Legibility */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0B1F33]/70 via-[#0B1F33]/55 to-[#102A43]/95" />
        <div className="absolute inset-0 bg-radial-[at_50%_35%] from-[#174EA6]/25 via-transparent to-[#0B1F33]/80 pointer-events-none" />
      </div>

      {/* Hero Foreground Content */}
      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 text-center flex flex-col items-center">
        {/* Location & School Identity Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-[#CBD5E1] text-xs sm:text-sm font-medium mb-8 shadow-sm">
          <MapPin className="h-4 w-4 text-[#F4C542] shrink-0" />
          <span className="font-semibold text-white">Taysan, Legazpi City, Albay</span>
          <span className="text-white/40">•</span>
          <span className="text-[#F4C542] font-medium">TRIS Senior High School</span>
        </div>

        {/* Hero Headline */}
        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight text-white leading-[1.12] max-w-4xl">
          Smarter School Form Validation{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-[#F4C542] to-white">
            for Senior High School
          </span>
        </h1>

        {/* Hero Subtitle */}
        <p className="mt-6 max-w-3xl text-lg sm:text-xl text-[#CBD5E1] leading-relaxed font-normal">
          An AI-assisted platform for extracting, reviewing, and validating Senior High School records
          with accuracy, transparency, and human verification.
        </p>

        {/* Action Buttons */}
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 w-full sm:w-auto">
          <Link
            href="/register"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-8 py-4 text-base font-semibold text-white bg-[#174EA6] hover:bg-[#123e85] active:scale-[0.98] rounded-full shadow-xl shadow-[#174EA6]/30 border border-white/20 hover:border-white/40 transition-all duration-200 group"
          >
            <span>Get Started</span>
            <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform duration-200" />
          </Link>

          <a
            href="#how-it-works"
            onClick={scrollToWorkflow}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-medium text-white bg-white/10 hover:bg-white/15 active:scale-[0.98] rounded-full backdrop-blur-md border border-white/20 hover:border-white/35 transition-all duration-200"
          >
            <ChevronDown className="h-4 w-4 text-[#F4C542]" />
            <span>How It Works</span>
          </a>
        </div>

        {/* Trust Badges / Key Value Highlights */}
        <div className="mt-16 pt-10 border-t border-white/10 grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 w-full max-w-3xl">
          <div className="flex items-center justify-center gap-2.5 text-xs sm:text-sm text-[#CBD5E1] bg-white/[0.04] backdrop-blur-xs py-2.5 px-4 rounded-xl border border-white/5">
            <FileCheck2 className="h-4 w-4 text-[#F4C542] shrink-0" />
            <span className="font-medium text-white/90">DepEd SF9 & SF10 Compatible</span>
          </div>
          <div className="flex items-center justify-center gap-2.5 text-xs sm:text-sm text-[#CBD5E1] bg-white/[0.04] backdrop-blur-xs py-2.5 px-4 rounded-xl border border-white/5">
            <Sparkles className="h-4 w-4 text-[#F4C542] shrink-0" />
            <span className="font-medium text-white/90">AI-Assisted Optical Extraction</span>
          </div>
          <div className="flex items-center justify-center gap-2.5 text-xs sm:text-sm text-[#CBD5E1] bg-white/[0.04] backdrop-blur-xs py-2.5 px-4 rounded-xl border border-white/5">
            <ShieldCheck className="h-4 w-4 text-[#F4C542] shrink-0" />
            <span className="font-medium text-white/90">Human Verification Safeguards</span>
          </div>
        </div>
      </div>
    </section>
  );
}
