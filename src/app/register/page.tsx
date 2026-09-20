"use client";

import { useActionState, useState } from "react";
import { register } from "@/actions/auth";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import Link from "next/link";
import { GraduationCap, Eye, EyeOff } from "lucide-react";

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
    <div className="flex min-h-screen flex-col items-center bg-[#f8f9fa] py-12 px-4 sm:pt-16">
      <div className="mb-10 flex flex-col items-center text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-sm bg-[#212529] text-white shadow-sm mb-5">
          <GraduationCap className="h-8 w-8" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-[#212529]">Teacher Registration</h1>
        <p className="mt-3 text-base text-[#6c757d]">Create your account to start validating documents</p>
      </div>

      <Card padding="lg" className="w-full max-w-lg bg-white border-[#dee2e6] shadow-sm">
        <form action={formAction} className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[0.95rem] font-medium text-[#495057] mb-2">First Name</label>
              <input name="firstName" type="text" required className="w-full rounded-sm border border-[#ced4da] px-4 py-3 text-base text-[#212529] focus:border-[#86b7fe] focus:outline-none focus:ring-1 focus:ring-[#86b7fe] transition-colors" />
            </div>
            <div>
              <label className="block text-[0.95rem] font-medium text-[#495057] mb-2">Middle Name</label>
              <input name="middleName" type="text" className="w-full rounded-sm border border-[#ced4da] px-4 py-3 text-base text-[#212529] focus:border-[#86b7fe] focus:outline-none focus:ring-1 focus:ring-[#86b7fe] transition-colors" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[0.95rem] font-medium text-[#495057] mb-2">Last Name</label>
              <input name="lastName" type="text" required className="w-full rounded-sm border border-[#ced4da] px-4 py-3 text-base text-[#212529] focus:border-[#86b7fe] focus:outline-none focus:ring-1 focus:ring-[#86b7fe] transition-colors" />
            </div>
            <div>
              <label className="block text-[0.95rem] font-medium text-[#495057] mb-2">Name Extension (Optional)</label>
              <input name="nameExtension" type="text" placeholder="e.g. Jr., Sr., III" className="w-full rounded-sm border border-[#ced4da] px-4 py-3 text-base text-[#212529] focus:border-[#86b7fe] focus:outline-none focus:ring-1 focus:ring-[#86b7fe] transition-colors" />
            </div>
          </div>
          <div>
            <label className="block text-[0.95rem] font-medium text-[#495057] mb-2">PRC Information</label>
            <input 
              name="prc" 
              type="text" 
              placeholder="7-digit PRC License Number" 
              required 
              pattern="\d{7}"
              title="PRC License Number must be exactly 7 digits long and contain only numbers."
              maxLength={7}
              className="w-full rounded-sm border border-[#ced4da] px-4 py-3 text-base text-[#212529] focus:border-[#86b7fe] focus:outline-none focus:ring-1 focus:ring-[#86b7fe] transition-colors" 
            />
            <p className="mt-2 text-sm text-[#6c757d]">Required for Teacher verification.</p>
          </div>
          <div>
            <label className="block text-[0.95rem] font-medium text-[#495057] mb-2">Email address</label>
            <input 
              name="email" 
              type="email" 
              required 
              className="w-full rounded-sm border border-[#ced4da] px-4 py-3 text-base text-[#212529] focus:border-[#86b7fe] focus:outline-none focus:ring-1 focus:ring-[#86b7fe] transition-colors"
            />
          </div>
          <div>
            <label className="block text-[0.95rem] font-medium text-[#495057] mb-2">Password</label>
            <div className="relative">
              <input 
                name="password" 
                type={showPassword ? "text" : "password"} 
                required 
                minLength={8}
                pattern="(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{8,}"
                title="Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number."
                className="w-full rounded-sm border border-[#ced4da] px-4 py-3 pr-10 text-base text-[#212529] focus:border-[#86b7fe] focus:outline-none focus:ring-1 focus:ring-[#86b7fe] transition-colors"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-[#6c757d] hover:text-[#212529]"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          
          {state?.error && (
            <div className="rounded-sm bg-red-50 p-4 text-[0.95rem] text-red-700 border border-red-200">
              {state.error}
            </div>
          )}

          <div className="flex items-start gap-2">
            <input 
              type="checkbox" 
              id="terms" 
              name="terms" 
              required 
              className="mt-1 h-4 w-4 rounded border-gray-300 text-[#212529] focus:ring-[#86b7fe]"
            />
            <label htmlFor="terms" className="text-sm text-[#495057]">
              I agree to the <button type="button" onClick={() => setIsTermsOpen(true)} className="font-medium text-[#212529] hover:underline bg-transparent border-none p-0 cursor-pointer">Terms and Conditions</button>, including the developer liability disclaimer.
            </label>
          </div>

          <Button type="submit" size="lg" className="w-full" disabled={isPending}>
            {isPending ? "Registering..." : "Create account"}
          </Button>
        </form>
        
        <p className="mt-8 text-center text-[0.95rem] text-[#6c757d]">
          Already registered? <Link href="/login" className="font-medium text-[#212529] hover:underline">Sign in</Link>
        </p>
      </Card>

      <div className="mt-12 text-center text-sm text-[#6c757d] pb-8">
        <p>&copy; {new Date().getFullYear()} All rights reserved. Taysan Resettlement Integrated School.</p>
      </div>

      {isTermsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 px-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 max-h-[90vh] flex flex-col">
            <h2 className="text-xl font-bold mb-4 text-[#212529]">Terms and Conditions</h2>
            <div className="flex-1 overflow-y-auto pr-2 text-sm text-[#495057] space-y-4">
              <p>
                <strong>1. Acceptance of Terms:</strong> By registering, you agree to use this system exclusively for official school validation purposes.
              </p>
              <p>
                <strong>2. Data Privacy (DepEd Compliance):</strong> In strict compliance with the Data Privacy Act of 2012 (RA 10173) and DepEd data privacy policies, all student records, particularly grades and LRNs, are highly confidential. No grades or student information shall be disclosed, leaked, or thrown out carelessly. You are strictly prohibited from sharing extracted data outside authorized school channels.
              </p>
              <p>
                <strong>3. Verification Duty:</strong> Automated extractions must be verified. You agree to manually review flagged documents and ensure accuracy before final approval.
              </p>
              <p>
                <strong>4. Developer Liability Disclaimer:</strong> The Automated Visual Validation System (AVVS) is provided "as is". The developers are not liable for any discrepancies, errors in extraction, or subsequent issues arising from unverified data. Final data accuracy relies on the human reviewer.
              </p>
            </div>
            <div className="mt-6 flex justify-end">
              <Button type="button" onClick={() => setIsTermsOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
