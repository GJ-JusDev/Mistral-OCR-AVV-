"use client";

import { useCallback, useEffect, useState } from "react";
import {
  processImage,
  resolveEffectiveAdjustments,
  type ImageAdjustments,
  DEFAULT_ADJUSTMENTS,
} from "@/lib/ocr/image-utils";
import { useDebounce } from "./useDebounce";

export type UseImageProcessorOptions = {
  lockDefaultAdjustments?: boolean;
};

export type UseImageProcessorResult = {
  rawImage: string | null;
  setRawImage: (img: string | null) => void;
  processedImage: string | null;
  adjustments: ImageAdjustments;
  setAdjustments: React.Dispatch<React.SetStateAction<ImageAdjustments>>;
  resetAdjustments: () => void;
  isProcessing: boolean;
};

export function useImageProcessor(
  options?: UseImageProcessorOptions
): UseImageProcessorResult {
  const lockDefaults = Boolean(options?.lockDefaultAdjustments);
  const [rawImage, setRawImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [adjustments, setAdjustmentsState] = useState<ImageAdjustments>(DEFAULT_ADJUSTMENTS);
  const [isProcessing, setIsProcessing] = useState(false);

  const effectiveAdjustments = resolveEffectiveAdjustments(adjustments, { lockDefaults });

  // Debounce adjustments to avoid stuttering canvas rendering
  const debouncedAdjustments = useDebounce(effectiveAdjustments, 150);

  const setAdjustments: React.Dispatch<React.SetStateAction<ImageAdjustments>> = useCallback(
    (action) => {
      if (lockDefaults) {
        setAdjustmentsState(DEFAULT_ADJUSTMENTS);
        return;
      }
      setAdjustmentsState((prev) => {
        const next = typeof action === "function" ? action(prev) : action;
        return resolveEffectiveAdjustments(next);
      });
    },
    [lockDefaults]
  );

  useEffect(() => {
    if (!rawImage) {
      setProcessedImage(null);
      setIsProcessing(false);
      return;
    }

    if (!rawImage.startsWith("data:image/")) {
      setProcessedImage(null);
      setIsProcessing(false);
      return;
    }

    let cancelled = false;
    setIsProcessing(true);

    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      // We wrap in setTimeout to allow the UI to show the processing state
      setTimeout(() => {
        if (cancelled) return;
        const resolved = lockDefaults
          ? DEFAULT_ADJUSTMENTS
          : resolveEffectiveAdjustments(debouncedAdjustments);
        setProcessedImage(processImage(img, resolved));
        setIsProcessing(false);
      }, 0);
    };
    img.onerror = () => {
      if (cancelled) return;
      setProcessedImage(null);
      setIsProcessing(false);
    };
    img.src = rawImage;
    
    return () => {
      cancelled = true;
    };
  }, [rawImage, debouncedAdjustments, lockDefaults]);

  const resetAdjustments = useCallback(() => {
    setAdjustmentsState(DEFAULT_ADJUSTMENTS);
  }, []);

  return {
    rawImage,
    setRawImage,
    processedImage,
    adjustments: effectiveAdjustments,
    setAdjustments,
    resetAdjustments,
    isProcessing,
  };
}
