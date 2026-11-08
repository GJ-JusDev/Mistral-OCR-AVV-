"use client";

import React from "react";
import type { PsaLiveDetectionResult } from "@/lib/image/psaIdentityDetector";
import { CheckCircle2, ShieldCheck, AlertCircle, Scan } from "lucide-react";

interface CameraFeedProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  cameraZoom: number;
  hasHardwareZoom: boolean;
  docCategory?: "sf9" | "sf10" | "birth_cert";
  detectionResult?: PsaLiveDetectionResult | null;
}

function getPolygonColors(id: string) {
  switch (id) {
    case "child_first":
    case "child_middle":
    case "child_last":
      return {
        fill: "rgba(59, 130, 246, 0.16)",
        stroke: "rgba(96, 165, 250, 0.95)",
        textColor: "#bfdbfe",
      };
    case "child_sex":
      return {
        fill: "rgba(168, 85, 247, 0.16)",
        stroke: "rgba(192, 132, 252, 0.9)",
        textColor: "#e9d5ff",
      };
    case "child_dob":
      return {
        fill: "rgba(245, 158, 11, 0.16)",
        stroke: "rgba(251, 191, 36, 0.9)",
        textColor: "#fef08a",
      };
    case "child_pob":
      return {
        fill: "rgba(99, 102, 241, 0.16)",
        stroke: "rgba(129, 140, 248, 0.9)",
        textColor: "#e0e7ff",
      };
    case "mother_name":
      return {
        fill: "rgba(20, 184, 166, 0.16)",
        stroke: "rgba(45, 212, 191, 0.95)",
        textColor: "#99f6e4",
      };
    case "father_name":
      return {
        fill: "rgba(16, 185, 129, 0.16)",
        stroke: "rgba(52, 211, 153, 0.95)",
        textColor: "#a7f3d0",
      };
    default:
      return {
        fill: "rgba(255, 255, 255, 0.10)",
        stroke: "rgba(255, 255, 255, 0.7)",
        textColor: "#ffffff",
      };
  }
}

function getCompactLabel(id: string) {
  switch (id) {
    case "child_first":
      return "1. FIRST";
    case "child_middle":
      return "MIDDLE";
    case "child_last":
      return "LAST";
    case "child_sex":
      return "2. SEX";
    case "child_dob":
      return "3. DOB";
    case "child_pob":
      return "4. POB";
    case "mother_name":
      return "6. MOTHER";
    case "father_name":
      return "13. FATHER";
    default:
      return id;
  }
}

