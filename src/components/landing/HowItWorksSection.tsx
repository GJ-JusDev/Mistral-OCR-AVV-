import { ArrowDown, ArrowRight, FileText, UploadCloud } from "lucide-react";
import { CircleCheckIcon, ScanPlusIcon } from "./LandingIcons";
import SectionHeading from "./SectionHeading";
import { landingStyles } from "./content";

const steps = [
  {
    title: "Upload Form",
    stepTag: "Step 1 — Upload School Forms",
    description: "Submit a scanned or photographed school form.",
    icon: <UploadCloud className="h-10 w-10" strokeWidth={1.8} aria-hidden="true" />,
  },
  {
    title: "Automatic Validation",
    stepTag: "Step 2 — AI-Assisted Extraction",
    description: "The system analyzes and verifies the form details.",
    icon: <ScanPlusIcon className="h-10 w-10" strokeWidth={3} />,
  },
  {
    title: "Get Results",
    stepTag: "Step 3 — Review & Validate",
    description: "Receive instant validation results and identified issues.",
    icon: <CircleCheckIcon className="h-10 w-10" strokeWidth={3} />,
  },
  {
    title: "Proceed",
    stepTag: "Step 4 — School-Level Review",
    description: "Use the validated form for school processing and record keeping.",
    icon: <FileText className="h-10 w-10" strokeWidth={1.8} aria-hidden="true" />,
  },
];

const desktopArrowVisibility = ["sm:flex", "lg:flex", "sm:flex", ""];

export default function HowItWorksSection() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="landing-how-title"
      className="scroll-mt-20 bg-[#FAFBFC] py-12 lg:py-14"
    >
      <div className={landingStyles.container}>
        <SectionHeading
          id="landing-how-title"
          label="How It Works"
          title="A Simple and Efficient Process"
          subtitle="Validate school forms in just a few easy steps."
        />

        <ol className="mt-9 grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 sm:gap-y-10 lg:grid-cols-4">
          {steps.map(({ title, stepTag, description, icon }, index) => (
            <li key={title} className="relative">
              <span className="flex h-[76px] w-[76px] items-center justify-center rounded-2xl bg-[#E2F6DE] text-[#1E9A37]">
                {icon}
              </span>
              <h3
                className={`${landingStyles.heading} mt-3 text-[19px] font-bold tracking-[-0.01em] text-[#0F1D2B]`}
                aria-label={stepTag}
              >
                {index + 1}. {title}
              </h3>
              <p className="mt-1 max-w-[16rem] text-base leading-[1.4] text-[#2B3440] min-[1536px]:max-w-[24rem]">
                {description}
              </p>

              {index < steps.length - 1 && (
                <>
                  {/* On wide screens a track carries the eye from the tile across to the arrow. */}
                  <div
                    className={`absolute left-[92px] right-5 top-6 hidden items-center justify-end gap-2 ${desktopArrowVisibility[index]}`}
                  >
                    <span className="hidden h-0.5 flex-1 rounded-full bg-[#BFD8C4] min-[1536px]:block" />
                    <ArrowRight className="h-7 w-7 shrink-0 text-[#0F1D2B]" strokeWidth={2.4} aria-hidden="true" />
                  </div>
                  <ArrowDown className="ml-6 mt-4 h-7 w-7 text-[#0F1D2B] sm:hidden" strokeWidth={2.4} aria-hidden="true" />
                </>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
