import { UploadCloud, Cpu, UserCheck, ShieldCheck, ArrowRight, ChevronRight } from "lucide-react";

const steps = [
  {
    number: "01",
    stepTag: "Step 1",
    title: "Step 1 — Upload School Forms",
    actor: "Authorized Teachers",
    description: "Teachers upload supported school forms or scanned documents.",
    icon: UploadCloud,
    details: "Supports high-resolution camera capture or multi-page uploads for SF9, SF10, and PSA Birth Certificates.",
  },
  {
    number: "02",
    stepTag: "Step 2",
    title: "Step 2 — AI-Assisted Extraction",
    actor: "Cloud OCR Engine",
    description: "The system extracts student information, grades, and supported attendance data.",
    icon: Cpu,
    details: "Hybrid Azure & Mistral OCR extracts semestral subject matrices, attendance tables, and identity fields.",
  },
  {
    number: "03",
    stepTag: "Step 3",
    title: "Step 3 — Review & Validate",
    actor: "Teacher Verification",
    description: "Authorized Teachers verify extracted values and resolve flagged discrepancies.",
    icon: UserCheck,
    details: "Side-by-side comparison highlights borderline marks, mismatches, or unreadable entries for teacher confirmation.",
  },
  {
    number: "04",
    stepTag: "Step 4",
    title: "Step 4 — School-Level Review",
    actor: "School Principal",
    description: "The Principal reviews academic, attendance, and document completeness indicators for authorized eligibility decisions.",
    icon: ShieldCheck,
    details: "Executive overview confirms graduation readiness, remedial resolutions, and institutional permanent records.",
  },
];

export default function HowItWorksSection() {
  return (
    <section id="how-it-works" className="py-24 bg-[#0B1F33] text-white relative overflow-hidden border-t border-white/10">
      {/* Background illumination */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-[#174EA6]/10 rounded-full blur-[140px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16 sm:mb-20">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-[#174EA6]/20 text-[#86b7fe] border border-[#174EA6]/40 mb-4">
            Validation Workflow
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white">
            How the AVV System Works
          </h2>
          <p className="mt-4 text-base sm:text-lg text-[#CBD5E1] leading-relaxed">
            A transparent four-step pipeline combining automated optical extraction with rigorous,
            role-based institutional oversight at every stage.
          </p>
        </div>

        {/* 4 Steps Container */}
        <div className="relative">
          {/* Desktop Directional Connector Line (Behind cards) */}
          <div className="hidden lg:block absolute top-1/2 left-[12%] right-[12%] -translate-y-12 h-0.5 border-t-2 border-dashed border-[#174EA6]/40 pointer-events-none z-0" />

          {/* Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8 relative z-10">
            {steps.map((step, idx) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.number}
                  className="relative flex flex-col justify-between bg-[#102A43]/90 rounded-2xl p-6 sm:p-7 border border-white/10 hover:border-[#F4C542]/50 hover:bg-[#102A43] transition-all duration-300 shadow-xl hover:shadow-2xl hover:shadow-[#174EA6]/20 hover:-translate-y-1 group"
                >
                  {/* Top Bar: Step Number & Actor Tag */}
                  <div>
                    <div className="flex items-center justify-between mb-5">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F4C542]/15 text-[#F4C542] border border-[#F4C542]/30 font-bold font-mono text-sm group-hover:scale-105 transition-transform">
                        {step.number}
                      </span>
                      <span className="text-[11px] font-semibold text-[#86b7fe] uppercase tracking-wide bg-[#174EA6]/20 px-2.5 py-1 rounded-full border border-[#174EA6]/30">
                        {step.actor}
                      </span>
                    </div>

                    {/* Step Icon */}
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0B1F33] border border-white/10 text-white mb-5 group-hover:border-[#174EA6] group-hover:text-[#F4C542] transition-colors shadow-inner">
                      <Icon className="h-7 w-7 transition-transform group-hover:scale-110 duration-200" />
                    </div>

                    {/* Step Title & Description */}
                    <h3 className="text-xl font-bold text-white mb-2.5 leading-snug">
                      {step.title}
                    </h3>
                    <p className="text-sm font-medium text-white/90 leading-relaxed mb-4">
                      {step.description}
                    </p>
                  </div>

                  {/* Bottom: Technical Details */}
                  <div className="pt-4 border-t border-white/5">
                    <p className="text-xs text-[#CBD5E1] leading-relaxed">
                      {step.details}
                    </p>
                  </div>

                  {/* Desktop Directional Arrow between cards (except last) */}
                  {idx < steps.length - 1 && (
                    <div className="hidden lg:flex absolute -right-4 top-1/2 -translate-y-6 z-20 h-8 w-8 items-center justify-center rounded-full bg-[#174EA6] border-2 border-[#0B1F33] text-white shadow-md">
                      <ChevronRight className="h-4 w-4" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
