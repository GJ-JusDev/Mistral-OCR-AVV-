"use client";

import React from "react";
import { Button } from "@/components/ui/Button";

interface CameraControlsProps {
  devices: MediaDeviceInfo[];
  selectedDeviceId: string;
  onSelectDevice: (id: string) => void;
  cameraZoom: number;
  onZoomChange: (zoom: number) => void;
  minZoom: number;
  maxZoom: number;
  defaultZoom: number;
  onCapture: () => void;
}

export default function CameraControls({
  devices,
  selectedDeviceId,
  onSelectDevice,
  cameraZoom,
  onZoomChange,
  minZoom,
  maxZoom,
  defaultZoom,
  onCapture,
}: CameraControlsProps) {
  return (
    <div className="flex flex-col gap-4 p-4 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="flex-1 w-full sm:w-auto">
          <label htmlFor="camera-select" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            Camera
          </label>
          <select
            id="camera-select"
            value={selectedDeviceId}
            onChange={(e) => onSelectDevice(e.target.value)}
            className="block w-full rounded-md border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 shadow-sm focus:border-amber-500 focus:ring-amber-500 sm:text-sm p-2 border"
          >
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Camera ${device.deviceId.substring(0, 5)}`}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 w-full sm:w-auto flex flex-col items-center">
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1 w-full text-center">
            Zoom ({cameraZoom.toFixed(1)}x)
          </label>
          <div className="flex items-center gap-2 w-full">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onZoomChange(Math.max(minZoom, cameraZoom - 0.1))}
              disabled={cameraZoom <= minZoom}
            >
              -
            </Button>
            <input
              type="range"
              min={minZoom}
              max={maxZoom}
              step={0.1}
              value={cameraZoom}
              onChange={(e) => onZoomChange(parseFloat(e.target.value))}
              className="w-full accent-amber-600"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onZoomChange(Math.min(maxZoom, cameraZoom + 0.1))}
              disabled={cameraZoom >= maxZoom}
            >
              +
            </Button>
          </div>
        </div>
      </div>

      <div className="flex justify-center pt-2 border-t border-zinc-200 dark:border-zinc-800">
        <Button onClick={onCapture} className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white px-8 py-2">
          Capture Frame
        </Button>
      </div>
    </div>
  );
}
