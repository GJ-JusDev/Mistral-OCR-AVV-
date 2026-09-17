"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Moon, Sun, Lock } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

export default function SettingsClient() {
  const [isDark, setIsDark] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const supabase = createClient();

  useEffect(() => {
    // Check local storage or document class for initial state
    if (typeof window !== "undefined") {
      const isDarkMode = document.documentElement.classList.contains("dark") || 
                         localStorage.getItem("theme") === "dark";
      setIsDark(isDarkMode);
      if (isDarkMode) {
        document.documentElement.classList.add("dark");
      }
    }
  }, []);

  const toggleDarkMode = () => {
    const nextDark = !isDark;
    setIsDark(nextDark);
    if (nextDark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast({ title: "Error", description: "Passwords do not match", variant: "error" });
      return;
    }
    if (password.length < 6) {
      toast({ title: "Error", description: "Password must be at least 6 characters", variant: "error" });
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "error" });
    } else {
      toast({ title: "Success", description: "Password updated successfully", variant: "success" });
      setPassword("");
      setConfirmPassword("");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between p-4 border border-slate-200 dark:border-slate-800 rounded-md bg-white dark:bg-[#1e1e1e]">
        <div>
          <h4 className="font-medium text-slate-900 dark:text-slate-100">Appearance</h4>
          <p className="text-sm text-slate-500 dark:text-slate-400">Toggle between light and dark mode</p>
        </div>
        <Button onClick={toggleDarkMode} variant="outline" className="flex items-center gap-2 border-slate-200 dark:border-slate-700">
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {isDark ? "Light Mode" : "Dark Mode"}
        </Button>
      </div>

      <div className="p-4 border border-slate-200 dark:border-slate-800 rounded-md bg-white dark:bg-[#1e1e1e]">
        <div className="mb-4">
          <h4 className="font-medium text-red-600 dark:text-red-500 flex items-center gap-2">
            <Lock className="h-4 w-4" /> Change Password
          </h4>
          <p className="text-sm text-slate-500 dark:text-slate-400">Update your account password</p>
        </div>
        <form onSubmit={handlePasswordChange} className="flex flex-col gap-4 max-w-sm">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">New Password</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-sm border border-slate-300 dark:border-slate-700 px-3 py-2 bg-transparent text-foreground"
              required 
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Confirm New Password</label>
            <input 
              type="password" 
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-sm border border-slate-300 dark:border-slate-700 px-3 py-2 bg-transparent text-foreground"
              required 
            />
          </div>
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Updating..." : "Update Password"}
          </Button>
        </form>
      </div>
    </div>
  );
}
