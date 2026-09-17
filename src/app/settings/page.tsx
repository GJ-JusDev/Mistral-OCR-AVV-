import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { createClient } from "@/lib/supabase/server";
import SettingsClient from "./SettingsClient";

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
      <Header title="Settings" description="System configuration and account settings." />
      <div className="mt-6">
        <SettingsClient />
      </div>
    </PageContainer>
  );
}
