"use client";

import { useActionState, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { login } from "@/actions/auth";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import Image from "next/image";
import { Eye, EyeOff, ArrowLeft, ShieldCheck, CheckCircle2, Lock, Mail } from "lucide-react";

function RegistrationNotice() {
  const searchParams = useSearchParams();
  const isRegisteredPending = searchParams.get("registered") === "pending";

  if (!isRegisteredPending) return null;

  return (
    <div
      role="status"
      className="mb-6 rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-xs sm:text-sm text-emerald-900 flex items-start gap-3 shadow-sm animate-in fade-in duration-200"
    >
      <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
      <div>
        <strong className="font-semibold block mb-0.5 text-emerald-950">
          Registration submitted successfully. Your account is awaiting Administrator approval.
        </strong>
        <p className="text-emerald-800 leading-relaxed text-xs">
          Your account is pending Administrator approval. You can sign in once your account has been approved.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction, isPending] = useActionState(
    async (prevState: any, formData: FormData) => {
      return await login(formData);
    },
    null
  );

  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-[#F4F7FB] selection:bg-[#F4C542] selection:text-[#0B1F33]">
      {/* LEFT BRANDING PANEL (Desktop: 45% - 50%, Mobile: compact header banner) */}
      <div className="w-full lg:w-[48%] xl:w-[45%] bg-gradient-to-br from-[#0B1F33] via-[#102A43] to-[#0B1F33] text-white p-6 sm:p-10 lg:p-14 flex flex-col justify-between shrink-0 border-b lg:border-b-0 lg:border-r border-white/10 relative overflow-hidden">
        {/* Subtle decorative glow */}
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-80 h-80 rounded-full bg-[#174EA6]/20 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-80 h-80 rounded-full bg-[#F4C542]/10 blur-3xl pointer-events-none" />

        {/* Top bar with Return to Home */}
        <div className="relative z-10 flex items-center justify-between">
          <Link
            href="/?view=landing"
            className="inline-flex items-center gap-2 text-xs sm:text-sm font-medium text-slate-300 hover:text-white transition-colors group focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4C542] rounded-md px-2 py-1"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
            <span>Back to Home</span>
          </Link>

          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#F4C542]/15 text-[#F4C542] border border-[#F4C542]/30">
            School ID: 300792
          </span>
        </div>

        {/* Branding Body */}
        <div className="relative z-10 my-8 lg:my-auto flex flex-col items-start max-w-lg">
          <div className="flex items-center gap-4 mb-6">
            <div className="relative h-16 w-16 sm:h-20 sm:w-20 shrink-0">
              <Image
                src="/images/tris-logo.png"
                alt="Taysan Resettlement Integrated School Official Seal"
                width={80}
                height={80}
                priority
                className="h-full w-full object-contain"
              />
            </div>
            <div>
              <span className="text-xs uppercase tracking-widest font-semibold text-[#F4C542]">
                Department of Education
              </span>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white leading-tight">
                AVV System
              </h1>
              <p className="text-xs sm:text-sm text-slate-300">
                Taysan Resettlement Integrated School
              </p>
            </div>
          </div>

          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight leading-snug mb-3">
            Automated Visual Validation & Academic Monitoring
          </h2>
          <p className="text-sm text-slate-300 leading-relaxed mb-6">
            Secure, verified evaluation of Senior High School SF9, SF10, and PSA records with automated grade recalculation, attendance monitoring, and graduation eligibility verification.
          </p>

          {/* Key Feature Badges (Desktop Only) */}
          <div className="hidden sm:grid grid-cols-2 gap-3 w-full pt-4 border-t border-white/10">
            <div className="flex items-center gap-2 text-xs text-slate-200">
              <CheckCircle2 className="h-4 w-4 text-[#F4C542] shrink-0" />
              <span>DepEd K–12 Grading Rules</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-200">
              <ShieldCheck className="h-4 w-4 text-[#F4C542] shrink-0" />
              <span>Institutional RBAC Roles</span>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="relative z-10 pt-4 hidden lg:block text-xs text-slate-400">
          <p>&copy; {new Date().getFullYear()} Taysan Resettlement Integrated School. All rights reserved.</p>
        </div>
      </div>

      {/* RIGHT SIGN-IN FORM PANEL */}
      <div className="flex-1 flex flex-col justify-center items-center px-4 py-8 sm:px-8 lg:px-12 xl:px-16">
        <div className="w-full max-w-[440px] bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-9 shadow-lg shadow-slate-200/50">
          <div className="mb-6">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#174EA6]/10 text-[#174EA6] mb-2">
              <Lock className="h-3 w-3" />
              Authorized Access
            </span>
            <h2 className="text-2xl font-bold tracking-tight text-[#0B1F33]">
              Sign In to Your Account
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Enter your authorized school credentials to access the validation portal.
            </p>
          </div>

          <Suspense fallback={null}>
            <RegistrationNotice />
          </Suspense>

          <form action={formAction} className="space-y-4">
            {/* Email Address */}
            <div>
              <label
                htmlFor="email"
                className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5"
              >
                Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Mail className="h-4 w-4" />
                </div>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="username"
                  spellCheck="false"
                  placeholder="teacher@deped.gov.ph"
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-slate-50/50 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:bg-white focus:border-[#174EA6] focus:ring-2 focus:ring-[#174EA6]/20 transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="current-password"
                  className="block text-xs sm:text-sm font-semibold text-slate-700"
                >
                  Password
                </label>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="h-4 w-4" />
                </div>
                <input
                  id="current-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className="w-full pl-9 pr-10 py-2.5 text-sm bg-slate-50/50 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:bg-white focus:border-[#174EA6] focus:ring-2 focus:ring-[#174EA6]/20 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 focus:outline-none"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Error Message */}
            {state?.error && (
              <div
                role="alert"
                className="rounded-lg bg-red-50 p-3 text-xs sm:text-sm text-red-700 border border-red-200 flex items-start gap-2"
              >
                <span className="font-semibold shrink-0">Error:</span>
                <span>{state.error}</span>
              </div>
            )}

            {/* Sign In Button */}
            <div className="pt-2">
              <Button
                type="submit"
                size="lg"
                className="w-full justify-center bg-[#174EA6] hover:bg-[#0B1F33] text-white font-semibold py-2.5 rounded-lg shadow-sm hover:shadow transition-all"
                disabled={isPending}
                isLoading={isPending}
              >
                {isPending ? "Signing in..." : "Sign In"}
              </Button>
            </div>
          </form>

          {/* Registration & Assistance Link */}
          <div className="mt-6 pt-5 border-t border-slate-100 text-center space-y-2">
            <p className="text-xs sm:text-sm text-slate-600">
              New faculty member?{" "}
              <Link
                href="/register"
                className="font-semibold text-[#174EA6] hover:text-[#0B1F33] hover:underline"
              >
                Register teacher account
              </Link>
            </p>
            <p className="text-[11px] text-slate-400">
              Registrations require administrative verification prior to dashboard access.
            </p>
          </div>
        </div>

        {/* Mobile footer notice */}
        <p className="mt-6 text-center text-xs text-slate-500 lg:hidden">
          &copy; {new Date().getFullYear()} Taysan Resettlement IS &bull; DepEd School ID: 300792
        </p>
      </div>
    </div>
  );
}
