"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type UseCameraOptions = {
  enabled?: boolean;
};

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
  isStreaming: boolean;
  stopCamera: () => void;
  startCamera: () => Promise<void>;
  switchCamera: () => void;
};

export const MIN_CAMERA_ZOOM = 1;
export const MAX_CAMERA_ZOOM = 3;
export const DEFAULT_CAMERA_ZOOM = 1.5;

export function useCamera(options?: UseCameraOptions): UseCameraResult {
  const enabled = options?.enabled !== false;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [cameraZoom, setCameraZoom] = useState(DEFAULT_CAMERA_ZOOM);
  const [hasHardwareZoom, setHasHardwareZoom] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  const stopMediaTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const stopCamera = useCallback(() => {
    stopMediaTracks();
    setIsStreaming(false);
  }, [stopMediaTracks]);

  const refreshDevices = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }
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

  const startStream = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        "Camera access is not supported by your browser or environment. Please ensure you are on HTTPS or localhost, or use file upload."
      );
      return;
    }

    try {
      const constraints: MediaStreamConstraints = {
        video: selectedDeviceId
          ? {
              deviceId: { exact: selectedDeviceId },
              width: { ideal: 4096 },
              height: { ideal: 3072 },
            }
          : {
              facingMode: facingMode,
              width: { ideal: 4096 },
              height: { ideal: 3072 },
            },
        audio: false,
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (firstErr) {
        // Fallback to basic video constraint if ideal 4K is rejected
        if ((firstErr as Error).name === "OverconstrainedError" || (firstErr as Error).name === "ConstraintNotSatisfiedError") {
          stream = await navigator.mediaDevices.getUserMedia({
            video: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : { facingMode: facingMode },
            audio: false,
          });
        } else {
          throw firstErr;
        }
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      streamRef.current = stream;

      const track = stream.getVideoTracks()[0];
      setHasHardwareZoom(Boolean(track && "zoom" in track.getCapabilities()));

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch(() => {});
        };
      }
      setCameraError(null);
      setIsStreaming(true);
      await refreshDevices();
    } catch (err) {
      setIsStreaming(false);
      const errorName = (err as Error)?.name || "";
      if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError") {
        setCameraError(
          "Camera permission was denied. Please allow camera access in your browser address bar settings to take photos of DepEd documents."
        );
      } else if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
        setCameraError("No camera device was detected on your system. Please connect a camera or use file upload.");
      } else if (errorName === "NotReadableError" || errorName === "TrackStartError") {
        setCameraError(
          "The camera is currently in use by another application or tab. Please close other camera apps and try again."
        );
      } else {
        setCameraError(err instanceof Error ? err.message : "Unable to access the camera.");
      }
    }
  }, [selectedDeviceId, facingMode, refreshDevices]);

  useEffect(() => {
    let cancelled = false;

    if (!enabled) {
      stopMediaTracks();
      return;
    }

    const init = async () => {
      await startStream();
      if (cancelled) {
        stopMediaTracks();
      }
    };

    void init();

    return () => {
      cancelled = true;
      stopMediaTracks();
    };
  }, [enabled, selectedDeviceId, facingMode, startStream, stopMediaTracks]);

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
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.addEventListener) {
      return;
    }
    const handler = () => {
      void refreshDevices();
    };
    navigator.mediaDevices.addEventListener("devicechange", handler);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handler);
    };
  }, [refreshDevices]);

  // Switch camera: cycle devices or flip facing mode
  const switchCamera = useCallback(() => {
    if (devices.length > 1) {
      const currentIndex = devices.findIndex((d) => d.deviceId === selectedDeviceId);
      const nextIndex = (currentIndex + 1) % devices.length;
      setSelectedDeviceId(devices[nextIndex].deviceId);
    } else {
      setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
      // Clear selectedDeviceId so facingMode takes effect
      setSelectedDeviceId("");
    }
  }, [devices, selectedDeviceId]);

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

    return canvas.toDataURL("image/jpeg", 0.92);
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
    isStreaming,
    stopCamera,
    startCamera: startStream,
    switchCamera,
  };
}
