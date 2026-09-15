"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type UseCameraResult = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  devices: MediaDeviceInfo[];
  selectedDeviceId: string;
  setSelectedDeviceId: (id: string) => void;
  cameraZoom: number;
  setCameraZoom: (zoom: number | ((z: number) => number)) => void;
  hasHardwareZoom: boolean;
  cameraError: string | null;
  captureFrame: () => string | null;
};

export const MIN_CAMERA_ZOOM = 1;
export const MAX_CAMERA_ZOOM = 3;
export const DEFAULT_CAMERA_ZOOM = 1.5;

export function useCamera(): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [cameraZoom, setCameraZoom] = useState(DEFAULT_CAMERA_ZOOM);
  const [hasHardwareZoom, setHasHardwareZoom] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const cams = list.filter((d) => d.kind === "videoinput");
      setDevices(cams);
      if (cams.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(cams[0].deviceId);
      }
    } catch {
      // Ignore, handled by stream start error
    }
  }, [selectedDeviceId]);

  useEffect(() => {
    let cancelled = false;

    async function startStream() {
      setCameraError(null);
      try {
        const constraints: MediaStreamConstraints = {
          video: selectedDeviceId
            ? {
                deviceId: { exact: selectedDeviceId },
                width: { ideal: 4096 },
                height: { ideal: 3072 },
              }
            : {
                facingMode: "environment",
                width: { ideal: 4096 },
                height: { ideal: 3072 },
              },
          audio: false,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        
        const track = stream.getVideoTracks()[0];
        setHasHardwareZoom(Boolean(track && "zoom" in track.getCapabilities()));
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        await refreshDevices();
      } catch (err) {
        if (!cancelled) {
          setCameraError(err instanceof Error ? err.message : "Unable to access the camera.");
        }
      }
    }

    startStream();
    return () => {
      cancelled = true;
    };
  }, [selectedDeviceId, refreshDevices]);

  // Handle hardware zoom constraints
  useEffect(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !hasHardwareZoom) return;
    const zoomConstraint = { zoom: cameraZoom } as unknown as MediaTrackConstraintSet;
    track.applyConstraints({ advanced: [zoomConstraint] }).catch(() => {
      setHasHardwareZoom(false);
    });
  }, [cameraZoom, hasHardwareZoom]);

  // Listen for device changes (plug/unplug)
  useEffect(() => {
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    refreshDevices();
    return () => navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
  }, [refreshDevices]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return null;

    const canvas = document.createElement("canvas");
    const sourceWidth = video.videoWidth / cameraZoom;
    const sourceHeight = video.videoHeight / cameraZoom;
    const sourceX = (video.videoWidth - sourceWidth) / 2;
    const sourceY = (video.videoHeight - sourceHeight) / 2;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    
    ctx.drawImage(
      video,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height
    );

    return canvas.toDataURL("image/png");
  }, [cameraZoom]);

  return {
    videoRef,
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    cameraZoom,
    setCameraZoom,
    hasHardwareZoom,
    cameraError,
    captureFrame,
  };
}
