import { Inter, Poppins } from "next/font/google";

export const landingHeadingFont = Poppins({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-landing-heading",
  display: "swap",
});

export const landingBodyFont = Inter({
  subsets: ["latin"],
  variable: "--font-landing-body",
  display: "swap",
});
