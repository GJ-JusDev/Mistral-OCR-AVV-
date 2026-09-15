"use client";

import { useActionState } from "react";
import { register } from "@/actions/auth";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import Link from "next/link";
import { GraduationCap } from "lucide-react";

export default function RegisterPage() {
  const [state, formAction, isPending] = useActionState(
    async (prevState: any, formData: FormData) => {
      return await register(formData);
    },
    null
  );

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f8f9fa] px-4 py-12">
      <div className="mb-10 flex flex-col items-center text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-sm bg-[#212529] text-white shadow-sm mb-5">
          <GraduationCap className="h-8 w-8" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-[#212529]">Teacher Registration</h1>
        <p className="mt-3 text-base text-[#6c757d]">Create your account to start validating documents</p>
      </div>

      <Card padding="lg" className="w-full max-w-lg bg-white border-[#dee2e6] shadow-sm">
        <form action={formAction} className="space-y-6">
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
            <input 
              name="password" 
              type="password" 
              required 
              className="w-full rounded-sm border border-[#ced4da] px-4 py-3 text-base text-[#212529] focus:border-[#86b7fe] focus:outline-none focus:ring-1 focus:ring-[#86b7fe] transition-colors"
            />
          </div>
          <div>
            <label className="block text-[0.95rem] font-medium text-[#495057] mb-2">Teacher Access Code</label>
            <input 
              name="accessCode" 
              type="text"
              placeholder="E.g., TEACHER2026"
              required 
              className="w-full rounded-sm border border-[#ced4da] px-4 py-3 text-base text-[#212529] focus:border-[#86b7fe] focus:outline-none focus:ring-1 focus:ring-[#86b7fe] transition-colors"
            />
            <p className="mt-2 text-sm text-[#6c757d]">Provided by your school administrator.</p>
          </div>
          
          {state?.error && (
            <div className="rounded-sm bg-red-50 p-4 text-[0.95rem] text-red-700 border border-red-200">
              {state.error}
            </div>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={isPending}>
            {isPending ? "Registering..." : "Create account"}
          </Button>
        </form>
        
        <p className="mt-8 text-center text-[0.95rem] text-[#6c757d]">
          Already registered? <Link href="/login" className="font-medium text-[#212529] hover:underline">Sign in</Link>
        </p>
      </Card>
    </div>
  );
}
