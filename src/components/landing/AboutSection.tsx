import Image from "next/image";
import { CheckCircle2, Shield } from "lucide-react";
import SectionHeading from "./SectionHeading";
import { landingStyles } from "./content";

const pillars = [
  {
    title: "Objective Discrepancy Detection",
    description: "Identifies borderline grades and mismatched LRNs for immediate human review.",
  },
  {
    title: "Strict Role-Based Integrity",
    description: "Separate workflows for encoding teachers and executive school head oversight.",
  },
  {
    title: "DepEd Curriculum Alignment",
    description: "Tailored directly to K-12 Senior High School semestral grading schemes.",
  },
  {
    title: "Data Privacy Protection",
    description: "Secure, authenticated access strictly confined to authorized TRIS educators.",
  },
];

export default function AboutSection() {
  return (
    <section
      id="about"
      aria-labelledby="landing-about-title"
      className="scroll-mt-20 bg-[linear-gradient(180deg,#F9FAFC,#EEF5F0)] py-16 sm:py-20 lg:py-24"
    >
      <div className={landingStyles.container}>
        <SectionHeading
          id="landing-about-title"
          label="School System Identity"
          title="About the Automated Visual Validation System"
        />

        <div className="mt-12 grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="flex flex-col items-center text-center lg:col-span-4">
            <div className="relative flex h-52 w-52 sm:h-60 sm:w-60 items-center justify-center">
              <Image
                src="/images/tris-logo.png"
                alt="Taysan Resettlement Integrated School Official Seal"
                width={240}
                height={240}
                className="h-full w-full object-contain"
              />
            </div>
            <h3 className={`${landingStyles.heading} mt-6 text-xl font-semibold text-[#0F1D2B]`}>
              Taysan Resettlement Integrated School
            </h3>
            <p className="mt-1 text-sm font-semibold text-[#17762B]">Official School Seal • Established 2008</p>
            <p className="mt-1 text-sm text-[#2B3440]">Taysan, Legazpi City, Albay, Bicol Region</p>
            <p className="mt-1 text-sm text-[#2B3440]">DepEd Division of Legazpi City</p>
          </div>

          {/* From 1536px the pillars move beside the text so the section fills the width. */}
          <div className="min-[1536px]:grid min-[1536px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] min-[1536px]:items-center min-[1536px]:gap-16 lg:col-span-8">
            <div>
              <p className="max-w-[70ch] text-base leading-relaxed text-[#2B3440] sm:text-lg">
                <strong className="font-semibold text-[#0F1D2B]">SchoolFormVerify</strong>, the Automated Visual
                Validation (AVV) System, is an assistive educational platform engineered specifically for{" "}
                <strong className="font-semibold text-[#0F1D2B]">Taysan Resettlement Integrated School (TRIS)</strong>.
                The system assists authorized school personnel with Senior High School record verification and
                significantly reduces repetitive manual checking across DepEd School Form 9 (SF9) report cards,
                School Form 10 (SF10) permanent records, and supporting student credentials.
              </p>

              <div className="mt-6 flex items-start gap-3 rounded-2xl bg-[#00302F] p-6 text-white">
                <Shield className="mt-0.5 h-5 w-5 shrink-0 text-[#8CF06F]" aria-hidden="true" />
                <div>
                  <h3 className={`${landingStyles.heading} text-base font-semibold`}>
                    Human-in-the-Loop Assistive Technology
                  </h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-white/90">
                    SchoolFormVerify is designed to support and empower educators, <strong>not replace them</strong>.
                    Official academic grading and student eligibility decisions require professional judgment and
                    institutional authority. Every optical character extraction remains candidate data until verified
                    and approved by authorized teachers and school officials.
                  </p>
                </div>
              </div>
            </div>

            <ul className="mt-8 grid grid-cols-1 gap-x-8 gap-y-5 min-[640px]:grid-cols-2 min-[1536px]:mt-0 min-[1536px]:grid-cols-1 min-[2200px]:grid-cols-2">
              {pillars.map((pillar) => (
                <li key={pillar.title} className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#1E9A37]" aria-hidden="true" />
                  <div>
                    <h4 className="text-[15px] font-semibold text-[#0F1D2B]">{pillar.title}</h4>
                    <p className="mt-0.5 text-sm leading-relaxed text-[#2B3440]">{pillar.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
