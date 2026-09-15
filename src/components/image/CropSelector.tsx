"use client";

import React from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";

export interface CropData {
  id: string;
  image: string;
  hasContent: boolean;
}

interface CropSelectorProps {
  crops: CropData[];
  onRemoveCrop: (id: string) => void;
  isExtracting?: boolean;
}

export default function CropSelector({ crops, onRemoveCrop, isExtracting = false }: CropSelectorProps) {
  if (crops.length === 0) {
    return (
      <div className="text-center p-6 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-900/50">
        No crops selected. Draw bounding boxes on the image to select regions.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 flex items-center justify-between">
        Selected Regions
        <Badge variant="secondary">{crops.length}</Badge>
      </h3>
      
      <div className="grid grid-cols-1 gap-3 max-h-[400px] overflow-y-auto pr-1">
        {crops.map((crop, index) => (
          <Card key={crop.id} className="overflow-hidden border-zinc-200 dark:border-zinc-800">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="flex-shrink-0 w-8 text-center text-xs font-medium text-zinc-400">
                #{index + 1}
              </div>
              
              <div className="flex-1 h-16 bg-zinc-100 dark:bg-zinc-900 rounded border border-zinc-200 dark:border-zinc-700 flex items-center justify-center overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img 
                  src={crop.image} 
                  alt={`Crop ${index + 1}`} 
                  className="max-h-full max-w-full object-contain"
                />
              </div>
              
              <div className="flex-shrink-0 flex flex-col gap-2">
                {!crop.hasContent && (
                  <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400">
                    Empty?
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemoveCrop(crop.id)}
                  disabled={isExtracting}
                  className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                  title="Remove crop"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
