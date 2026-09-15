"use client";

import React from "react";

interface CameraFeedProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  cameraZoom: number;
  hasHardwareZoom: boolean;
}

export default function CameraFeed({ videoRef, cameraZoom, hasHardwareZoom }: CameraFeedProps) {
  return (
    <div className="relative w-full aspect-[4/3] bg-zinc-950 overflow-hidden rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          transform: !hasHardwareZoom ? `scale(${cameraZoom})` : "none",
          transformOrigin: "center center",
          transition: "transform 0.2s ease-out"
        }}
      />
    </div>
  );
}
