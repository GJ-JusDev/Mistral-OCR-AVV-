import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { SettingsIcon, Mail, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { createClient } from "@/lib/supabase/server";
import { generateTeacherCode } from "@/actions/admin";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let isAdmin = false;
  if (user) {
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();
    isAdmin = roleData?.role === "admin";
  }

  return (
    <PageContainer>
      <Header title="Settings" description="System configuration and school lists." />
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        {isAdmin ? (
          <Card padding="md" className="flex flex-col gap-4 shadow-sm border-slate-200">
            <div>
              <h3 className="text-lg font-medium text-slate-900 flex items-center gap-2">
                <SettingsIcon className="h-5 w-5 text-slate-500" />
                Invite Teacher
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                Generate an access code and send it to a teacher&apos;s email.
              </p>
            </div>
            
            <form action={async (fd) => { "use server"; await generateTeacherCode(fd); }} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="email" className="text-sm font-medium text-slate-700">Teacher Email</label>
                <input 
                  type="email" 
                  id="email" 
                  name="email" 
                  placeholder="teacher@school.edu" 
                  required
                  className="px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-slate-500 sm:text-sm transition-all"
                />
              </div>
              <button 
                type="submit" 
                className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-md hover:bg-slate-800 transition-colors shadow-sm font-medium text-sm"
              >
                <Mail className="h-4 w-4" />
                Send Access Code
              </button>
            </form>
          </Card>
        ) : (
          <Card padding="md" className="flex flex-col items-center justify-center py-12 border-dashed border-2 border-slate-200 text-slate-400">
             <ShieldAlert className="h-10 w-10 mb-2" />
             <p className="text-sm font-medium text-slate-600">Admin Privileges Required</p>
             <p className="text-xs text-center mt-1">You do not have permission to manage teacher invites.</p>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
