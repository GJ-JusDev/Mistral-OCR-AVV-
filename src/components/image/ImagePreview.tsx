"use client";

import React from "react";

interface ImagePreviewProps {
  image: string;
  isCropping: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  imageRef: React.RefObject<HTMLImageElement | null>;
  dragRect: { x: number; y: number; w: number; h: number } | null;
  previewRotation?: 0 | 90 | 180 | 270;
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
  previewRotation = 0,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: ImagePreviewProps) {
  const effectiveRotation = isCropping ? 0 : previewRotation;
  const isQuarterTurn = effectiveRotation === 90 || effectiveRotation === 270;

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
      {image.startsWith("data:application/pdf") ? (
        <div className="flex flex-col items-center justify-center p-6 text-center text-zinc-600 dark:text-zinc-300">
          <span className="text-sm font-semibold">PDF Document Loaded</span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Ready for OCR text and grade extraction
          </span>
        </div>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          ref={imageRef}
          src={image}
          alt="Captured or uploaded preview"
          className="object-contain pointer-events-none transition-transform duration-150"
          style={{
            imageOrientation: "from-image",
            maxWidth: isQuarterTurn ? "75%" : "100%",
            maxHeight: isQuarterTurn ? "133.333%" : "100%",
            transform: effectiveRotation !== 0 ? `rotate(${effectiveRotation}deg)` : undefined,
          }}
          draggable={false}
        />
      )}

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
