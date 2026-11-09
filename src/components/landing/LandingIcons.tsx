interface LandingIconProps {
  className?: string;
  strokeWidth?: number;
}

function LineIcon({
  className,
  strokeWidth = 2,
  children,
}: LandingIconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function ScanPlusIcon(props: LandingIconProps) {
  return (
    <LineIcon {...props}>
      <path d="M6 16v-6a4 4 0 0 1 4-4h6M32 6h6a4 4 0 0 1 4 4v6M42 32v6a4 4 0 0 1-4 4h-6M16 42h-6a4 4 0 0 1-4-4v-6" />
      <path d="M24 16v16M16 24h16" />
    </LineIcon>
  );
}

export function CircleCheckIcon(props: LandingIconProps) {
  return (
    <LineIcon {...props}>
      <circle cx="24" cy="24" r="19" />
      <path d="m15.5 24.5 6 6 11-12" />
    </LineIcon>
  );
}

export function RisingBarsIcon(props: LandingIconProps) {
  return (
    <LineIcon {...props}>
      <rect x="6" y="28" width="10" height="14" rx="3" />
      <rect x="19" y="18" width="10" height="24" rx="3" />
      <rect x="32" y="6" width="10" height="36" rx="3" />
    </LineIcon>
  );
}

export function SchoolBuildingIcon(props: LandingIconProps) {
  return (
    <LineIcon {...props}>
      <path d="M24 3v11M24 3.5h9l-2.5 3.5 2.5 3.5h-9" />
      <path d="m6 24 18-10 18 10" />
      <path d="M9 22.5V42M39 22.5V42M4 42h40" />
      <path d="M15 29v13M33 29v13" />
      <path d="M20 42v-8a4 4 0 0 1 8 0v8" />
      <circle cx="24" cy="23.5" r="2.8" />
    </LineIcon>
  );
}
