import { landingStyles } from "./content";

export function BrandMark({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true" focusable="false">
      <g fill="none" stroke="#5FDC4B" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 5.5V4.8A2.8 2.8 0 0 1 13.8 2H31a3 3 0 0 1 3 3v19" />
        <path d="M6 12V9a3 3 0 0 1 3-3h17.5a3 3 0 0 1 3 3v13" />
        <path d="M21 36H6a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3h17a3 3 0 0 1 3 3v9" />
        <path d="M8.5 17h12M8.5 22.5h12M8.5 28h7" />
      </g>
      <circle cx="30" cy="30" r="9.5" fill="#5FDC4B" />
      <path
        d="m25.4 30.2 3.2 3.2 6-6.4"
        fill="none"
        stroke="#06240F"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BrandLogo() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <BrandMark />
      <span className={`${landingStyles.heading} text-lg font-bold tracking-[-0.01em] text-white sm:text-xl`}>
        SchoolFormVerify
      </span>
    </span>
  );
}
