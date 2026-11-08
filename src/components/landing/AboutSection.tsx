import Image from "next/image";
import { Shield, BookOpen, Users, Sparkles, CheckCircle2 } from "lucide-react";

export default function AboutSection() {
  return (
    <section id="about" className="py-24 bg-[#102A43] text-white relative overflow-hidden border-t border-white/10">
      {/* Subtle background glow */}
      <div className="absolute top-1/3 right-0 w-96 h-96 bg-[#174EA6]/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          
          {/* Left Column: Official School Seal Showcase */}
          <div className="lg:col-span-5 flex flex-col items-center text-center">
            <div className="relative group">
              {/* Pedestal / Halo ring */}
              <div className="absolute -inset-4 rounded-full bg-gradient-to-tr from-[#174EA6]/30 via-[#F4C542]/20 to-transparent blur-xl opacity-75 group-hover:opacity-100 transition-opacity" />
              
              <div className="relative h-56 w-56 sm:h-64 sm:w-64 rounded-full bg-[#0B1F33] p-4 border-2 border-white/15 shadow-2xl shadow-black/40 flex items-center justify-center">
                <Image
                  src="/images/tris-logo.png"
                  alt="Taysan Resettlement Integrated School Official Seal"
                  width={220}
                  height={220}
                  priority
                  className="h-full w-full object-contain drop-shadow-[0_4px_16px_rgba(0,0,0,0.5)]"
                />
              </div>
            </div>

            {/* School Details */}
            <div className="mt-6 text-center">
              <h3 className="text-xl font-bold text-white tracking-tight">
                Taysan Resettlement Integrated School
              </h3>
              <p className="text-sm font-medium text-[#F4C542] mt-1">
                Official School Seal • Established 2008
              </p>
              <p className="text-xs text-[#CBD5E1] mt-1">
                Taysan, Legazpi City, Albay, Bicol Region
              </p>
              <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] text-[#CBD5E1]">
                <span>DepEd Division of Legazpi City</span>
              </div>
            </div>
          </div>

          {/* Right Column: System Narrative & Educational Purpose */}
          <div className="lg:col-span-7">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-[#F4C542]/15 text-[#F4C542] border border-[#F4C542]/30 mb-4">
              School System Identity
            </div>

            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">
              About the Automated Visual Validation System
            </h2>

            <p className="mt-5 text-base sm:text-lg text-[#CBD5E1] leading-relaxed">
              The <strong className="text-white font-semibold">Automated Visual Validation (AVV) System</strong> is 
              an assistive educational platform engineered specifically for <strong className="text-white font-semibold">Taysan Resettlement Integrated School (TRIS)</strong>. 
              The system assists authorized school personnel with Senior High School record verification 
              and significantly reduces repetitive manual checking across DepEd School Form 9 (SF9) report cards, 
              School Form 10 (SF10) permanent records, and supporting student credentials.
            </p>

            <div className="mt-6 p-5 rounded-2xl bg-[#0B1F33]/80 border border-white/10 text-sm text-[#CBD5E1] leading-relaxed">
              <div className="flex items-start gap-3">
                <Shield className="h-5 w-5 text-[#F4C542] shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-white mb-1">
                    Human-in-the-Loop Assistive Technology
                  </h4>
                  <p>
                    The AVV System is designed to support and empower educators, <strong>not replace them</strong>. 
                    Official academic grading and student eligibility decisions require professional judgment and institutional authority. 
                    Every optical character extraction remains candidate data until verified and approved by authorized teachers and school officials.
                  </p>
                </div>
              </div>
            </div>

            {/* Core Values / Institutional Pillars */}
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-white/[0.03] border border-white/5">
                <CheckCircle2 className="h-5 w-5 text-[#F4C542] shrink-0 mt-0.5" />
                <div>
                  <h5 className="text-sm font-semibold text-white">Objective Discrepancy Detection</h5>
                  <p className="text-xs text-[#CBD5E1] mt-0.5">Identifies borderline grades and mismatched LRNs for immediate human review.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-white/[0.03] border border-white/5">
                <CheckCircle2 className="h-5 w-5 text-[#F4C542] shrink-0 mt-0.5" />
                <div>
                  <h5 className="text-sm font-semibold text-white">Strict Role-Based Integrity</h5>
                  <p className="text-xs text-[#CBD5E1] mt-0.5">Separate workflows for encoding teachers and executive school head oversight.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-white/[0.03] border border-white/5">
                <CheckCircle2 className="h-5 w-5 text-[#F4C542] shrink-0 mt-0.5" />
                <div>
                  <h5 className="text-sm font-semibold text-white">DepEd Curriculum Alignment</h5>
                  <p className="text-xs text-[#CBD5E1] mt-0.5">Tailored directly to K-12 Senior High School semestral grading schemes.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-white/[0.03] border border-white/5">
                <CheckCircle2 className="h-5 w-5 text-[#F4C542] shrink-0 mt-0.5" />
                <div>
                  <h5 className="text-sm font-semibold text-white">Data Privacy Protection</h5>
                  <p className="text-xs text-[#CBD5E1] mt-0.5">Secure, authenticated access strictly confined to authorized TRIS educators.</p>
                </div>
              </div>
            </div>

          </div>

        </div>
      </div>
    </section>
  );
}
