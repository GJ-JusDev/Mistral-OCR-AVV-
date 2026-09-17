import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { SettingsIcon, Mail, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { createClient } from "@/lib/supabase/server";


export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let isAdmin = false;
  if (user) {
    const role = user?.user_metadata?.role?.toLowerCase() || "teacher";
    isAdmin = role === "admin";
  }

  return (
    <PageContainer>
      <Header title="Settings" description="System configuration and school lists." />
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card padding="md" className="flex flex-col gap-4 shadow-sm border-slate-200">
          <div>
            <h3 className="text-lg font-medium text-slate-900 flex items-center gap-2">
              <SettingsIcon className="h-5 w-5 text-slate-500" />
              General Settings
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              Configuration options will appear here.
            </p>
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}
