"use client";

import React from "react";

interface ImagePreviewProps {
  image: string;
  isCropping: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  imageRef: React.RefObject<HTMLImageElement | null>;
  dragRect: { x: number; y: number; w: number; h: number } | null;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (e: React.PointerEvent<HTMLDivElement>) => void;
}

export default function ImagePreview({
  image,
  isCropping,
  containerRef,
  imageRef,
  dragRect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: ImagePreviewProps) {
  return (
    <div
      ref={containerRef}
      className={`relative w-full aspect-[4/3] bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden flex items-center justify-center ${
        isCropping ? "cursor-crosshair touch-none" : ""
      }`}
      onPointerDown={isCropping ? onPointerDown : undefined}
      onPointerMove={isCropping ? onPointerMove : undefined}
      onPointerUp={isCropping ? onPointerUp : undefined}
      onPointerCancel={isCropping ? onPointerUp : undefined}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imageRef}
        src={image}
        alt="Captured or uploaded preview"
        className="max-w-full max-h-full object-contain pointer-events-none"
        draggable={false}
      />
      
      {isCropping && dragRect && (
        <div
          className="absolute border-2 border-blue-500 bg-blue-500/20"
          style={{
            left: `${dragRect.x}px`,
            top: `${dragRect.y}px`,
            width: `${dragRect.w}px`,
            height: `${dragRect.h}px`,
          }}
        />
      )}
    </div>
  );
}
