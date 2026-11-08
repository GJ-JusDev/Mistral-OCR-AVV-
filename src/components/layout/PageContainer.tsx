import React from "react";

interface PageContainerProps {
  children: React.ReactNode;
  className?: string;
  maxWidth?: "max-w-7xl" | "max-w-6xl" | "max-w-5xl" | "max-w-4xl" | "max-w-full";
}

export default function PageContainer({
  children,
  className = "",
  maxWidth = "max-w-7xl",
}: PageContainerProps) {
  return (
    <div className={`flex-1 overflow-auto bg-[#F4F7FB] min-h-0 ${className}`}>
      <div className={`mx-auto ${maxWidth} px-4 py-5 sm:px-6 lg:px-8`}>
        {children}
      </div>
    </div>
  );
}
