import LandingNavbar from "./LandingNavbar";
import HeroSection from "./HeroSection";
import StatStrip from "./StatStrip";
import FeaturesSection from "./FeaturesSection";
import HowItWorksSection from "./HowItWorksSection";
import AboutSection from "./AboutSection";
import CtaSection from "./CtaSection";
import Footer from "./Footer";
import { landingBodyFont, landingHeadingFont } from "./fonts";

interface LandingPageProps {
  user?: any;
}

export default function LandingPage({ user }: LandingPageProps) {
  return (
    <div
      data-landing-page
      className={`${landingHeadingFont.variable} ${landingBodyFont.variable} flex min-h-screen w-full flex-col bg-[#F9FAFC] text-[#2B3440] [font-family:var(--font-landing-body)] selection:bg-[#5FDC4B] selection:text-[#06240F]`}
    >
      <LandingNavbar user={user} />

      <div className="flex-1">
        <HeroSection />
        <StatStrip />
        <FeaturesSection />
        <HowItWorksSection />
        <AboutSection />
        <CtaSection />
      </div>

      <Footer />
    </div>
  );
}
