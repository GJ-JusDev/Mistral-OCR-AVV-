import LandingPage from "@/components/landing/LandingPage";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "SchoolFormVerify — An Automated Visual Validation for School Forms",
  description: "Digitize and validate school forms with an intelligent system built for the schools of Taysan, Legazpi City.",
};

export default async function PublicLandingPageRoute() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return <LandingPage user={user} />;
}
