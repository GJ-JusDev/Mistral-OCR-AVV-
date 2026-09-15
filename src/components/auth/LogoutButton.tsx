"use client";

import { useActionState } from "react";
import { logout } from "@/actions/auth";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  const [_, formAction, isPending] = useActionState(
    async () => {
      await logout();
    },
    null
  );

  return (
    <form action={formAction} className="w-full">
      <button 
        type="submit" 
        disabled={isPending}
        className="flex w-full items-center gap-3 px-3 py-2 text-sm font-medium text-[#495057] hover:bg-[#e9ecef] hover:text-[#212529] transition-none rounded-sm"
      >
        <LogOut className="h-4 w-4" />
        <span>{isPending ? "Signing out..." : "Sign out"}</span>
      </button>
    </form>
  );
}