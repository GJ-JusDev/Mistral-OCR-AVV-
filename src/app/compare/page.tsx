"use client";

import React, { useState } from "react";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import ImageUploader from "@/components/camera/ImageUploader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useOcr } from "@/hooks/useOcr";
import type { ExtractedFields } from "@/types/documents";
import { CheckCircle2, XCircle, AlertCircle, Camera, Upload, UploadCloud } from "lucide-react";
import Link from "next/link";
import CameraCaptureView from "@/components/camera/CameraCaptureView";

export default function ComparePage() {
  const [doc1Image, setDoc1Image] = useState<string | null>(null);
  const [doc2Image, setDoc2Image] = useState<string | null>(null);

  const [doc1Mode, setDoc1Mode] = useState<"upload" | "camera">("upload");
  const [doc2Mode, setDoc2Mode] = useState<"upload" | "camera">("upload");

  const [doc1Result, setDoc1Result] = useState<ExtractedFields | null>(null);
  const [doc2Result, setDoc2Result] = useState<ExtractedFields | null>(null);

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const { extract, isExtracting, error } = useOcr();

  const handleCompare = async () => {
    if (!doc1Image || !doc2Image) return;
    
    try {
      // Both documents use the same parser now
      const res1 = await extract(doc1Image, true);
      setDoc1Result(res1.fields || null);

      const res2 = await extract(doc2Image, true);
      setDoc2Result(res2.fields || null);
    } catch (err) {
      console.error(err);
    }
  };

  const namesMatch = doc1Result?.name && doc2Result?.name 
    ? doc1Result.name.toLowerCase() === doc2Result.name.toLowerCase() 
    : false;

  const gradesComparison: { subject: string; sf9Grade: string | number; sf10Grade: string | number; isMatch: boolean }[] = [];
  let allGradesMatch = false;

  if (doc1Result?.grades || doc2Result?.grades) {
    const d1Grades = doc1Result?.grades || [];
    const d2Grades = doc2Result?.grades || [];
    
    // Group by subject name (normalized)
    const allSubjects = new Set([...d1Grades.map(g => g.subject.toLowerCase()), ...d2Grades.map(g => g.subject.toLowerCase())]);
    
    allSubjects.forEach(sub => {
      const g1 = d1Grades.find(g => g.subject.toLowerCase() === sub);
      const g2 = d2Grades.find(g => g.subject.toLowerCase() === sub);
      
      const g1Final = g1?.final ?? g1?.q2 ?? g1?.q1 ?? "-";
      const g2Final = g2?.final ?? g2?.q2 ?? g2?.q1 ?? "-";
      const isMatch = g1Final === g2Final && g1Final !== "-";
      
      gradesComparison.push({
        subject: g1?.subject || g2?.subject || "",
        sf9Grade: g1Final,
        sf10Grade: g2Final,
        isMatch
      });
    });
    
    allGradesMatch = gradesComparison.length > 0 && gradesComparison.every(g => g.isMatch);
  }

  const handleModeChange = (doc: 1 | 2, mode: "upload" | "camera") => {
    if (doc === 1) {
      setDoc1Mode(mode);
      if (mode === "camera") setDoc2Mode("upload"); // Only one camera at a time
    } else {
      setDoc2Mode(mode);
      if (mode === "camera") setDoc1Mode("upload"); // Only one camera at a time
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
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_type: "SF10",
          image_url: "uploaded-from-compare", // placeholder or base64
          extracted_text: "Combined from Compare",
          extracted_fields: mergedFields,
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
        title="Verify SF9 and SF10" 
        description="Verify that the SF9 and SF10 belong to the same student and their grades match"
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Upload", href: "/upload" },
          { label: "Compare" }
        ]}
      />

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card padding="md" className="flex flex-col gap-4">
          <div className="flex justify-between items-center border-b pb-2">
            <h3 className="font-semibold text-lg">Document 1 (SF9 / Report Card)</h3>
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

        <Card padding="md" className="flex flex-col gap-4">
          <div className="flex justify-between items-center border-b pb-2">
            <h3 className="font-semibold text-lg">Document 2 (SF10 / Permanent Record)</h3>
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
      </div>

      <div className="mt-6 flex justify-center">
        <Button 
          onClick={handleCompare} 
          disabled={!doc1Image || !doc2Image || isExtracting}
          className="w-full max-w-md py-6 text-lg"
        >
          {isExtracting ? "Processing Documents..." : "Verify & Compare"}
        </Button>
      </div>

      {error && <div className="mt-4 text-center text-red-500">{error}</div>}

      {(doc1Result || doc2Result) && (
        <div className="mt-8 space-y-6">
          <Card padding="lg">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
              Name Verification
              {namesMatch ? (
                <span className="text-emerald-500 flex items-center text-sm ml-2 bg-emerald-50 px-2 py-1 rounded">
                  <CheckCircle2 className="w-4 h-4 mr-1" /> MATCH
                </span>
              ) : (
                <span className="text-red-500 flex items-center text-sm ml-2 bg-red-50 px-2 py-1 rounded">
                  <XCircle className="w-4 h-4 mr-1" /> MISMATCH
                </span>
              )}
            </h3>

            <div className="grid grid-cols-2 gap-4 bg-zinc-50 p-4 rounded-lg border">
              <div>
                <p className="text-sm text-zinc-500">SF9 Name</p>
                <p className="font-medium text-lg">{doc1Result?.name || "Not Found"}</p>
              </div>
              <div>
                <p className="text-sm text-zinc-500">SF10 Name</p>
                <p className="font-medium text-lg">{doc2Result?.name || "Not Found"}</p>
              </div>
            </div>
          </Card>

          {gradesComparison.length > 0 && (
            <Card padding="lg">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                Grades Verification
                {allGradesMatch ? (
                  <span className="text-emerald-500 flex items-center text-sm ml-2 bg-emerald-50 px-2 py-1 rounded">
                    <CheckCircle2 className="w-4 h-4 mr-1" /> ALL MATCH
                  </span>
                ) : (
                  <span className="text-red-500 flex items-center text-sm ml-2 bg-red-50 px-2 py-1 rounded">
                    <XCircle className="w-4 h-4 mr-1" /> DISCREPANCIES FOUND
                  </span>
                )}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b-2 border-zinc-200">
                      <th className="pb-2 font-semibold">Subject</th>
                      <th className="pb-2 font-semibold text-center">SF9 Grade</th>
                      <th className="pb-2 font-semibold text-center">SF10 Grade</th>
                      <th className="pb-2 font-semibold text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gradesComparison.map((g, idx) => (
                      <tr key={idx} className={`border-b border-zinc-100 last:border-0 ${!g.isMatch ? 'bg-red-50/50' : ''}`}>
                        <td className="py-3 font-medium">{g.subject}</td>
                        <td className="py-3 text-center">{g.sf9Grade}</td>
                        <td className="py-3 text-center">{g.sf10Grade}</td>
                        <td className="py-3 text-right">
                          {g.isMatch ? (
                            <span className="inline-flex items-center text-emerald-600 bg-emerald-50 px-2 py-1 rounded text-xs font-bold">
                              <CheckCircle2 className="w-3 h-3 mr-1" /> MATCH
                            </span>
                          ) : (
                            <span className="inline-flex items-center text-red-600 bg-red-50 px-2 py-1 rounded text-xs font-bold">
                              <XCircle className="w-3 h-3 mr-1" /> MISMATCH
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          
          <div className="mt-8 flex justify-center">
            <Button
              onClick={() => setShowUploadModal(true)}
              className="py-6 px-12 text-lg bg-indigo-600 hover:bg-indigo-700"
              disabled={!allGradesMatch}
            >
              <UploadCloud className="w-5 h-5 mr-2" />
              Upload Verified Data to Supabase
            </Button>
          </div>
        </div>
      )}
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
              Are you ready to upload this data to Supabase? The document status will be set to <strong>pending</strong>.
            </p>

            <div className="bg-zinc-50 border p-4 rounded-lg space-y-4">
              <div>
                <span className="text-xs font-semibold text-zinc-500 uppercase">Student Full Name</span>
                <p className="font-medium text-lg">{mergedFields.name || "-"}</p>
              </div>

              {mergedFields.grades && mergedFields.grades.length > 0 && (
                <div>
                  <span className="text-xs font-semibold text-zinc-500 uppercase">Grades Overview ({mergedFields.grades.length} subjects)</span>
                  <div className="mt-2 text-sm max-h-32 overflow-y-auto border rounded bg-white p-2">
                    {mergedFields.grades.map((g, i) => (
                      <div key={i} className="flex justify-between border-b last:border-0 py-1">
                        <span className="truncate pr-4">{g.subject}</span>
                        <span className="font-mono font-medium">{g.final ?? "-"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {mergedFields.attendance && mergedFields.attendance.length > 0 && (
                <div>
                  <span className="text-xs font-semibold text-zinc-500 uppercase">Attendance Overview</span>
                  <div className="mt-2 text-sm border rounded bg-white p-2">
                    <p className="text-xs text-zinc-500 mb-1">Months: {(mergedFields.attendance_months || []).join(", ")}</p>
                    {mergedFields.attendance.map((a, i) => (
                      <div key={i} className="flex justify-between border-b last:border-0 py-1">
                        <span>{a.label}</span>
                        <span className="font-mono">{a.values.length} values</span>
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
