"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function login(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }

  // Check account status
  if (data.user?.user_metadata?.account_status === 'Pending') {
    await supabase.auth.signOut();
    return { error: "Your account is pending admin approval." };
  }

  // Log the login event
  if (data.user) {
    await supabase.from("auth_logs").insert({
      user_id: data.user.id,
      action: "login",
    });
  }

  revalidatePath("/");
  redirect("/");
}

export async function register(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const accessCode = formData.get("accessCode") as string;
  const firstName = (formData.get("firstName") as string)?.trim();
  const middleName = (formData.get("middleName") as string)?.trim();
  const lastName = (formData.get("lastName") as string)?.trim();
  const nameExtension = (formData.get("nameExtension") as string)?.trim() || "";
  const lptInfo = (formData.get("lptInfo") as string)?.trim();
  
  if (!firstName || !middleName || !lastName) {
    return { error: "First Name, Middle Name, and Last Name are required." };
  }

  const supabase = await createClient();

  // Basic security: check env code first
  const validCodeEnv = process.env.TEACHER_ACCESS_CODE || "TEACHER2026";
  
  let isValid = accessCode === validCodeEnv;

  // If not env code, check DB teacher_invites
  if (!isValid) {
    const { data: invite } = await supabase
      .from("teacher_invites")
      .select("*")
      .eq("email", email)
      .eq("access_code", accessCode)
      .eq("used", false)
      .single();
      
    if (invite) {
      isValid = true;
      // Mark as used
      await supabase.from("teacher_invites").update({ used: true }).eq("id", invite.id);
    }
  }

  if (!isValid) {
    return { error: "Invalid teacher access code." };
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: firstName,
        middle_name: middleName,
        last_name: lastName,
        name_extension: nameExtension,
        lpt_info: lptInfo,
        account_status: 'Pending'
      }
    }
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/");
  redirect("/");
}

export async function logout() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  
  if (data.user) {
    await supabase.from("auth_logs").insert({
      user_id: data.user.id,
      action: "logout",
    });
  }

  await supabase.auth.signOut();
  revalidatePath("/");
  redirect("/login");
}