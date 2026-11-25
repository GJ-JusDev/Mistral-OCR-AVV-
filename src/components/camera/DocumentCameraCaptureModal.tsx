"use client";

import React, { useState } from "react";
import { useCamera } from "@/hooks/useCamera";
import CameraFeed from "./CameraFeed";
import { Button } from "@/components/ui/Button";
import {
  Camera,
  RotateCcw,
  Check,
  Plus,
  X,
  FlipHorizontal,
  AlertTriangle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

interface DocumentCameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentTitle: string;
  documentCode: string;
  currentStagedCount: number;
  onPhotoCaptured: (dataUrl: string, addAnother?: boolean) => void;
}

export default function DocumentCameraCaptureModal({
  isOpen,
  onClose,
  documentTitle,
  documentCode,
  currentStagedCount,
  onPhotoCaptured,
}: DocumentCameraCaptureModalProps) {
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  const {
    videoRef,
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    cameraZoom,
    setCameraZoom,
    hasHardwareZoom,
    cameraError,
    captureFrame,
    isStreaming,
    switchCamera,
    startCamera,
    stopCamera,
  } = useCamera({ enabled: isOpen && !capturedImage });

  if (!isOpen) return null;

  const handleCapture = () => {
    const frame = captureFrame();
    if (frame) {
      setCapturedImage(frame);
    }
  };

  const handleRetake = () => {
    setCapturedImage(null);
  };

  const handleConfirmPhoto = (addAnother: boolean = false) => {
    if (capturedImage) {
      onPhotoCaptured(capturedImage, addAnother);
      if (addAnother) {
        setCapturedImage(null);
      } else {
        setCapturedImage(null);
        stopCamera();
        onClose();
      }
    }
  };

  const handleClose = () => {
    setCapturedImage(null);
    stopCamera();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="camera-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-xs"
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full max-h-[92vh] shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/60">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-[#174EA6] text-white">
                {documentCode}
              </span>
              <span className="text-xs text-slate-500 font-semibold">
                Page {currentStagedCount + 1} Capture
              </span>
            </div>
            <h4 id="camera-modal-title" className="font-bold text-sm text-slate-900 dark:text-slate-100 mt-0.5">
              Photograph Document: {documentTitle}
            </h4>
          </div>

          <div className="flex items-center gap-2">
            {!capturedImage && devices.length > 1 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={switchCamera}
                className="text-xs h-8 px-2.5 text-slate-700 dark:text-slate-200"
                title="Switch Camera (Front / Rear)"
              >
                <FlipHorizontal className="w-3.5 h-3.5 mr-1" /> Switch
              </Button>
            )}

            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 dark:hover:bg-slate-800"
              title="Close Camera"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Camera Viewport or Frozen Preview */}
        <div className="flex-1 p-4 overflow-y-auto flex flex-col items-center justify-center bg-slate-950 min-h-[300px]">
          {cameraError ? (
            <div className="max-w-md p-6 bg-red-950/40 border border-red-800 rounded-xl text-center text-red-200 space-y-3">
              <AlertTriangle className="w-8 h-8 text-red-400 mx-auto" />
              <div className="font-bold text-sm text-white">Camera Access Error</div>
              <p className="text-xs text-red-300 leading-relaxed">{cameraError}</p>
              <div className="flex justify-center gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => startCamera()}
                  className="text-xs border-red-700 text-red-200 hover:bg-red-900/40"
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1" /> Retry Camera
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleClose}
                  className="text-xs bg-slate-700 hover:bg-slate-600 text-white"
                >
                  Use File Upload Instead
                </Button>
              </div>
            </div>
          ) : capturedImage ? (
            /* Frozen captured preview */
            <div className="relative w-full flex flex-col items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={capturedImage}
                alt="Captured Document Preview"
                className="max-h-[50vh] w-auto max-w-full object-contain rounded-lg shadow-md border border-slate-700"
              />
              <div className="mt-2 text-xs text-emerald-400 font-semibold flex items-center gap-1.5">
                <Check className="w-4 h-4" /> Photo captured successfully. Inspect clarity before confirming.
              </div>
            </div>
          ) : (
            /* Live camera feed */
            <div className="relative w-full max-w-lg aspect-[4/3] overflow-hidden rounded-xl bg-black border border-slate-800 shadow-inner">
              <CameraFeed
                videoRef={videoRef}
                cameraZoom={cameraZoom}
                hasHardwareZoom={hasHardwareZoom}
              />

              {/* Viewfinder Alignment Overlay */}
              <div className="absolute inset-4 pointer-events-none border border-white/20 rounded-lg flex flex-col justify-between p-2">
                <div className="flex justify-between">
                  <div className="w-4 h-4 border-t-2 border-l-2 border-blue-400" />
                  <div className="w-4 h-4 border-t-2 border-r-2 border-blue-400" />
                </div>
                <div className="text-center">
                  <span className="px-2 py-1 rounded bg-black/50 text-[10px] font-semibold text-white/90 backdrop-blur-xs">
                    Align {documentCode} page edges within viewfinder
                  </span>
                </div>
                <div className="flex justify-between">
                  <div className="w-4 h-4 border-b-2 border-l-2 border-blue-400" />
                  <div className="w-4 h-4 border-b-2 border-r-2 border-blue-400" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Controls Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col sm:flex-row items-center justify-between gap-3">
          {capturedImage ? (
            /* Captured photo options */
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRetake}
                className="text-xs text-slate-700 dark:text-slate-300 w-full sm:w-auto"
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Retake Photo
              </Button>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleConfirmPhoto(true)}
                  className="text-xs text-[#174EA6] border-blue-200 dark:border-blue-900 hover:bg-blue-50 w-full sm:w-auto"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" /> Save &amp; Capture Next Page
                </Button>

                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleConfirmPhoto(false)}
                  className="bg-[#174EA6] hover:bg-[#0B1F33] text-white text-xs font-bold px-5 w-full sm:w-auto"
                >
                  <Check className="w-3.5 h-3.5 mr-1.5" /> Use Photo
                </Button>
              </div>
            </>
          ) : (
            /* Live camera controls */
            <>
              {/* Zoom controls */}
              <div className="flex items-center gap-2 w-full sm:w-auto justify-center sm:justify-start">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCameraZoom((z) => Math.max(1, z - 0.2))}
                  disabled={cameraZoom <= 1}
                  className="h-7 w-7 p-0"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </Button>
                <span className="text-xs font-mono text-slate-600 dark:text-slate-400 w-12 text-center">
                  {cameraZoom.toFixed(1)}x
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCameraZoom((z) => Math.min(3, z + 0.2))}
                  disabled={cameraZoom >= 3}
                  className="h-7 w-7 p-0"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </Button>

                {devices.length > 1 && (
                  <select
                    value={selectedDeviceId}
                    onChange={(e) => setSelectedDeviceId(e.target.value)}
                    className="text-[11px] p-1 border rounded-md bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 ml-2 max-w-[140px] truncate"
                  >
                    {devices.map((d, i) => (
                      <option key={d.deviceId || i} value={d.deviceId}>
                        {d.label || `Camera ${i + 1}`}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Shutter button */}
              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleClose}
                  className="text-xs text-slate-600"
                >
                  Cancel
                </Button>

                <Button
                  type="button"
                  size="sm"
                  onClick={handleCapture}
                  disabled={Boolean(cameraError) || !isStreaming}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-6 shadow-sm flex items-center gap-2"
                >
                  <Camera className="w-4 h-4" />
                  Capture Photo
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
