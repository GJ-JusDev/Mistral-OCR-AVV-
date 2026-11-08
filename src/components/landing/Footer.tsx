import Image from "next/image";
import Link from "next/link";

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-[#0B1F33] text-[#CBD5E1] border-t border-white/10 relative z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8 lg:gap-12">
          
          {/* Brand & School Seal Column (Span 2) */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center gap-3">
              <div className="relative h-12 w-12 shrink-0 rounded-full bg-white/5 p-1 border border-white/10">
                <Image
                  src="/images/tris-logo.png"
                  alt="Taysan Resettlement Integrated School Official Seal"
                  width={48}
                  height={48}
                  className="h-full w-full object-contain"
                />
              </div>
              <div className="flex flex-col">
                <span className="text-white font-bold text-lg tracking-tight">
                  AVV System
                </span>
                <span className="text-xs text-[#CBD5E1] font-medium leading-tight">
                  Automated Visual Validation System
                </span>
              </div>
            </div>

            <p className="text-sm text-[#CBD5E1] leading-relaxed max-w-sm">
              <strong className="text-white">Taysan Resettlement Integrated School</strong>
              <br />
              Taysan, Legazpi City, Albay, Bicol Region
              <br />
              <span className="text-xs text-[#CBD5E1]/70">DepEd Division of Legazpi City</span>
            </p>

            <p className="text-xs text-[#CBD5E1]/60 leading-relaxed">
              An AI-assisted document validation platform for Senior High School SF9 report cards,
              SF10 permanent records, and supported student credentials.
            </p>
          </div>

          {/* Quick Navigation Links */}
          <div>
            <h4 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">
              Navigation
            </h4>
            <ul className="space-y-2.5 text-sm">
              <li>
                <a href="#home" className="hover:text-white transition-colors">
                  Home
                </a>
              </li>
              <li>
                <a href="#features" className="hover:text-white transition-colors">
                  Features
                </a>
              </li>
              <li>
                <a href="#how-it-works" className="hover:text-white transition-colors">
                  How It Works
                </a>
              </li>
              <li>
                <a href="#about" className="hover:text-white transition-colors">
                  About the System
                </a>
              </li>
            </ul>
          </div>

          {/* Portal Access Links */}
          <div>
            <h4 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">
              Portal Access
            </h4>
            <ul className="space-y-2.5 text-sm">
              <li>
                <Link href="/login" className="hover:text-white transition-colors">
                  Sign In to Account
                </Link>
              </li>
              <li>
                <Link href="/register" className="hover:text-white transition-colors">
                  Faculty Account Registration
                </Link>
              </li>
              <li>
                <Link href="/terms" className="hover:text-white transition-colors">
                  Terms and Conditions
                </Link>
              </li>
            </ul>
          </div>

          {/* Scope & Institutional Standards */}
          <div>
            <h4 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">
              Compliance
            </h4>
            <p className="text-xs text-[#CBD5E1]/80 leading-relaxed">
              Designed in strict alignment with DepEd Order standards for Senior High School academic reporting, 
              preserving human verification safeguards for all educational decisions.
            </p>
            <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-[11px] text-[#F4C542]">
              <span>Grade 11 & 12 Scope</span>
            </div>
          </div>

        </div>

        {/* Bottom Bar: Copyright Notice */}
        <div className="mt-12 pt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#CBD5E1]/70">
          <p>
            © {currentYear} Taysan Resettlement Integrated School. All rights reserved.
          </p>
          <p className="text-center sm:text-right">
            Automated Visual Validation System (AVV) • Institutional Edition
          </p>
        </div>
      </div>
    </footer>
  );
}
