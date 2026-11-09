import { CircleCheckIcon, RisingBarsIcon, ScanPlusIcon, SchoolBuildingIcon } from "./LandingIcons";
import { landingStyles } from "./content";

const stats = [
  {
    title: "Scan Forms",
    description: "Upload or capture school forms.",
    icon: ScanPlusIcon,
  },
  {
    title: "Validate Automatically",
    description: "Use visual analysis to verify form details.",
    icon: CircleCheckIcon,
  },
  {
    title: "Improve Efficiency",
    description: "Process forms faster with accuracy.",
    icon: RisingBarsIcon,
  },
  {
    title: "Support Local Schools",
    description: "Designed for schools in Taysan, Legazpi City.",
    icon: SchoolBuildingIcon,
  },
];

export default function StatStrip() {
  return (
    <section aria-labelledby="landing-stats-title" className="bg-[#012423] pb-[34px] pt-[18px] text-white landing-fit:flex landing-fit:min-h-[var(--landing-stat-h)] landing-fit:items-center">
      <h2 id="landing-stats-title" className="sr-only">
        What the system does
      </h2>
      <ul
        className={`${landingStyles.container} grid grid-cols-1 gap-x-8 gap-y-6 min-[560px]:grid-cols-2 min-[900px]:grid-cols-4 min-[900px]:gap-x-0 min-[1180px]:grid-cols-[0.92fr_1.1fr_1fr_1.1fr]`}
      >
        {stats.map(({ title, description, icon: Icon }) => (
          <li
            key={title}
            className="flex items-start gap-[22px] border-white/[0.14] min-[900px]:gap-3.5 min-[900px]:pr-2 min-[900px]:[&:not(:first-child)]:border-l min-[900px]:[&:not(:first-child)]:pl-5 min-[1180px]:gap-[22px] min-[1180px]:[&:not(:first-child)]:pl-[34px] min-[1536px]:gap-[26px] min-[1536px]:[&:not(:first-child)]:pl-11 min-[2200px]:gap-8 min-[2200px]:[&:not(:first-child)]:pl-14"
          >
            <Icon className="h-[50px] w-[50px] shrink-0 text-[#5AD94A] min-[900px]:h-[42px] min-[900px]:w-[42px] min-[1180px]:h-14 min-[1180px]:w-14 min-[1536px]:h-[68px] min-[1536px]:w-[68px] min-[2200px]:h-[84px] min-[2200px]:w-[84px]" />
            <div>
              <h3 className="text-base font-bold text-white min-[1180px]:text-lg min-[1536px]:text-[22px] min-[2200px]:text-[26px]">
                {title}
              </h3>
              <p className="mt-0.5 text-[15px] leading-[1.5] text-[#D5E0DC] min-[1180px]:text-base min-[1536px]:text-lg min-[2200px]:text-[21px]">
                {description}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
