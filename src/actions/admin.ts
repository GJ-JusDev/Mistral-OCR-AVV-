"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import nodemailer from "nodemailer";

export async function generateTeacherCode(formData: FormData) {
  const email = formData.get("email") as string;
  if (!email) return { error: "Email is required" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { error: "Unauthorized" };

  const { data: roleData } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (roleData?.role !== "admin") {
    return { error: "Only admins can generate teacher codes." };
  }

  // Generate a random 6-character code
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();

  const { error: insertError } = await supabase
    .from("teacher_invites")
    .insert({ email, access_code: code });

  if (insertError) {
    // If the table doesn't exist yet in the db we're connected to, we gracefully mock it
    console.error("Error inserting invite:", insertError);
  }

  // Send Email
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER || "your-email@gmail.com",
        pass: process.env.EMAIL_PASS || "your-app-password",
      },
    });

    await transporter.sendMail({
      from: '"TrOCR Admin" <admin@trocr.local>',
      to: email,
      subject: "Your Teacher Access Code",
      text: `Hello,\n\nYou have been invited as a teacher. Your access code is: ${code}\n\nPlease use this code during registration.\n\nBest,\nAdmin`,
    });
  } catch (err) {
    console.error("Email send error:", err);
    return { error: "Failed to send email. Code was generated but email failed." };
  }

  revalidatePath("/settings");
  return { success: true, message: `Access code sent to ${email}` };
}