export default function CameraFeed({
  videoRef,
  cameraZoom,
  hasHardwareZoom,
  docCategory,
  detectionResult,
}: CameraFeedProps) {
  const isPsa = docCategory === "birth_cert";

  return (
    <div className="relative w-full aspect-[4/3] bg-zinc-950 overflow-hidden rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          transform: !hasHardwareZoom ? `scale(${cameraZoom})` : "none",
          transformOrigin: "center center",
          transition: "transform 0.2s ease-out",
        }}
      />

      {/* Live PSA Overlay */}
      {isPsa && detectionResult && (
        <div className="absolute inset-0 pointer-events-none z-10 flex flex-col justify-between p-3">
          {/* Top Status Pill */}
          <div className="self-center flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold backdrop-blur-md shadow-md transition-all duration-200">
            {detectionResult.state === "READY" && (
              <span className="flex items-center gap-1.5 text-emerald-400 bg-emerald-950/90 border border-emerald-500/60 px-3 py-1 rounded-full">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                ✓ PSA aligned — Ready to Capture
              </span>
            )}
            {detectionResult.state === "IDENTITY_DETECTED" && (
              <span className="flex items-center gap-1.5 text-blue-300 bg-blue-950/90 border border-blue-500/60 px-3 py-1 rounded-full">
                <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
                ✓ PSA aligned — Identity Area Detected
              </span>
            )}
            {detectionResult.state === "HOLD_STEADY" && (
              <span className="flex items-center gap-1.5 text-amber-300 bg-amber-950/90 border border-amber-500/60 px-3 py-1 rounded-full">
                <Scan className="w-3.5 h-3.5 text-amber-400" />
                PSA aligned — Hold Steady
              </span>
            )}
            {detectionResult.state === "NO_DOCUMENT" && (
              <span className="flex items-center gap-1.5 text-rose-300 bg-rose-950/90 border border-rose-500/60 px-3 py-1 rounded-full">
                <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                PSA alignment lost — reposition document
              </span>
            )}
          </div>

          {/* Document Boundary, Identity Area, and Field Guides */}
          <div className="absolute inset-0 overflow-hidden">
            {/* 1. Whole Document Boundary */}
            {detectionResult.paperBox && detectionResult.state !== "NO_DOCUMENT" && (
              <div
                className="absolute border-2 border-dashed border-cyan-400/60 rounded-md transition-all duration-150"
                style={{
                  left: `${detectionResult.paperBox.x * 100}%`,
                  top: `${detectionResult.paperBox.y * 100}%`,
                  width: `${detectionResult.paperBox.width * 100}%`,
                  height: `${detectionResult.paperBox.height * 100}%`,
                }}
              >
                <span className="absolute -top-5 left-1 text-[10px] font-mono font-bold text-cyan-300/90 tracking-wider">
                  PSA PAPER BOUNDARY {detectionResult.isSideways ? "(90° ROTATED)" : ""}
                </span>
              </div>
            )}

            {/* 2. Target Identity Region (Child • Mother • Father) */}
            {detectionResult.identityBox && detectionResult.state !== "NO_DOCUMENT" && (
              <div
                className="absolute border-2 border-emerald-400 bg-emerald-500/10 shadow-[0_0_20px_rgba(52,211,153,0.3)] rounded-md transition-all duration-150"
                style={{
                  left: `${detectionResult.identityBox.x * 100}%`,
                  top: `${detectionResult.identityBox.y * 100}%`,
                  width: `${detectionResult.identityBox.width * 100}%`,
                  height: `${detectionResult.identityBox.height * 100}%`,
                }}
              >
                <div className="absolute top-1 left-1.5 bg-emerald-950/90 border border-emerald-500/50 text-emerald-300 text-[10px] font-bold px-1.5 py-0.5 rounded shadow-xs flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  PSA IDENTITY REGION (CHILD • MOTHER • FATHER)
                </div>
              </div>
            )}

            {/* 3. Live Quadrilateral Field Guides (SVG Polygons preserving perspective & rotation) */}
            {detectionResult.state !== "NO_DOCUMENT" && (
              <>
                {/* Safety Fallback: When guides cannot be confidently shown, display align banner and suppress guides */}
                {!detectionResult.canShowGuides && (
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-zinc-950/90 border border-amber-500/70 text-amber-300 text-xs font-semibold px-4 py-2 rounded-lg shadow-xl flex items-center gap-2 backdrop-blur-md z-20">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                    <span>PSA detected — Hold steady / align document</span>
                  </div>
                )}

                {/* True Quadrilateral SVG Polygons */}
                {detectionResult.canShowGuides && detectionResult.fieldPolygons && (
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none z-10"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                  >
                    <defs>
                      <marker
                        id="arrow-red"
                        viewBox="0 0 10 10"
                        refX="6"
                        refY="5"
                        markerWidth="4"
                        markerHeight="4"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 1 L 8 5 L 0 9 z" fill="#ef4444" />
                      </marker>
                      <marker
                        id="arrow-green"
                        viewBox="0 0 10 10"
                        refX="6"
                        refY="5"
                        markerWidth="4"
                        markerHeight="4"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 1 L 8 5 L 0 9 z" fill="#22c55e" />
                      </marker>
                    </defs>

                    {/* Development-Only Canonical Axes & Landmark Debugging */}
                    {process.env.NODE_ENV === "development" && detectionResult.canonicalAxesDebug && (
                      <g className="canonical-axes-debug">
                        {/* U Vector Arrow (Red) */}
                        <line
                          x1={detectionResult.canonicalAxesDebug.originPoint.x * 100}
                          y1={detectionResult.canonicalAxesDebug.originPoint.y * 100}
                          x2={detectionResult.canonicalAxesDebug.uVectorEnd.x * 100}
                          y2={detectionResult.canonicalAxesDebug.uVectorEnd.y * 100}
                          stroke="#ef4444"
                          strokeWidth="0.75"
                          markerEnd="url(#arrow-red)"
                        />
                        {/* V Vector Arrow (Green) */}
                        <line
                          x1={detectionResult.canonicalAxesDebug.originPoint.x * 100}
                          y1={detectionResult.canonicalAxesDebug.originPoint.y * 100}
                          x2={detectionResult.canonicalAxesDebug.vVectorEnd.x * 100}
                          y2={detectionResult.canonicalAxesDebug.vVectorEnd.y * 100}
                          stroke="#22c55e"
                          strokeWidth="0.75"
                          markerEnd="url(#arrow-green)"
                        />
                        {/* U -> label */}
                        <text
                          x={detectionResult.canonicalAxesDebug.uVectorEnd.x * 100 + 1}
                          y={detectionResult.canonicalAxesDebug.uVectorEnd.y * 100 + 1}
                          fill="#ef4444"
                          fontSize="2.4"
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          U →
                        </text>
                        {/* V v label */}
                        <text
                          x={detectionResult.canonicalAxesDebug.vVectorEnd.x * 100 + 1}
                          y={detectionResult.canonicalAxesDebug.vVectorEnd.y * 100 + 1}
                          fill="#22c55e"
                          fontSize="2.4"
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          V ↓
                        </text>
                        {/* Top / Bottom canonical labels */}
                        <text
                          x={detectionResult.canonicalAxesDebug.topPoint.x * 100}
                          y={detectionResult.canonicalAxesDebug.topPoint.y * 100}
                          fill="#38bdf8"
                          fontSize="2.6"
                          fontFamily="monospace"
                          fontWeight="bold"
                          textAnchor="middle"
                        >
                          ▲ TOP (HEADER)
                        </text>
                        <text
                          x={detectionResult.canonicalAxesDebug.bottomPoint.x * 100}
                          y={detectionResult.canonicalAxesDebug.bottomPoint.y * 100}
                          fill="#38bdf8"
                          fontSize="2.2"
                          fontFamily="monospace"
                          fontWeight="bold"
                          textAnchor="middle"
                        >
                          ▼ BOTTOM (REGISTRAR)
                        </text>
                      </g>
                    )}

                    {/* Canonical Item Row Outlines (Item 1, 2/3, 4, 6, 13) */}
                    {detectionResult.itemRowPolygons &&
                      Object.entries(detectionResult.itemRowPolygons).map(([key, row]) => {
                        const pts = row.points.map((p) => `${p.x * 100},${p.y * 100}`).join(" ");
                        return (
                          <polygon
                            key={`row_${key}`}
                            points={pts}
                            fill="none"
                            stroke="rgba(255, 255, 255, 0.25)"
                            strokeWidth="0.3"
                            strokeDasharray="1.5,1.5"
                          />
                        );
                      })}

                    {/* Subdivided Field Polygons */}
                    {Object.entries(detectionResult.fieldPolygons).map(([id, poly]) => {
                      const pts = poly.points.map((p) => `${p.x * 100},${p.y * 100}`).join(" ");
                      const colors = getPolygonColors(id);

                      return (
                        <g key={id} className="transition-all duration-150">
                          <polygon
                            points={pts}
                            fill={colors.fill}
                            stroke={colors.stroke}
                            strokeWidth="0.45"
                          />
                          {/* Compact label attached to polygon labelPoint */}
                          <text
                            x={poly.labelPoint.x * 100 + 0.8}
                            y={poly.labelPoint.y * 100 + 2.4}
                            fill={colors.textColor}
                            fontSize="1.9"
                            fontFamily="monospace"
                            fontWeight="bold"
                            className="select-none filter drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
                          >
                            {getCompactLabel(id)}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                )}
              </>
            )}
          </div>

          {/* Bottom Guidance Hint */}
          <div className="self-center text-[11px] text-zinc-300 bg-zinc-950/80 px-3 py-1 rounded-md backdrop-blur-xs border border-zinc-800">
            {detectionResult.isSideways
              ? "Sideways certificate detected — auto-rotating upright on capture"
              : "Align identity area inside the green box for high-resolution OCR"}
          </div>
        </div>
      )}
    </div>
  );
}
