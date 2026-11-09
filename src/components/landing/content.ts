/**
 * Landing page details that come from the school.
 * A null value hides that contact line or leaves that social icon unlinked.
 */
export const landingContact = {
  location: "Taysan, Legazpi City, Albay",
  email: "support@schoolformverify.ph" as string | null,
  phone: "(052) 742-0000" as string | null,
};

export const landingSocialLinks = {
  facebook: null as string | null,
  youtube: null as string | null,
  github: "https://github.com/GJ-JusDev/Mistral-OCR-AVV-" as string | null,
};

/** Kept under /landing so the middleware serves it to signed-out visitors. */
export const landingDemoVideoSrc = "/landing/demo.mp4";

export const landingStyles = {
  /** Full width at every size: only the fluid side gutter separates content from the viewport edge. */
  container: "w-full px-4 sm:px-8 lg:px-[clamp(2.5rem,4vw,6rem)]",
  heading: "[font-family:var(--font-landing-heading)]",
  primaryButton:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[linear-gradient(90deg,#8CF06F,#5AD94A)] font-semibold text-[#06240F] shadow-[0_8px_20px_rgba(4,40,24,0.35)] transition duration-200 hover:brightness-110 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
  outlineButton:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/70 font-semibold text-white transition duration-200 hover:bg-white/10 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
};
