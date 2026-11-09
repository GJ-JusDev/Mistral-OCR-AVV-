import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import DemoVideoButton from "./DemoVideoButton";
import { landingStyles } from "./content";

// Authentic Mayon Volcano landscape: /images/mayon-hero.jpg /images/trisbg.png
const heroImage = {
  src: "/images/trisbg.png",
  sizes: "(min-width: 1024px) 100vw, 1000px",
};

export default function HeroSection() {
  return (
    <section
      id="home"
      className="relative isolate -mt-[72px] overflow-hidden bg-gradient-to-b bg-[linear-gradient(180deg,#00212B,#012423)] text-white lg:-mt-20 lg:min-h-[46.3vw] landing-fit:h-[var(--landing-hero-h)] landing-fit:min-h-0"
    >
      <div className="absolute inset-x-0 bottom-0 -z-10 h-[480px] [mask-image:linear-gradient(180deg,transparent,#000_14%)] sm:h-[560px] lg:bottom-auto lg:top-0 lg:aspect-[1672/941] lg:h-auto lg:[mask-image:linear-gradient(180deg,#000_58%,transparent_70%)] landing-fit:left-auto landing-fit:top-[var(--landing-photo-top)] landing-fit:w-[var(--landing-photo-w)]">
        <Image
          src={heroImage.src}
          alt="Mayon Volcano rising behind a white school building surrounded by trees"
          fill
          priority
          sizes={heroImage.sizes}
          className="object-cover object-[100%_100%]"
        />
        <div className="absolute inset-0 hidden bg-[linear-gradient(90deg,rgba(0,33,43,0.9)_0%,rgba(0,33,43,0.76)_calc(100%_-_50vw_+_20px),rgba(0,33,43,0)_calc(100%_-_50vw_+_220px))] lg:block" />
      </div>

      {/* From lg up, the photo's wave is lifted to sit directly under the school building. */}
      <div className="absolute inset-x-0 top-[-10vw] -z-10 hidden aspect-[1672/941] [mask-image:linear-gradient(180deg,transparent_77%,#000_82%)] lg:block landing-fit:left-auto landing-fit:top-[var(--landing-wave-top)] landing-fit:w-[var(--landing-photo-w)]">
        <Image src={heroImage.src} alt="" fill sizes={heroImage.sizes} className="object-cover" />
      </div>

      <div className="absolute inset-x-0 top-0 -z-10 h-36 bg-[linear-gradient(180deg,rgba(0,33,43,0.82),rgba(0,33,43,0))]" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-12 bg-[linear-gradient(180deg,rgba(1,36,35,0),#012423)]" />

      <div
        className={`${landingStyles.container} pb-[450px] pt-[104px] sm:pb-[530px] sm:pt-[120px] lg:pb-0 lg:pt-[clamp(96px,8.6vw,240px)] landing-fit:pt-[calc(80px_+_3.5svh)]`}
      >
        <div className="max-w-[720px] lg:max-w-[min(54vw,1200px)]">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-4 py-1.5 text-sm font-semibold">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-[#5FDC4B]" aria-hidden="true" focusable="false">
              <path
                fillRule="evenodd"
                d="M12 2a7.5 7.5 0 0 0-7.5 7.5C4.5 15 12 22 12 22s7.5-7 7.5-12.5A7.5 7.5 0 0 0 12 2Zm0 10.2a2.7 2.7 0 1 1 0-5.4 2.7 2.7 0 0 1 0 5.4Z"
              />
            </svg>
            Taysan, Legazpi City, Albay
          </p>

          <h1 className={`${landingStyles.heading} mt-4 font-bold tracking-[-0.02em]`}>
            <span className="sr-only">Smarter School Form Validation</span>
            <span className="block text-[clamp(1.75rem,7.6vw,3.25rem)] leading-[1.15] lg:text-[clamp(2.25rem,3.6vw,5rem)] landing-fit:text-[clamp(2.25rem,min(3.6vw,calc(10svh_-_24px)),5rem)]">
              An Automated Visual
              <br />
              Validation for
            </span>
            <span className="block text-[clamp(2.75rem,12vw,4.75rem)] leading-[1.1] text-[#5FDC4B] lg:text-[clamp(2.875rem,4.5vw,6rem)] landing-fit:text-[clamp(2.875rem,min(4.5vw,calc(12.5svh_-_30px)),6rem)]">
              School Forms
            </span>
          </h1>

          <p className="mt-3 max-w-[34rem] text-base leading-relaxed text-white/95 sm:text-lg lg:max-w-[min(43vw,48rem)] lg:text-[clamp(1rem,1.55vw,1.75rem)] lg:leading-[1.4] landing-fit:text-[clamp(1rem,min(1.55vw,3.2svh),1.75rem)]">
            Digitize and validate school forms with an intelligent system built for the schools of
            Taysan, Legazpi City.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            <Link href="/register" className={`${landingStyles.primaryButton} group px-7 py-3 text-base min-[1800px]:px-9 min-[1800px]:py-4 min-[1800px]:text-lg`}>
              Get Started
              <ArrowRight
                className="h-5 w-5 transition-transform duration-200 group-hover:translate-x-1"
                aria-hidden="true"
              />
            </Link>
            <DemoVideoButton />
          </div>
        </div>
      </div>
    </section>
  );
}
