"use client";

import React from "react";
import CameraFeed from "./CameraFeed";
import CameraControls from "./CameraControls";
import { useCamera } from "@/hooks/useCamera";
import { Button } from "@/components/ui/Button";

interface CameraCaptureViewProps {
  onCapture: (dataUrl: string) => void;
  onCancel?: () => void;
}

export default function CameraCaptureView({ onCapture, onCancel }: CameraCaptureViewProps) {
  const {
    videoRef,
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    cameraZoom,
    setCameraZoom,
    hasHardwareZoom,
    captureFrame,
    cameraError,
  } = useCamera();

  const handleCapture = () => {
    const frame = captureFrame();
    if (frame) {
      onCapture(frame);
    }
  };

  return (
    <div className="space-y-4 relative">
      {cameraError && (
        <div className="p-4 bg-red-50 text-red-600 rounded-lg text-sm mb-4">
          {cameraError}
        </div>
      )}
      <CameraFeed 
        videoRef={videoRef} 
        cameraZoom={cameraZoom} 
        hasHardwareZoom={hasHardwareZoom} 
      />
      <CameraControls
        devices={devices}
        selectedDeviceId={selectedDeviceId}
        onSelectDevice={setSelectedDeviceId}
        cameraZoom={cameraZoom}
        onZoomChange={setCameraZoom}
        minZoom={1}
        maxZoom={3}
        defaultZoom={1.5}
        onCapture={handleCapture}
      />
      {onCancel && (
        <Button variant="outline" onClick={onCancel} className="w-full mt-2">
          Cancel Camera
        </Button>
      )}
    </div>
  );
}
