import { landingStyles } from "./content";

interface SectionHeadingProps {
  label: string;
  title: string;
  id: string;
  subtitle?: string;
}

export default function SectionHeading({ label, title, id, subtitle }: SectionHeadingProps) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      {/* 19px bold keeps #1E9A37 within the WCAG large-text contrast ratio on the light sections. */}
      <p className="text-[19px] font-bold uppercase tracking-[0.12em] text-[#1E9A37]">{label}</p>
      <h2
        id={id}
        className={`${landingStyles.heading} mt-1.5 text-[clamp(1.75rem,3.2vw,2.625rem)] font-bold leading-tight tracking-[-0.02em] text-[#0F1D2B] [text-wrap:balance]`}
      >
        {title}
      </h2>
      {subtitle && <p className="mt-2 text-[clamp(1rem,1.5vw,1.1875rem)] leading-relaxed text-[#2B3440]">{subtitle}</p>}
    </div>
  );
}
