import LandingPage from "@/components/landing/LandingPage";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Automated Visual Validation System (AVV) — Taysan Resettlement Integrated School",
  description: "An AI-assisted platform for extracting, reviewing, and validating Senior High School records with accuracy, transparency, and human verification.",
};

export default async function PublicLandingPageRoute() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return <LandingPage user={user} />;
}
