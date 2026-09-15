"use client";

import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";

interface ImageUploaderProps {
  onImageSelected: (dataUrl: string) => void;
}

export default function ImageUploader({ onImageSelected }: ImageUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        onImageSelected(e.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  };

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center transition-colors text-center ${
        isDragging
          ? "border-amber-500 bg-amber-50 dark:bg-amber-950/20"
          : "border-zinc-300 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-600"
      }`}
    >
      <div className="mb-4 text-zinc-500 dark:text-zinc-400">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p className="text-sm font-medium">Drag and drop an image here</p>
        <p className="text-xs mt-1">or</p>
      </div>
      
      <input
        type="file"
        ref={fileInputRef}
        onChange={onChange}
        accept="image/*"
        className="hidden"
      />
      <Button 
        variant="outline" 
        onClick={() => fileInputRef.current?.click()}
      >
        Browse Files
      </Button>
    </div>
  );
}
