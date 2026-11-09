"use client";

import { useRef, useState, type MouseEvent } from "react";
import { Play, X } from "lucide-react";
import { landingDemoVideoSrc, landingStyles } from "./content";

export default function DemoVideoButton() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);

  const openDialog = () => {
    setVideoFailed(false);
    setIsOpen(true);
    dialogRef.current?.showModal();
  };

  const closeDialog = () => dialogRef.current?.close();

  const closeOnBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === dialogRef.current) closeDialog();
  };

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className={`${landingStyles.outlineButton} w-full px-7 py-3.5 text-base sm:w-auto min-[1800px]:px-9 min-[1800px]:py-4 min-[1800px]:text-lg`}
      >
        <Play className="h-4 w-4 fill-current" aria-hidden="true" />
        Watch Demo
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => setIsOpen(false)}
        onClick={closeOnBackdrop}
        aria-label="SchoolFormVerify demo video"
        className="m-auto w-[calc(100%-2rem)] max-w-4xl overflow-hidden rounded-2xl bg-[#00212B] p-0 text-white backdrop:bg-[#00141A]/85"
      >
        <div className="flex items-center justify-between px-5 py-3">
          <p className={`${landingStyles.heading} text-base font-semibold`}>Watch Demo</p>
          <button
            type="button"
            onClick={closeDialog}
            aria-label="Close demo video"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#8CF06F]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="aspect-video w-full bg-[#00141A]">
          {isOpen && !videoFailed && (
            <video
              src={landingDemoVideoSrc}
              controls
              autoPlay
              playsInline
              preload="metadata"
              onError={() => setVideoFailed(true)}
              className="h-full w-full"
            />
          )}
          {isOpen && videoFailed && (
            <div role="status" className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <Play className="h-9 w-9 text-[#5FDC4B]" aria-hidden="true" />
              <p className="text-base font-medium">The demo video isn&apos;t available yet.</p>
              <p className="text-sm text-white/75">Please check back soon.</p>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}
