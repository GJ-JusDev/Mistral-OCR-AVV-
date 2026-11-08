import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Authoritative server-side role check from database (never trust client-mutable user_metadata)
  const { data: roleRow, error: roleError } = await supabase
    .from("user_roles")
    .select("role, account_status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleError || !roleRow || roleRow.role?.toLowerCase() !== "admin" || roleRow.account_status !== "Approved") {
    redirect("/");
  }

  return <>{children}</>;
}
