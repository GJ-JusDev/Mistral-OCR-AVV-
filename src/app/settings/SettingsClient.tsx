"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Lock } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

export default function SettingsClient() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const supabase = createClient();

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
      <div className="p-4 border border-slate-200 rounded-md bg-white">
        <div className="mb-4">
          <h4 className="font-medium text-red-600 flex items-center gap-2">
            <Lock className="h-4 w-4" /> Change Password
          </h4>
          <p className="text-sm text-slate-500">Update your account password</p>
        </div>
        <form onSubmit={handlePasswordChange} className="flex flex-col gap-4 max-w-sm">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-sm border border-slate-300 px-3 py-2 bg-transparent text-slate-900"
              required 
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Confirm New Password</label>
            <input 
              type="password" 
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-sm border border-slate-300 px-3 py-2 bg-transparent text-slate-900"
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
