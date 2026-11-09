import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { landingStyles } from "./content";

export default function CtaSection() {
  return (
    <section aria-labelledby="landing-cta-title" className="bg-[#EEF5F0] pt-4 sm:pt-8">
      {/* Below lg the background shows at full width under the text; its top-edge colors extend it upward. */}
      <div className="relative isolate overflow-hidden rounded-t-[28px] bg-[linear-gradient(90deg,#0C5E43,#014134_25%,#003E33_50%,#034A3B_75%,#014235)] lg:aspect-[3.6/1]">
        <div className="absolute inset-x-0 bottom-0 -z-10 aspect-[3/1] [mask-image:linear-gradient(180deg,transparent,#000_20%)] lg:inset-0 lg:aspect-auto lg:[mask-image:none]">
          <Image src="/images/ready2streamline.png" alt="" fill sizes="100vw" className="object-cover object-bottom" />
        </div>
        <div className="absolute inset-x-0 bottom-0 h-7 rounded-t-[28px] bg-[#002021]" />

        <div className="mx-auto flex max-w-[640px] flex-col items-center px-5 pb-[38vw] pt-10 text-center sm:px-8 sm:pb-[30vw] sm:pt-14 lg:absolute lg:inset-x-0 lg:top-0 lg:h-[84%] lg:max-w-[min(50vw,1280px)] lg:justify-center lg:p-0">
          <h2
            id="landing-cta-title"
            className={`${landingStyles.heading} text-[clamp(1.625rem,3.4vw,2.5rem)] font-bold leading-tight tracking-[-0.02em] text-white [text-wrap:balance] lg:text-[clamp(1.875rem,2.9vw,4.25rem)]`}
          >
            Ready to Streamline Your <span className="lg:block">School Form Validation?</span>
          </h2>
          <p className="mt-2 max-w-[36rem] text-base leading-snug text-white/95 lg:max-w-[min(44vw,56rem)] lg:text-[clamp(1rem,1.4vw,1.625rem)]">
            Try SchoolFormVerify today and experience a faster, more accurate, and organized validation process for
            your school.
          </p>
          <Link href="/register" className={`${landingStyles.primaryButton} group mt-4 px-8 py-3 text-base`}>
            Get Started
            <ArrowRight
              className="h-5 w-5 transition-transform duration-200 group-hover:translate-x-1"
              aria-hidden="true"
            />
          </Link>
        </div>
      </div>
    </section>
  );
}
