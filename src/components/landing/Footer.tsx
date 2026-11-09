import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { Mail, MapPin, Phone } from "lucide-react";
import { BrandLogo } from "./BrandLogo";
import { landingContact, landingSocialLinks, landingStyles } from "./content";

const quickLinks = [
  { href: "#home", label: "Home" },
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How It Works" },
  { href: "#about", label: "About" },
];

const portalLinks = [
  { href: "/login", label: "Sign In to Account" },
  { href: "/register", label: "Faculty Account Registration" },
  { href: "/terms", label: "Terms and Conditions" },
];

const socialIcons: { key: keyof typeof landingSocialLinks; label: string; path: string }[] = [
  {
    key: "facebook",
    label: "Facebook",
    path: "M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z",
  },
  {
    key: "youtube",
    label: "YouTube",
    path: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
  },
  {
    key: "github",
    label: "GitHub",
    path: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  },
];

const linkStyle =
  "rounded text-white/85 transition-colors hover:text-[#8CF06F] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8CF06F]";

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-white/15 lg:border-l lg:pl-10">
      <h2 className={`${landingStyles.heading} text-base font-semibold text-white`}>{title}</h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-[#002021] text-white/90">
      <div className={`${landingStyles.container} py-10 lg:py-12`}>
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-[1.5fr_0.8fr_1.2fr_0.9fr]">
          <div className="lg:pr-10">
            <div className="flex items-center gap-3">
              <BrandLogo />
              <div className="h-7 w-px bg-white/20" aria-hidden="true" />
              <Image
                src="/images/tris-logo.png"
                alt="Taysan Resettlement Integrated School Official Seal"
                width={36}
                height={36}
                className="h-9 w-9 object-contain"
              />
            </div>
            <p className="mt-4 max-w-sm text-sm leading-relaxed">
              An Automated Visual Validation for School Forms in Taysan, Legazpi City.
            </p>
          </div>

          <FooterColumn title="Quick Links">
            <ul className="space-y-2.5 text-sm">
              {quickLinks.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className={linkStyle}>
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </FooterColumn>

          <FooterColumn title="Contact">
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-2.5">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-white" aria-hidden="true" />
                {landingContact.location}
              </li>
              {landingContact.email && (
                <li className="flex items-start gap-2.5">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-white" aria-hidden="true" />
                  <a href={`mailto:${landingContact.email}`} className={linkStyle}>
                    {landingContact.email}
                  </a>
                </li>
              )}
              {landingContact.phone && (
                <li className="flex items-start gap-2.5">
                  <Phone className="mt-0.5 h-4 w-4 shrink-0 text-white" aria-hidden="true" />
                  <a href={`tel:${landingContact.phone.replace(/\s/g, "")}`} className={linkStyle}>
                    {landingContact.phone}
                  </a>
                </li>
              )}
            </ul>
          </FooterColumn>

          <FooterColumn title="Follow Us">
            <ul className="flex items-center gap-3">
              {socialIcons.map(({ key, label, path }) => {
                const href = landingSocialLinks[key];
                const icon = (
                  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true" focusable="false">
                    <path d={path} />
                  </svg>
                );
                return (
                  <li key={key}>
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={label}
                        className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white transition-colors hover:bg-[#5FDC4B] hover:text-[#06240F] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8CF06F]"
                      >
                        {icon}
                      </a>
                    ) : (
                      <span
                        role="img"
                        aria-label={`${label} page not linked yet`}
                        className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white"
                      >
                        {icon}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </FooterColumn>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-white/15 pt-6 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>© {currentYear} Taysan Resettlement Integrated School. All rights reserved.</p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {portalLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={linkStyle}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
