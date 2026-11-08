import Link from "next/link";
import { ArrowRight, LogIn, Sparkles } from "lucide-react";

export default function CtaSection() {
  return (
    <section className="py-20 sm:py-24 bg-gradient-to-b from-[#102A43] via-[#0B1F33] to-[#0B1F33] text-white relative overflow-hidden border-t border-white/10">
      {/* Decorative radial gradients */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-[#174EA6]/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[200px] bg-[#F4C542]/10 rounded-full blur-[80px] pointer-events-none" />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
        <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-[#F4C542]/15 text-[#F4C542] border border-[#F4C542]/30 mb-6 shadow-sm">
          <Sparkles className="h-3.5 w-3.5" />
          <span>Taysan Resettlement Integrated School</span>
        </div>

        <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-white leading-tight">
          Simplify School Form Validation
        </h2>

        <p className="mt-5 text-base sm:text-xl text-[#CBD5E1] max-w-2xl mx-auto leading-relaxed">
          Make document verification more organized, transparent, and efficient with AVV System.
        </p>

        {/* Buttons linking to existing application routes */}
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/register"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-semibold text-white bg-[#174EA6] hover:bg-[#123e85] active:scale-[0.98] rounded-full shadow-xl shadow-[#174EA6]/30 border border-white/15 hover:border-white/30 transition-all duration-200 group"
          >
            <span>Get Started</span>
            <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform duration-200" />
          </Link>

          <Link
            href="/login"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-medium text-white bg-white/10 hover:bg-white/15 active:scale-[0.98] rounded-full backdrop-blur-md border border-white/20 hover:border-white/30 transition-all duration-200"
          >
            <LogIn className="h-4 w-4 text-[#F4C542]" />
            <span>Login to Portal</span>
          </Link>
        </div>

        <p className="mt-8 text-xs text-[#CBD5E1]/70">
          Authorized access strictly for TRIS faculty, staff, and institutional administrators.
        </p>
      </div>
    </section>
  );
}
