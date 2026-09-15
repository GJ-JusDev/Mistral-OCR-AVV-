"use client";

import React from "react";
import { Button } from "@/components/ui/Button";

export interface Adjustments {
  brightness: number;
  contrast: number;
  sharpness: number;
}

interface ImageAdjustmentsProps {
  adjustments: Adjustments;
  setAdjustments: React.Dispatch<React.SetStateAction<Adjustments>>;
  onReset: () => void;
  disabled?: boolean;
}

export default function ImageAdjustments({
  adjustments,
  setAdjustments,
  onReset,
  disabled = false,
}: ImageAdjustmentsProps) {
  return (
    <div className="flex flex-col gap-4 p-4 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Image Adjustments</h3>
        <Button variant="ghost" size="sm" onClick={onReset} disabled={disabled} className="h-8 text-xs">
          Reset
        </Button>
      </div>

      <div className="space-y-4">
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>Brightness</span>
            <span>{adjustments.brightness}%</span>
          </div>
          <input
            type="range"
            min={50}
            max={250}
            value={adjustments.brightness}
            onChange={(e) => setAdjustments((prev) => ({ ...prev, brightness: Number(e.target.value) }))}
            disabled={disabled}
            className="w-full accent-amber-600"
          />
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>Contrast</span>
            <span>{adjustments.contrast}%</span>
          </div>
          <input
            type="range"
            min={50}
            max={200}
            value={adjustments.contrast}
            onChange={(e) => setAdjustments((prev) => ({ ...prev, contrast: Number(e.target.value) }))}
            disabled={disabled}
            className="w-full accent-amber-600"
          />
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>Sharpness</span>
            <span>{adjustments.sharpness}</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={adjustments.sharpness}
            onChange={(e) => setAdjustments((prev) => ({ ...prev, sharpness: Number(e.target.value) }))}
            disabled={disabled}
            className="w-full accent-amber-600"
          />
        </div>
      </div>
    </div>
  );
}
