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
        className="flex w-full items-center gap-2.5 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
      >
        <LogOut className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-white" />
        <span>{isPending ? "Signing out..." : "Sign Out"}</span>
      </button>
    </form>
  );
}
