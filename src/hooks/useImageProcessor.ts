"use client";

import { useEffect, useState } from "react";
import { processImage, type ImageAdjustments, DEFAULT_ADJUSTMENTS } from "@/lib/ocr/image-utils";
import { useDebounce } from "./useDebounce";

export type UseImageProcessorResult = {
  rawImage: string | null;
  setRawImage: (img: string | null) => void;
  processedImage: string | null;
  adjustments: ImageAdjustments;
  setAdjustments: React.Dispatch<React.SetStateAction<ImageAdjustments>>;
  resetAdjustments: () => void;
  isProcessing: boolean;
};

export function useImageProcessor(): UseImageProcessorResult {
  const [rawImage, setRawImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [adjustments, setAdjustments] = useState<ImageAdjustments>(DEFAULT_ADJUSTMENTS);
  const [isProcessing, setIsProcessing] = useState(false);

  // Debounce adjustments to avoid stuttering canvas rendering
  const debouncedAdjustments = useDebounce(adjustments, 150);

  useEffect(() => {
    if (!rawImage) {
      setProcessedImage(null);
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
        setProcessedImage(processImage(img, debouncedAdjustments));
        setIsProcessing(false);
      }, 0);
    };
    img.src = rawImage;
    
    return () => {
      cancelled = true;
    };
  }, [rawImage, debouncedAdjustments]);

  const resetAdjustments = () => setAdjustments(DEFAULT_ADJUSTMENTS);

  return {
    rawImage,
    setRawImage,
    processedImage,
    adjustments,
    setAdjustments,
    resetAdjustments,
    isProcessing,
  };
}
