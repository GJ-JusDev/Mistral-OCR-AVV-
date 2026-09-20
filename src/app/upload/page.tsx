"use client";

import React, { useState } from "react";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";

import { useCamera } from "@/hooks/useCamera";
import { useImageProcessor } from "@/hooks/useImageProcessor";
import { useCropper } from "@/hooks/useCropper";
import { useOcr, OcrResponse } from "@/hooks/useOcr";

import CameraFeed from "@/components/camera/CameraFeed";
import CameraControls from "@/components/camera/CameraControls";
import ImageUploader from "@/components/camera/ImageUploader";

import ImagePreview from "@/components/image/ImagePreview";
import ImageAdjustments from "@/components/image/ImageAdjustments";

import ExtractButton from "@/components/ocr/ExtractButton";
import OcrResultCard from "@/components/ocr/OcrResultCard";
import { ExtractedFields } from "@/types/documents";

import Link from "next/link";

export default function UploadPage() {
  const [mode, setMode] = useState<"camera" | "upload">("camera");
  const [gradeLevel, setGradeLevel] = useState<"Elementary" | "High School" | "Senior High School">("Senior High School");
  const [ocrResult, setOcrResult] = useState<OcrResponse | null>(null);

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const {
    videoRef,
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    cameraZoom,
    setCameraZoom,
    hasHardwareZoom,
    captureFrame,
  } = useCamera();

  const {
    rawImage,
    setRawImage,
    processedImage,
    adjustments,
    setAdjustments,
    resetAdjustments,
    isProcessing,
  } = useImageProcessor();

  const {
    containerRef,
    imageRef,
    isCropping,
    dragRect,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  } = useCropper();

  const { extract, isExtracting, error } = useOcr();

  const handleCapture = () => {
    const frame = captureFrame();
    if (frame) {
      setRawImage(frame);
    }
  };

  const handleImageSelected = (dataUrl: string) => {
    setRawImage(dataUrl);
  };

  const handleExtract = async () => {
    if (!processedImage) return;
    try {
      const result = await extract(processedImage, true, gradeLevel);
      setOcrResult(result);
      console.log("Extraction succeeded", result);
    } catch (err) {
      console.error("Extraction failed", err);
    }
  };

  const handleFieldChange = (field: keyof ExtractedFields, value: string) => {
    if (!ocrResult || !ocrResult.fields) return;
    setOcrResult({
      ...ocrResult,
      fields: {
        ...ocrResult.fields,
        [field]: value,
      },
    });
  };

  const handleUploadToSupabase = async () => {
    if (!ocrResult?.fields) return;
    setIsUploading(true);
    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_type: "Unknown",
          image_url: "uploaded-from-single-page", // placeholder
          extracted_text: ocrResult.text || "Extracted Text",
          extracted_fields: ocrResult.fields,
          status: "pending"
        })
      });
      if (res.ok) {
        setUploadSuccess(true);
        setTimeout(() => {
          setShowUploadModal(false);
          setUploadSuccess(false);
        }, 2000);
      } else {
        alert("Upload failed.");
      }
    } catch (e) {
      console.error(e);
      alert("Upload error.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <PageContainer>
      <Header 
        title="Upload Document" 
        description="Capture or upload a document for OCR extraction"
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Upload Document" }
        ]}
        actions={
          <Link 
            href="/compare"
            className="ml-auto inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md shadow-sm hover:bg-indigo-700"
          >
            Compare Documents
          </Link>
        }
      />

      <div className="mt-6 flex flex-col lg:flex-row gap-6">
        {/* Left Column: Input (Camera or Upload) */}
        <div className="flex-1 space-y-4">
          <div className="flex flex-col gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                Grade Level
              </label>
              <div className="flex flex-wrap gap-2">
                {(["Elementary", "High School", "Senior High School"] as const).map((level) => (
                  <button
                    key={level}
                    onClick={() => setGradeLevel(level)}
                    className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                      gradeLevel === level
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                    }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setMode("camera")}
                className={`px-4 py-2 text-sm font-medium rounded-md ${
                  mode === "camera" 
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" 
                    : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                }`}
              >
                Camera
              </button>
              <button
                onClick={() => setMode("upload")}
                className={`px-4 py-2 text-sm font-medium rounded-md ${
                  mode === "upload" 
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" 
                    : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                }`}
              >
                Upload
              </button>
            </div>
          </div>

          {mode === "camera" ? (
            <div className="space-y-4">
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
            </div>
          ) : (
            <ImageUploader onImageSelected={handleImageSelected} />
          )}
        </div>

        {/* Right Column: Preview and Adjustments */}
        <div className="flex-1 space-y-4">
          {rawImage || processedImage ? (
            <>
              <ImagePreview
                image={(processedImage || rawImage) as string}
                isCropping={isCropping}
                containerRef={containerRef}
                imageRef={imageRef}
                dragRect={dragRect}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              />
              <ImageAdjustments
                adjustments={adjustments}
                setAdjustments={setAdjustments}
                onReset={resetAdjustments}
                disabled={isProcessing}
              />
              
              <div className="flex flex-col gap-2">
                <ExtractButton 
                  onClick={handleExtract} 
                  isExtracting={isExtracting} 
                  disabled={isProcessing || !processedImage} 
                />
                {error && <span className="text-sm text-red-500">{error}</span>}
              </div>
            </>
          ) : (
            <div className="h-full min-h-[300px] flex items-center justify-center border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-900">
              <p className="text-zinc-500 dark:text-zinc-400">Capture or upload an image to preview</p>
            </div>
          )}
        </div>
      </div>

      {/* Results Section */}
      {ocrResult && (
        <div className="mt-8 space-y-6">
          <OcrResultCard 
            fields={ocrResult.fields || null} 
            onFieldChange={handleFieldChange} 
            rawText={ocrResult.text}
          />
          <div className="flex justify-center mt-6">
            <button
              onClick={() => setShowUploadModal(true)}
              className="py-4 px-8 text-lg font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-md flex items-center gap-2"
            >
              Upload Data to Supabase
            </button>
          </div>
        </div>
      )}

      {showUploadModal && ocrResult?.fields && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-zinc-900 w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col gap-6 relative rounded-xl shadow-xl p-6">
            <button 
              onClick={() => setShowUploadModal(false)}
              className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-800"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
            </button>
            
            <h2 className="text-2xl font-bold flex items-center gap-2 text-zinc-900 dark:text-white">
              Confirm Upload to Supabase
            </h2>
            
            <p className="text-zinc-600 dark:text-zinc-400">
              Are you ready to upload this data to Supabase? The document status will be set to <strong>pending</strong>.
            </p>

            <div className="bg-zinc-50 dark:bg-zinc-800 border dark:border-zinc-700 p-4 rounded-lg space-y-4">
              <div>
                <span className="text-xs font-semibold text-zinc-500 uppercase">Student Full Name</span>
                <p className="font-medium text-lg dark:text-white">{ocrResult.fields.name || "-"}</p>
              </div>

              {ocrResult.fields.grades && ocrResult.fields.grades.length > 0 && (
                <div>
                  <span className="text-xs font-semibold text-zinc-500 uppercase">Grades Overview ({ocrResult.fields.grades.length} subjects)</span>
                  <div className="mt-2 text-sm max-h-32 overflow-y-auto border dark:border-zinc-600 rounded bg-white dark:bg-zinc-900 p-2">
                    {ocrResult.fields.grades.map((g: any, i: number) => (
                      <div key={i} className="flex justify-between border-b dark:border-zinc-700 last:border-0 py-1">
                        <span className="truncate pr-4 dark:text-zinc-300">{g.subject}</span>
                        <span className="font-mono font-medium dark:text-zinc-100">{g.final ?? "-"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {ocrResult.fields.attendance && ocrResult.fields.attendance.length > 0 && (
                <div>
                  <span className="text-xs font-semibold text-zinc-500 uppercase">Attendance Overview</span>
                  <div className="mt-2 text-sm border dark:border-zinc-600 rounded bg-white dark:bg-zinc-900 p-2">
                    <p className="text-xs text-zinc-500 mb-1">Months: {(ocrResult.fields.attendance_months || []).join(", ")}</p>
                    {ocrResult.fields.attendance.map((a: any, i: number) => (
                      <div key={i} className="flex justify-between border-b dark:border-zinc-700 last:border-0 py-1">
                        <span className="dark:text-zinc-300">{a.label}</span>
                        <span className="font-mono dark:text-zinc-400">{a.values.length} values</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-4 justify-end mt-4">
              <button 
                className="px-4 py-2 rounded-md font-medium bg-zinc-200 hover:bg-zinc-300 text-zinc-900"
                onClick={() => setShowUploadModal(false)}
              >
                Cancel
              </button>
              <button 
                onClick={handleUploadToSupabase} 
                disabled={isUploading || uploadSuccess}
                className={`px-4 py-2 rounded-md font-medium text-white ${uploadSuccess ? "bg-emerald-600 hover:bg-emerald-700" : "bg-indigo-600 hover:bg-indigo-700"}`}
              >
                {uploadSuccess ? "Uploaded Successfully!" : isUploading ? "Uploading..." : "Confirm & Upload"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
