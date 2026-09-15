"use client";

import { useActionState } from "react";
import { login } from "@/actions/auth";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import Link from "next/link";
import { GraduationCap } from "lucide-react";

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(
    async (prevState: any, formData: FormData) => {
      return await login(formData);
    },
    null
  );

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f8f9fa] px-4 py-12">
      <div className="mb-10 flex flex-col items-center text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-sm bg-[#212529] text-white shadow-sm mb-5">
          <GraduationCap className="h-8 w-8" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-[#212529]">Sign in to DocuValidate</h1>
        <p className="mt-3 text-base text-[#6c757d]">School document validation system</p>
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
          
          {state?.error && (
            <div className="rounded-sm bg-red-50 p-4 text-[0.95rem] text-red-700 border border-red-200">
              {state.error}
            </div>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={isPending}>
            {isPending ? "Signing in..." : "Sign in"}
          </Button>
        </form>
        
        <p className="mt-8 text-center text-[0.95rem] text-[#6c757d]">
          Not a teacher yet? <Link href="/register" className="font-medium text-[#212529] hover:underline">Register account</Link>
        </p>
      </Card>
    </div>
  );
}
