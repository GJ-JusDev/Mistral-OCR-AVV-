import { Layers, Users, Zap } from "lucide-react";
import { ScanPlusIcon } from "./LandingIcons";
import SectionHeading from "./SectionHeading";
import { landingStyles } from "./content";

const features = [
  {
    title: "Visual Form Validation",
    description: "Analyzes and verifies form details automatically using visual processing.",
    icon: <ScanPlusIcon className="h-11 w-11" strokeWidth={3} />,
  },
  {
    title: "Record Management",
    description: "Keep validated forms organized, searchable, and secure.",
    icon: <Layers className="h-11 w-11" strokeWidth={1.8} aria-hidden="true" />,
  },
  {
    title: "Real-Time Results",
    description: "Get instant validation results with clear feedback and identified issues.",
    icon: <Zap className="h-11 w-11 fill-current" strokeWidth={1.8} aria-hidden="true" />,
  },
  {
    title: "User-Friendly",
    description: "A simple and intuitive interface for school staff and administrators.",
    icon: <Users className="h-11 w-11" strokeWidth={1.8} aria-hidden="true" />,
  },
];

export default function FeaturesSection() {
  return (
    <section
      id="features"
      aria-labelledby="landing-features-title"
      className="scroll-mt-20 bg-[linear-gradient(180deg,#F9FAFC,#EEF5F0)] py-12 lg:py-14"
    >
      <div className={landingStyles.container}>
        <SectionHeading
          id="landing-features-title"
          label="Features"
          title="System Features"
          subtitle="Powerful tools to simplify and improve school form validation."
        />

        <ul className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(({ title, description, icon }) => (
            <li
              key={title}
              className="rounded-2xl bg-[linear-gradient(180deg,#FBFDFA,#E5F4E2)] p-6 shadow-[0_10px_28px_rgba(15,29,43,0.08)] min-[1800px]:p-8"
            >
              <span className="block text-[#1E9A37]">{icon}</span>
              <h3
                className={`${landingStyles.heading} mt-3 text-[19px] font-bold tracking-[-0.01em] text-[#0F1D2B] min-[1800px]:text-[22px]`}
              >
                {title}
              </h3>
              <p className="mt-1.5 text-[17px] leading-[1.4] text-[#2B3440] min-[1800px]:text-[19px]">{description}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
