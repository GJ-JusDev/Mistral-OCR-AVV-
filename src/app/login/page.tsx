"use client";

import { useActionState, useState } from "react";
import { login } from "@/actions/auth";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import Link from "next/link";
import { GraduationCap, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
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
        <h1 className="text-3xl font-semibold tracking-tight text-[#212529]">Sign in to Automated Visual Validation System</h1>
        <p className="mt-3 text-base text-[#6c757d]">Taysan Resettlement Integrated School</p>
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
            <div className="relative">
              <input 
                name="password" 
                type={showPassword ? "text" : "password"} 
                required 
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

          <Button type="submit" size="lg" className="w-full" disabled={isPending}>
            {isPending ? "Signing in..." : "Sign in"}
          </Button>
        </form>
        
        <p className="mt-8 text-center text-[0.95rem] text-[#6c757d]">
          Not a teacher yet? <Link href="/register" className="font-medium text-[#212529] hover:underline">Register account</Link>
        </p>
      </Card>

      <div className="mt-12 text-center text-sm text-[#6c757d]">
        <p>&copy; {new Date().getFullYear()} All rights reserved. Taysan Resettlement Integrated School.</p>
      </div>
    </div>
  );
}
