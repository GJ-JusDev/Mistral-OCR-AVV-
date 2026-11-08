"use client";

import { useActionState, useState } from "react";
import { register } from "@/actions/auth";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import Image from "next/image";
import { 
  Eye, 
  EyeOff, 
  ArrowLeft, 
  ShieldCheck, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  UserPlus, 
  Lock, 
  Mail, 
  FileText,
  X
} from "lucide-react";

export default function RegisterPage() {
  const [isTermsOpen, setIsTermsOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction, isPending] = useActionState(
    async (prevState: any, formData: FormData) => {
      return await register(formData);
    },
    null
  );

  return (
    <div className="min-h-screen w-full bg-[#F4F7FB] selection:bg-[#F4C542] selection:text-[#0B1F33] py-8 sm:py-12 px-4 sm:px-6 lg:px-8">
      {/* Top Header Navigation */}
      <div className="max-w-2xl mx-auto flex items-center justify-between mb-6">
        <Link
          href="/?view=landing"
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-600 hover:text-[#174EA6] transition-colors group focus:outline-none focus-visible:ring-2 focus-visible:ring-[#174EA6] rounded-md px-2 py-1"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
          <span>Return to Landing Page</span>
        </Link>

        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#174EA6]/10 text-[#174EA6] border border-[#174EA6]/20">
          DepEd School ID: 300792
        </span>
      </div>

      {/* Main Registration Card */}
      <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-10 shadow-xl shadow-slate-200/60">
        {/* Institutional Branding Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 pb-6 border-b border-slate-100">
          <div className="relative h-14 w-14 sm:h-16 sm:w-16 shrink-0 rounded-2xl bg-[#0B1F33] p-1 border border-slate-200 shadow-md">
            <Image
              src="/images/tris-logo.png"
              alt="Taysan Resettlement Integrated School Official Seal"
              width={64}
              height={64}
              priority
              className="h-full w-full object-contain"
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0B1F33]">
                Teacher Registration
              </h1>
              <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-[#F4C542]/20 text-amber-800 border border-[#F4C542]/40">
                Senior High School
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Taysan Resettlement Integrated School &bull; AVV System
            </p>
          </div>
        </div>

        {/* Admin Approval Notice Banner */}
        <div className="mt-5 p-4 rounded-xl bg-amber-50/80 border border-amber-200 flex items-start gap-3">
          <Clock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs sm:text-sm text-amber-900 leading-relaxed">
            <strong className="font-semibold block mb-0.5">Administrator Approval Required:</strong>
            Submitted teacher accounts are created in a <span className="font-semibold text-amber-950">Pending</span> status. Your account must be verified and approved by a School Administrator before you can sign in to the validation portal.
          </div>
        </div>

        {/* Registration Form */}
        <form action={formAction} className="mt-6 space-y-6">
          {/* SECTION 1: Personal Information */}
          <div className="space-y-4">
            <div className="border-b border-slate-100 pb-2">
              <h2 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-[#0B1F33]">
                1. Faculty Information
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Enter your official name as registered with DepEd.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="firstName"
                  className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5"
                >
                  First Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="firstName"
                  name="firstName"
                  type="text"
                  required
                  placeholder="e.g. Maria"
                  className="w-full px-3 py-2 text-sm bg-slate-50/50 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:bg-white focus:border-[#174EA6] focus:ring-2 focus:ring-[#174EA6]/20 transition-all"
                />
              </div>

              <div>
                <label
                  htmlFor="middleName"
                  className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5"
                >
                  Middle Name <span className="text-slate-400 text-xs font-normal">(Optional)</span>
                </label>
                <input
                  id="middleName"
                  name="middleName"
                  type="text"
                  placeholder="e.g. Santos"
                  className="w-full px-3 py-2 text-sm bg-slate-50/50 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:bg-white focus:border-[#174EA6] focus:ring-2 focus:ring-[#174EA6]/20 transition-all"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="lastName"
                  className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5"
                >
                  Last Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="lastName"
                  name="lastName"
                  type="text"
                  required
                  placeholder="e.g. Dela Cruz"
                  className="w-full px-3 py-2 text-sm bg-slate-50/50 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:bg-white focus:border-[#174EA6] focus:ring-2 focus:ring-[#174EA6]/20 transition-all"
                />
              </div>

              <div>
                <label
                  htmlFor="nameExtension"
                  className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5"
                >
                  Name Extension <span className="text-slate-400 text-xs font-normal">(Optional)</span>
                </label>
                <input
                  id="nameExtension"
                  name="nameExtension"
                  type="text"
                  placeholder="e.g. Jr., III, LPT"
                  className="w-full px-3 py-2 text-sm bg-slate-50/50 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:bg-white focus:border-[#174EA6] focus:ring-2 focus:ring-[#174EA6]/20 transition-all"
                />
              </div>
            </div>
          </div>

          {/* SECTION 2: Account Credentials */}
          <div className="space-y-4 pt-2">
            <div className="border-b border-slate-100 pb-2">
              <h2 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-[#0B1F33]">
                2. Account Credentials
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Set up your official login credentials.
              </p>
            </div>

            <div>
              <label
                htmlFor="reg-email"
                className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5"
              >
                Official Email Address <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Mail className="h-4 w-4" />
                </div>
                <input
                  id="reg-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="username"
                  spellCheck="false"
                  placeholder="teacher@deped.gov.ph"
                  className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50/50 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:bg-white focus:border-[#174EA6] focus:ring-2 focus:ring-[#174EA6]/20 transition-all"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="new-password"
                className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5"
              >
                Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="h-4 w-4" />
                </div>
                <input
                  id="new-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  pattern="(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{8,}"
                  title="Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number."
                  autoComplete="new-password"
                  placeholder="Minimum 8 characters with upper, lower, & number"
                  className="w-full pl-9 pr-10 py-2 text-sm bg-slate-50/50 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:bg-white focus:border-[#174EA6] focus:ring-2 focus:ring-[#174EA6]/20 transition-all"
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
              <p className="mt-1 text-[11px] text-slate-500">
                Must be at least 8 characters and include uppercase, lowercase, and a number.
              </p>
            </div>
          </div>

          {/* Error Message */}
          {state?.error && (
            <div
              role="alert"
              className="rounded-lg bg-red-50 p-3.5 text-xs sm:text-sm text-red-700 border border-red-200 flex items-start gap-2"
            >
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
              <div>
                <span className="font-semibold">Registration Error: </span>
                <span>{state.error}</span>
              </div>
            </div>
          )}

          {/* SECTION 3: Terms and Conditions */}
          <div className="pt-2">
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200">
              <input
                type="checkbox"
                id="terms"
                name="terms"
                required
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#174EA6] focus:ring-[#174EA6]"
              />
              <label htmlFor="terms" className="text-xs sm:text-sm text-slate-700 leading-snug">
                I agree to the{" "}
                <button
                  type="button"
                  onClick={() => setIsTermsOpen(true)}
                  className="font-semibold text-[#174EA6] hover:underline bg-transparent border-none p-0 inline cursor-pointer"
                >
                  Terms and Conditions
                </button>
                , including the developer liability disclaimer and DepEd data privacy responsibilities.
              </label>
            </div>
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <Button
              type="submit"
              size="lg"
              className="w-full justify-center bg-[#174EA6] hover:bg-[#0B1F33] text-white font-semibold py-2.5 rounded-lg shadow-sm hover:shadow transition-all"
              disabled={isPending}
              isLoading={isPending}
            >
              {isPending ? "Submitting Registration..." : "Create account"}
            </Button>
          </div>
        </form>

        {/* Existing Account Link */}
        <div className="mt-6 pt-5 border-t border-slate-100 text-center">
          <p className="text-xs sm:text-sm text-slate-600">
            Already have an approved account?{" "}
            <Link
              href="/login"
              className="font-semibold text-[#174EA6] hover:text-[#0B1F33] hover:underline"
            >
              Sign in to AVV
            </Link>
          </p>
        </div>
      </div>

      {/* Terms and Conditions Modal */}
      {isTermsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1F33]/70 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg p-6 max-h-[85vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-[#174EA6]" />
                <h3 className="text-base font-bold text-[#0B1F33]">Terms and Conditions</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsTermsOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
                aria-label="Close terms dialog"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 text-xs sm:text-sm text-slate-600 space-y-4">
              <div>
                <h4 className="font-semibold text-slate-800">1. Educational System Authorization</h4>
                <p className="mt-1 leading-relaxed">
                  The Automated Visual Validation System (AVV) is an institutional tool for Taysan Resettlement Integrated School (School ID: 300792). Only authorized educators and school heads may process official Senior High School student records.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                <h4 className="font-bold text-amber-900">2. Developer Liability & Indemnification</h4>
                <p className="mt-1 text-amber-900 text-xs leading-relaxed">
                  <strong>Notice:</strong> The original software developers are NOT liable for any damages, regulatory fines, data breaches, or legal repercussions arising from operational use. The system is managed and operated by the school administration.
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-slate-800">3. DepEd Grading & Document Verification</h4>
                <p className="mt-1 leading-relaxed">
                  Users are responsible for conducting manual reviews on flagged OCR extractions before approving academic progression or graduation recommendations.
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <Button
                type="button"
                variant="primary"
                onClick={() => setIsTermsOpen(false)}
              >
                I Understand and Accept
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Footer info */}
      <div className="mt-8 text-center text-xs text-slate-500">
        <p>&copy; {new Date().getFullYear()} Automated Visual Validation System &bull; Taysan Resettlement Integrated School</p>
      </div>
    </div>
  );
}
