"use client";

import { useCallback, useRef, useState } from "react";
import { computeStdDev, getContainedImageRect, BLANK_STD_DEV_THRESHOLD } from "@/lib/ocr/image-utils";

export type CropItem = {
  id: string;
  image: string;
  hasContent: boolean;
};

export type UseCropperResult = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  imageRef: React.RefObject<HTMLImageElement | null>;
  isCropping: boolean;
  setIsCropping: (v: boolean) => void;
  crops: CropItem[];
  setCrops: React.Dispatch<React.SetStateAction<CropItem[]>>;
  dragRect: { x: number; y: number; w: number; h: number } | null;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
  clearCrops: () => void;
};

export function useCropper(): UseCropperResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const [isCropping, setIsCropping] = useState(false);
  const [crops, setCrops] = useState<CropItem[]>([]);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragRect, setDragRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const clearCrops = useCallback(() => setCrops([]), []);

  const getRelativePos = useCallback((e: React.PointerEvent) => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isCropping) return;
      const pos = getRelativePos(e);
      if (!pos) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragStart(pos);
      setDragRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
    },
    [isCropping, getRelativePos]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isCropping || !dragStart) return;
      const pos = getRelativePos(e);
      if (!pos) return;
      setDragRect({
        x: Math.min(dragStart.x, pos.x),
        y: Math.min(dragStart.y, pos.y),
        w: Math.abs(pos.x - dragStart.x),
        h: Math.abs(pos.y - dragStart.y),
      });
    },
    [isCropping, dragStart, getRelativePos]
  );

  const onPointerUp = useCallback(() => {
    const container = containerRef.current;
    const img = imageRef.current;
    const rect = dragRect;
    
    setDragStart(null);
    setDragRect(null);
    
    if (!isCropping || !container || !img || !rect || rect.w < 8 || rect.h < 8) return;

    const { offsetX, offsetY, width, height } = getContainedImageRect(container, img);
    const scaleX = img.naturalWidth / width;
    const scaleY = img.naturalHeight / height;

    const sx = Math.max(0, (rect.x - offsetX) * scaleX);
    const sy = Math.max(0, (rect.y - offsetY) * scaleY);
    const sw = Math.min(img.naturalWidth - sx, rect.w * scaleX);
    const sh = Math.min(img.naturalHeight - sy, rect.h * scaleY);
    
    if (sw < 4 || sh < 4) return;

    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const hasContent = computeStdDev(ctx.getImageData(0, 0, sw, sh)) >= BLANK_STD_DEV_THRESHOLD;

    setCrops((prev) => [
      ...prev,
      { id: crypto.randomUUID(), image: canvas.toDataURL("image/png"), hasContent },
    ]);
  }, [isCropping, dragRect]);

  return {
    containerRef,
    imageRef,
    isCropping,
    setIsCropping,
    crops,
    setCrops,
    dragRect,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    clearCrops,
  };
}
