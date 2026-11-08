import LandingNavbar from "./LandingNavbar";
import HeroSection from "./HeroSection";
import FeaturesSection from "./FeaturesSection";
import HowItWorksSection from "./HowItWorksSection";
import AboutSection from "./AboutSection";
import CtaSection from "./CtaSection";
import Footer from "./Footer";

interface LandingPageProps {
  user?: any;
}

export default function LandingPage({ user }: LandingPageProps) {
  return (
    <div className="min-h-screen w-full bg-[#0B1F33] text-white selection:bg-[#F4C542] selection:text-[#0B1F33] flex flex-col">
      {/* Sticky Responsive Navigation Bar */}
      <LandingNavbar user={user} />

      {/* Main Content Area */}
      <div className="flex-1">
        {/* Hero Section with Mayon Volcano & Educational Setting */}
        <HeroSection />

        {/* 4 Feature Highlights */}
        <FeaturesSection />

        {/* 4-Step How It Works Workflow */}
        <HowItWorksSection />

        {/* About System with Official TRIS Seal */}
        <AboutSection />

        {/* Final Call to Action */}
        <CtaSection />
      </div>

      {/* Institutional Footer */}
      <Footer />
    </div>
  );
}
