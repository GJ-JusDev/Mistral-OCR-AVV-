"use client";

import React, { useState, useMemo } from "react";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import ImageUploader from "@/components/camera/ImageUploader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useOcr } from "@/hooks/useOcr";
import type { ExtractedFields } from "@/types/documents";
import { getAuthoritativeSemesterFinalGrade } from "@/lib/validation/gradeUtils";
import {
  compareDocuments,
  type DocumentComparisonSummary,
  type ComparisonStatus,
} from "@/lib/validation/documentComparator";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  HelpCircle,
  Camera,
  Upload,
  UploadCloud,
  FileCheck2,
} from "lucide-react";
import Link from "next/link";
import CameraCaptureView from "@/components/camera/CameraCaptureView";

export default function ComparePage() {
  const [doc1Image, setDoc1Image] = useState<string | null>(null);
  const [doc2Image, setDoc2Image] = useState<string | null>(null);
  const [doc3Image, setDoc3Image] = useState<string | null>(null); // Optional PSA

  const [doc1Mode, setDoc1Mode] = useState<"upload" | "camera">("upload");
  const [doc2Mode, setDoc2Mode] = useState<"upload" | "camera">("upload");
  const [doc3Mode, setDoc3Mode] = useState<"upload" | "camera">("upload");

  const [doc1Result, setDoc1Result] = useState<ExtractedFields | null>(null);
  const [doc2Result, setDoc2Result] = useState<ExtractedFields | null>(null);
  const [doc3Result, setDoc3Result] = useState<ExtractedFields | null>(null);

  const [showDoc3, setShowDoc3] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const {
    extract,
    isExtracting,
    error,
    errorDetails,
    retryAfter,
  } = useOcr();

  const handleCompare = async () => {
    if (!doc1Image || !doc2Image || isExtracting || (retryAfter !== null && retryAfter > 0)) return;

    try {
      const res1 = await extract(doc1Image, true, "Senior High School", "sf9");
      setDoc1Result(res1.fields || null);

      const res2 = await extract(doc2Image, true, "Senior High School", "sf10");
      setDoc2Result(res2.fields || null);

      if (doc3Image) {
        const res3 = await extract(doc3Image, true, "PSA", "birth_cert");
        setDoc3Result(res3.fields || null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const comparison: DocumentComparisonSummary | null = useMemo(() => {
    if (!doc1Result && !doc2Result) return null;
    return compareDocuments(
      doc1Result || {},
      doc2Result || {},
      doc3Result || undefined
    );
  }, [doc1Result, doc2Result, doc3Result]);

  const handleModeChange = (doc: 1 | 2 | 3, mode: "upload" | "camera") => {
    if (doc === 1) {
      setDoc1Mode(mode);
      if (mode === "camera") {
        setDoc2Mode("upload");
        setDoc3Mode("upload");
      }
    } else if (doc === 2) {
      setDoc2Mode(mode);
      if (mode === "camera") {
        setDoc1Mode("upload");
        setDoc3Mode("upload");
      }
    } else {
      setDoc3Mode(mode);
      if (mode === "camera") {
        setDoc1Mode("upload");
        setDoc2Mode("upload");
      }
    }
  };

  const mergedFields: ExtractedFields = {
    ...doc1Result,
    ...doc2Result,
    name: doc2Result?.name || doc1Result?.name,
    lrn: doc2Result?.lrn || doc1Result?.lrn,
    grades: doc2Result?.grades || doc1Result?.grades,
    attendance: doc2Result?.attendance || doc1Result?.attendance,
    attendance_months: doc2Result?.attendance_months || doc1Result?.attendance_months,
  };

  const handleUploadToSupabase = async () => {
    setIsUploading(true);
    try {
      const imageToUpload = doc2Image || doc1Image;
      let finalImageUrl = imageToUpload || "uploaded-from-compare";
      let originalFilename = "sf10_comparison.jpg";

      if (imageToUpload && imageToUpload.startsWith("data:image/")) {
        try {
          const storageRes = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dataUrl: imageToUpload,
              filename: `sf10_${Date.now()}.jpg`,
              docType: "sf10",
            }),
          });
          if (storageRes.ok) {
            const storageData = await storageRes.json();
            if (storageData.url) {
              finalImageUrl = storageData.url;
              originalFilename = storageData.originalFilename || originalFilename;
            }
          }
        } catch (storageErr) {
          console.warn("[upload] Storage API fallback:", storageErr);
        }
      }

      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_type: "sf10",
          image_url: finalImageUrl,
          original_filename: originalFilename,
          extracted_text: "Combined from Compare",
          extracted_fields: mergedFields,
          status: "submitted",
        }),
      });

      if (res.ok) {
        setUploadSuccess(true);
        setTimeout(() => {
          setShowUploadModal(false);
          setUploadSuccess(false);
        }, 2000);
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(`Upload failed: ${errData.error || "Unknown error"}`);
      }
    } catch (e) {
      console.error(e);
      alert("Upload error.");
    } finally {
      setIsUploading(false);
    }
  };

  const renderStatusBadge = (status: ComparisonStatus) => {
    switch (status) {
      case "MATCH":
        return (
          <span className="inline-flex items-center text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded text-xs font-bold">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-500" /> MATCH
          </span>
        );
      case "MISMATCH":
        return (
          <span className="inline-flex items-center text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-2 py-0.5 rounded text-xs font-bold">
            <XCircle className="w-3.5 h-3.5 mr-1 text-red-500" /> MISMATCH
          </span>
        );
      case "NEEDS_VERIFICATION":
        return (
          <span className="inline-flex items-center text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded text-xs font-bold">
            <AlertTriangle className="w-3.5 h-3.5 mr-1 text-amber-500" /> NEEDS VERIFICATION
          </span>
        );
      case "MISSING_DATA":
        return (
          <span className="inline-flex items-center text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded text-xs font-medium">
            <HelpCircle className="w-3.5 h-3.5 mr-1 text-zinc-400" /> MISSING DATA
          </span>
        );
      case "NOT_APPLICABLE":
      default:
        return (
          <span className="inline-flex items-center text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded text-xs font-medium">
            N/A
          </span>
        );
    }
  };

  return (
    <PageContainer>
      <Header
        title="Verify SF9 and SF10"
        description="Verify that the SF9 and SF10 belong to the same student and their academic records match"
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Upload", href: "/upload" },
          { label: "Compare" },
        ]}
      />

      {/* Document Selection Grid */}
      <div className={`mt-6 grid grid-cols-1 ${showDoc3 ? "lg:grid-cols-3" : "lg:grid-cols-2"} gap-6`}>
        {/* Document 1: SF9 */}
        <Card padding="md" className="flex flex-col gap-4">
          <div className="flex justify-between items-center border-b pb-2">
            <h3 className="font-semibold text-base sm:text-lg">Document 1 (SF9 / Report Card)</h3>
            {!doc1Image && (
              <div className="flex gap-1">
                <button
                  onClick={() => handleModeChange(1, "upload")}
                  className={`p-2 rounded ${doc1Mode === "upload" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                  title="Upload Image"
                >
                  <Upload className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleModeChange(1, "camera")}
                  className={`p-2 rounded ${doc1Mode === "camera" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                  title="Use Camera"
                >
                  <Camera className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
          {!doc1Image ? (
            doc1Mode === "camera" ? (
              <CameraCaptureView
                onCapture={(img) => { setDoc1Image(img); setDoc1Mode("upload"); }}
                onCancel={() => setDoc1Mode("upload")}
              />
            ) : (
              <ImageUploader onImageSelected={setDoc1Image} />
            )
          ) : (
            <div className="relative group">
              <img src={doc1Image} alt="Doc 1" className="w-full h-auto max-h-64 object-contain rounded border bg-black" />
              <button
                onClick={() => { setDoc1Image(null); setDoc1Result(null); }}
                className="absolute top-2 right-2 bg-red-500 text-white rounded px-2 py-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity shadow"
              >
                Remove
              </button>
            </div>
          )}
        </Card>

        {/* Document 2: SF10 */}
        <Card padding="md" className="flex flex-col gap-4">
          <div className="flex justify-between items-center border-b pb-2">
            <h3 className="font-semibold text-base sm:text-lg">Document 2 (SF10 / Permanent Record)</h3>
            {!doc2Image && (
              <div className="flex gap-1">
                <button
                  onClick={() => handleModeChange(2, "upload")}
                  className={`p-2 rounded ${doc2Mode === "upload" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                  title="Upload Image"
                >
                  <Upload className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleModeChange(2, "camera")}
                  className={`p-2 rounded ${doc2Mode === "camera" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                  title="Use Camera"
                >
                  <Camera className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
          {!doc2Image ? (
            doc2Mode === "camera" ? (
              <CameraCaptureView
                onCapture={(img) => { setDoc2Image(img); setDoc2Mode("upload"); }}
                onCancel={() => setDoc2Mode("upload")}
              />
            ) : (
              <ImageUploader onImageSelected={setDoc2Image} />
            )
          ) : (
            <div className="relative group">
              <img src={doc2Image} alt="Doc 2" className="w-full h-auto max-h-64 object-contain rounded border bg-black" />
              <button
                onClick={() => { setDoc2Image(null); setDoc2Result(null); }}
                className="absolute top-2 right-2 bg-red-500 text-white rounded px-2 py-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity shadow"
              >
                Remove
              </button>
            </div>
          )}
        </Card>

        {/* Document 3: Optional PSA Birth Certificate */}
        {showDoc3 && (
          <Card padding="md" className="flex flex-col gap-4">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="font-semibold text-base sm:text-lg">Document 3 (PSA Birth Cert)</h3>
              <div className="flex gap-1">
                {!doc3Image && (
                  <>
                    <button
                      onClick={() => handleModeChange(3, "upload")}
                      className={`p-2 rounded ${doc3Mode === "upload" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                      title="Upload Image"
                    >
                      <Upload className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleModeChange(3, "camera")}
                      className={`p-2 rounded ${doc3Mode === "camera" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                      title="Use Camera"
                    >
                      <Camera className="w-4 h-4" />
                    </button>
                  </>
                )}
                <button
                  onClick={() => { setShowDoc3(false); setDoc3Image(null); setDoc3Result(null); }}
                  className="p-2 text-zinc-400 hover:text-red-500"
                  title="Close PSA Slot"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            </div>
            {!doc3Image ? (
              doc3Mode === "camera" ? (
                <CameraCaptureView
                  onCapture={(img) => { setDoc3Image(img); setDoc3Mode("upload"); }}
                  onCancel={() => setDoc3Mode("upload")}
                />
              ) : (
                <ImageUploader onImageSelected={setDoc3Image} />
              )
            ) : (
              <div className="relative group">
                <img src={doc3Image} alt="Doc 3 PSA" className="w-full h-auto max-h-64 object-contain rounded border bg-black" />
                <button
                  onClick={() => { setDoc3Image(null); setDoc3Result(null); }}
                  className="absolute top-2 right-2 bg-red-500 text-white rounded px-2 py-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity shadow"
                >
                  Remove
                </button>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* Slot Toggle for 3-Way PSA Comparison */}
      {!showDoc3 && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => setShowDoc3(true)}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
          >
            + Add PSA / Birth Certificate for 3-way Identity Verification
          </button>
        </div>
      )}

      {/* Compare Button */}
      <div className="mt-6 flex justify-center">
        <Button
          onClick={handleCompare}
          disabled={!doc1Image || !doc2Image || isExtracting || (retryAfter !== null && retryAfter > 0)}
          className="w-full max-w-md py-6 text-lg"
        >
          {isExtracting
            ? "Processing Documents..."
            : retryAfter !== null && retryAfter > 0
            ? `Please wait (${retryAfter}s)...`
            : "Verify & Compare"}
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 max-w-md mx-auto p-4 rounded-lg border text-sm text-center bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-800 text-red-900 dark:text-red-200"
        >
          <p className="font-semibold">{errorDetails?.code || "Extraction Error"}</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      {/* Comparison Results */}
      {comparison && (
        <div className="mt-8 space-y-6">
          {/* Overall Status Banner */}
          {!comparison.isSameLearner ? (
            <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-200 flex items-start gap-3">
              <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-sm">Learner Mismatch Detected</h4>
                <p className="text-xs mt-1">
                  {comparison.summaryMessage} Academic grade comparison has been blocked to prevent mixing unrelated student records.
                </p>
              </div>
            </div>
          ) : comparison.hasDiscrepancies ? (
            <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-sm">Discrepancies Identified</h4>
                <p className="text-xs mt-1">{comparison.summaryMessage}</p>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-sm">All Verified Records Match</h4>
                <p className="text-xs mt-1">{comparison.summaryMessage}</p>
              </div>
            </div>
          )}

          {/* Section 1: Learner Identity Verification Table */}
          <Card padding="lg">
            <h3 className="text-lg font-bold mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <FileCheck2 className="w-5 h-5 text-indigo-600" />
                Learner Identity Verification
              </span>
              {renderStatusBadge(
                comparison.identityResults.some((r) => r.status === "MISMATCH")
                  ? "MISMATCH"
                  : comparison.identityResults.some((r) => r.status === "NEEDS_VERIFICATION")
                  ? "NEEDS_VERIFICATION"
                  : "MATCH"
              )}
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b-2 border-zinc-200 dark:border-zinc-700">
                    <th className="pb-2 font-semibold">Field</th>
                    <th className="pb-2 font-semibold">Document 1 (SF9)</th>
                    <th className="pb-2 font-semibold">Document 2 (SF10)</th>
                    {showDoc3 && <th className="pb-2 font-semibold">Document 3 (PSA)</th>}
                    <th className="pb-2 font-semibold text-right">Verification Status</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.identityResults.map((item, idx) => (
                    <tr
                      key={idx}
                      className={`border-b border-zinc-100 dark:border-zinc-800 last:border-0 ${
                        item.status === "MISMATCH" ? "bg-red-50/40 dark:bg-red-950/20" : ""
                      }`}
                    >
                      <td className="py-3 font-medium text-zinc-900 dark:text-zinc-100">
                        {item.label}
                      </td>
                      <td className="py-3 font-mono text-xs">{item.doc1Value ?? "-"}</td>
                      <td className="py-3 font-mono text-xs">{item.doc2Value ?? "-"}</td>
                      {showDoc3 && <td className="py-3 font-mono text-xs">{item.doc3Value ?? "N/A"}</td>}
                      <td className="py-3 text-right">{renderStatusBadge(item.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Section 2: Academic Grades Verification Table */}
          {comparison.academicResults.length > 0 && (
            <Card padding="lg">
              <h3 className="text-lg font-bold mb-4 flex items-center justify-between">
                <span>Academic Grades Verification</span>
                {renderStatusBadge(
                  comparison.academicResults.some((r) => r.status === "MISMATCH")
                    ? "MISMATCH"
                    : comparison.academicResults.some((r) => r.status === "NEEDS_VERIFICATION")
                    ? "NEEDS_VERIFICATION"
                    : "MATCH"
                )}
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b-2 border-zinc-200 dark:border-zinc-700">
                      <th className="pb-2 font-semibold">Subject</th>
                      <th className="pb-2 font-semibold text-center">SF9 Grade</th>
                      <th className="pb-2 font-semibold text-center">SF10 Grade</th>
                      <th className="pb-2 font-semibold text-right">Verification Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.academicResults.map((g, idx) => (
                      <tr
                        key={idx}
                        className={`border-b border-zinc-100 dark:border-zinc-800 last:border-0 ${
                          g.status === "MISMATCH"
                            ? "bg-red-50/40 dark:bg-red-950/20"
                            : g.status === "NEEDS_VERIFICATION"
                            ? "bg-amber-50/30 dark:bg-amber-950/10"
                            : ""
                        }`}
                      >
                        <td className="py-3 font-medium text-zinc-900 dark:text-zinc-100">
                          {g.subject}
                          {g.semester && (
                            <span className="block text-[10px] text-zinc-500 font-normal">
                              {g.semester}
                            </span>
                          )}
                        </td>
                        <td className="py-3 text-center font-mono">{g.doc1Grade}</td>
                        <td className="py-3 text-center font-mono">{g.doc2Grade}</td>
                        <td className="py-3 text-right">
                          <div className="flex flex-col items-end gap-0.5">
                            {renderStatusBadge(g.status)}
                            {g.details && (
                              <span className="text-[10px] text-zinc-500 max-w-[200px] truncate" title={g.details}>
                                {g.details}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Upload Button */}
          <div className="mt-8 flex justify-center">
            <Button
              onClick={() => setShowUploadModal(true)}
              className="py-6 px-12 text-lg bg-indigo-600 hover:bg-indigo-700"
              disabled={!comparison.isSameLearner || comparison.hasDiscrepancies}
            >
              <UploadCloud className="w-5 h-5 mr-2" />
              Upload Verified Data to Supabase
            </Button>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card padding="lg" className="w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col gap-6 relative">
            <button
              onClick={() => setShowUploadModal(false)}
              className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-800"
            >
              <XCircle className="w-6 h-6" />
            </button>

            <h2 className="text-2xl font-bold flex items-center gap-2">
              <UploadCloud className="w-6 h-6 text-indigo-600" />
              Confirm Upload to Supabase
            </h2>

            <p className="text-zinc-600">
              Are you ready to upload this data to Supabase? The document status will be set to <strong>submitted (needs review)</strong>.
            </p>

            <div className="bg-zinc-50 border p-4 rounded-lg space-y-4">
              <div>
                <span className="text-xs font-semibold text-zinc-500 uppercase">Student Full Name</span>
                <p className="font-medium text-lg">{mergedFields.name || "-"}</p>
              </div>

              {mergedFields.grades && mergedFields.grades.length > 0 && (
                <div>
                  <span className="text-xs font-semibold text-zinc-500 uppercase">
                    Grades Overview ({mergedFields.grades.length} subjects)
                  </span>
                  <div className="mt-2 text-sm max-h-32 overflow-y-auto border rounded bg-white p-2">
                    {mergedFields.grades.map((g, i) => (
                      <div key={i} className="flex justify-between border-b last:border-0 py-1">
                        <span className="truncate pr-4">{g.subject}</span>
                        <span className="font-mono font-medium">{getAuthoritativeSemesterFinalGrade(g) ?? "-"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-4 justify-end mt-4">
              <Button variant="outline" onClick={() => setShowUploadModal(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleUploadToSupabase}
                disabled={isUploading || uploadSuccess}
                className={uploadSuccess ? "bg-emerald-600 hover:bg-emerald-700" : "bg-indigo-600 hover:bg-indigo-700"}
              >
                {uploadSuccess ? "Uploaded Successfully!" : isUploading ? "Uploading..." : "Confirm & Upload"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
