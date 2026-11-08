"use client";

import React from "react";
import { 
  GraduationCap, 
  School, 
  Printer, 
  X, 
  FileText, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  ExternalLink,
  ShieldCheck,
  Calendar,
  UserCheck
} from "lucide-react";

interface SubjectGrade {
  id?: string;
  subject: string;
  semester?: string | null;
  q1?: number | null;
  q2?: number | null;
  q3?: number | null;
  q4?: number | null;
  final_grade?: number | null;
  status: string;
  sourceDocType?: string;
}

interface StudentDigitalRecord {
  id: string;
  lrn: string;
  fullName: string;
  firstName?: string;
  middleName?: string | null;
  lastName?: string;
  suffix?: string | null;
  gradeLevel: string;
  section: string;
  schoolYear: string;
  generalAverage?: number | null;
  academicStanding: string;
  eligibility: {
    gradeLevel: string;
    eligibilityType: string;
    status: string;
    approvalDecision: string;
    reasons: string[];
    blockingFactors: string[];
  };
  completeness: {
    status: string;
    label: string;
    hasSf9: boolean;
    hasSf10: boolean;
    hasPsa: boolean;
  };
  documents: {
    id: string;
    documentType: string;
    status: string;
    originalImageUrl?: string | null;
    schoolYear?: string;
  }[];
  grades: SubjectGrade[];
  approvalRecord?: {
    decision: string;
    approvedAt?: string | null;
    approvedBy?: string | null;
    remarks?: string | null;
  } | null;
}

interface Props {
  student: StudentDigitalRecord;
  onClose: () => void;
}

/**
 * DIGITAL ACADEMIC RECORD MODAL (EXECUTIVE PRINTABLE SUMMARY)
 *
 * Bakit ito ginawa para sa Capstone Defense:
 * Ito ang pormal na digital report card summary na tinitingnan at ini-imprenta ng Principal.
 * Pinagsasama-sama nito ang verified learner profile, document completeness status,
 * verified subject grades roster, at ang official Principal eligibility sign-off block.
 *
 * Legal at Administrative Disclaimer:
 * Malinaw na ipinapaalam sa dokumento na ito ay "monitoring summary" lamang mula sa database
 * at HINDI pisikal na kapalit ng opisyal na DepEd SF9/SF10 (Form 137/138).
 */
export default function DigitalAcademicRecordModal({ student, onClose }: Props) {
  const handlePrint = () => {
    window.print();
  };

  const isEligible = student.eligibility.status === "Eligible";
  const isApproved = student.eligibility.approvalDecision === "Approved";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs print:p-0 print:bg-white print:static">
      <div className="bg-white rounded-xl shadow-2xl border border-zinc-200 w-full max-w-4xl max-h-[92vh] overflow-y-auto print:max-h-none print:border-none print:shadow-none print:w-full">
        {/* Modal Toolbar (hidden when printing) */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-200 bg-zinc-50 sticky top-0 z-10 print:hidden">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-[#7c3aed]/10 text-[#7c3aed]">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-900">Digital Academic Record</h3>
              <p className="text-xs text-zinc-500">Official Database Summary &bull; Taysan Resettlement Integrated School</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-zinc-900 text-white hover:bg-zinc-800 transition-colors shadow-xs"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Print Summary</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Printable Official Document Body */}
        <div className="p-8 print:p-4 text-zinc-900 font-sans">
          {/* Institutional Header */}
          <div className="text-center pb-6 border-b-2 border-zinc-900">
            <p className="text-xs uppercase tracking-widest font-semibold text-zinc-600">Republic of the Philippines</p>
            <p className="text-xs uppercase tracking-wider font-semibold text-zinc-800">Department of Education &bull; Region V &bull; Division of Legazpi City</p>
            <h1 className="text-lg sm:text-xl font-extrabold uppercase tracking-tight text-zinc-900 mt-1">
              TAYSAN RESETTLEMENT INTEGRATED SCHOOL
            </h1>
            <p className="text-xs font-medium text-zinc-600 mt-0.5">
              Taysan, Legazpi City, Albay &bull; DepEd School ID: <span className="font-bold text-zinc-900">300792</span>
            </p>
            <div className="inline-block mt-3 px-3 py-1 bg-zinc-100 border border-zinc-300 rounded text-xs font-bold uppercase tracking-wider">
              Senior High School Digital Academic Record
            </div>
            <p className="text-[0.65rem] text-zinc-500 italic mt-1.5">
              Institutional Monitoring Summary &bull; Authoritative Database Record &bull; Not a physical DepEd SF9/SF10 credential replacement
            </p>
          </div>

          {/* Learner Identity & Enrollment Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 mt-6 bg-zinc-50 border border-zinc-200 rounded-lg text-xs">
            <div>
              <p className="text-[0.65rem] font-bold text-zinc-500 uppercase">Learner Name</p>
              <p className="text-sm font-bold text-zinc-900 mt-0.5">{student.fullName}</p>
            </div>
            <div>
              <p className="text-[0.65rem] font-bold text-zinc-500 uppercase">Learner Reference No. (LRN)</p>
              <p className="text-sm font-mono font-bold text-zinc-900 mt-0.5">{student.lrn}</p>
            </div>
            <div>
              <p className="text-[0.65rem] font-bold text-zinc-500 uppercase">Grade & Section</p>
              <p className="text-xs font-semibold text-zinc-800 mt-0.5">{student.gradeLevel} &bull; {student.section}</p>
            </div>
            <div>
              <p className="text-[0.65rem] font-bold text-zinc-500 uppercase">School Year</p>
              <p className="text-xs font-semibold text-zinc-800 mt-0.5">S.Y. {student.schoolYear}</p>
            </div>
          </div>

          {/* Document Verification & Completeness Bar */}
          <div className="flex flex-wrap items-center justify-between p-3 mt-4 bg-zinc-100/70 border border-zinc-200 rounded-md text-xs">
            <div className="flex items-center gap-3">
              <span className="font-bold text-zinc-700">Archived Documents:</span>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-[0.65rem] font-bold ${
                  student.completeness.hasSf9 ? "bg-purple-100 text-purple-800 border border-purple-300" : "bg-zinc-200 text-zinc-500"
                }`}>
                  SF9 Report Card: {student.completeness.hasSf9 ? "Verified" : "Missing"}
                </span>
                <span className={`px-2 py-0.5 rounded text-[0.65rem] font-bold ${
                  student.completeness.hasSf10 ? "bg-blue-100 text-blue-800 border border-blue-300" : "bg-zinc-200 text-zinc-500"
                }`}>
                  SF10 Transcript: {student.completeness.hasSf10 ? "Verified" : "Missing"}
                </span>
                <span className={`px-2 py-0.5 rounded text-[0.65rem] font-bold ${
                  student.completeness.hasPsa ? "bg-emerald-100 text-emerald-800 border border-emerald-300" : "bg-amber-100 text-amber-800 border border-amber-300"
                }`}>
                  PSA Birth Cert: {student.completeness.hasPsa ? "Verified" : "Missing PSA"}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-2 sm:mt-0">
              <span className="font-bold text-zinc-700">Completeness:</span>
              <span className={`px-2.5 py-0.5 rounded text-[0.65rem] font-bold ${
                student.completeness.status === "COMPLETE"
                  ? "bg-emerald-600 text-white"
                  : student.completeness.status === "IDENTITY_REVIEW_REQUIRED"
                  ? "bg-purple-600 text-white"
                  : "bg-amber-500 text-white"
              }`}>
                {student.completeness.label}
              </span>
            </div>
          </div>

          {/* Verified Academic Grades Table */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-800 flex items-center gap-1.5">
                <GraduationCap className="h-4 w-4 text-[#7c3aed]" />
                <span>Verified Scholastic Record</span>
              </h3>
              <span className="text-[0.65rem] text-zinc-500">
                Official DepEd K to 12 Senior High School Grading Standards &bull; Zero Fabricated Grades
              </span>
            </div>

            {student.grades && student.grades.length > 0 ? (
              <div className="border border-zinc-300 rounded-md overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-zinc-100 border-b border-zinc-300 text-zinc-700 font-bold uppercase text-[0.65rem]">
                    <tr>
                      <th className="py-2.5 px-3">Learning Area / Subject</th>
                      <th className="py-2.5 px-2 text-center">Semester</th>
                      <th className="py-2.5 px-2 text-center">Q1</th>
                      <th className="py-2.5 px-2 text-center">Q2</th>
                      <th className="py-2.5 px-2 text-center">Q3</th>
                      <th className="py-2.5 px-2 text-center">Q4</th>
                      <th className="py-2.5 px-2 text-center font-bold">Final Grade</th>
                      <th className="py-2.5 px-3 text-right">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200">
                    {student.grades.map((g, idx) => (
                      <tr key={idx} className="hover:bg-zinc-50/50">
                        <td className="py-2 px-3 font-medium text-zinc-900">{g.subject}</td>
                        <td className="py-2 px-2 text-center text-zinc-600">{g.semester || "-"}</td>
                        <td className="py-2 px-2 text-center text-zinc-600">{g.q1 ?? "-"}</td>
                        <td className="py-2 px-2 text-center text-zinc-600">{g.q2 ?? "-"}</td>
                        <td className="py-2 px-2 text-center text-zinc-600">{g.q3 ?? "-"}</td>
                        <td className="py-2 px-2 text-center text-zinc-600">{g.q4 ?? "-"}</td>
                        <td className="py-2 px-2 text-center font-bold text-zinc-900">{g.final_grade ?? "-"}</td>
                        <td className="py-2 px-3 text-right">
                          <span className={`px-1.5 py-0.5 rounded text-[0.625rem] font-bold ${
                            g.status === "Passed"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : g.status === "Failed"
                              ? "bg-red-50 text-red-700 border border-red-200"
                              : "bg-zinc-100 text-zinc-500"
                          }`}>
                            {g.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-zinc-500 border border-dashed border-zinc-300 rounded-md">
                No verified subject grades are recorded for this student.
              </div>
            )}
          </div>

          {/* Academic Standing & Principal Eligibility Assessment */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
            <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-lg text-xs">
              <h4 className="font-bold text-zinc-800 uppercase text-[0.7rem] mb-2">Academic Standing</h4>
              <div className="flex items-center justify-between py-1 border-b border-zinc-200">
                <span className="text-zinc-600">General Average (from Source):</span>
                <span className="font-bold text-zinc-900 text-sm">
                  {student.generalAverage ?? "Not Recorded"}
                </span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-zinc-200">
                <span className="text-zinc-600">Scholastic Standing:</span>
                <span className={`font-bold ${
                  student.academicStanding === "Passed" ? "text-emerald-700" : "text-amber-700"
                }`}>
                  {student.academicStanding}
                </span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-zinc-600">Curriculum Structure:</span>
                <span className="font-medium text-zinc-800">DepEd K–12 SHS Curriculum</span>
              </div>
            </div>

            <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-lg text-xs">
              <h4 className="font-bold text-zinc-800 uppercase text-[0.7rem] mb-2">Eligibility & Approval Status</h4>
              <div className="flex items-center justify-between py-1 border-b border-zinc-200">
                <span className="text-zinc-600">Eligibility Scope:</span>
                <span className="font-bold text-zinc-900">{student.eligibility.eligibilityType}</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-zinc-200">
                <span className="text-zinc-600">Academic Eligibility:</span>
                <span className={`font-bold ${
                  student.eligibility.status === "Eligible"
                    ? "text-emerald-700"
                    : student.eligibility.status === "Not Eligible"
                    ? "text-red-700"
                    : "text-amber-700"
                }`}>
                  {student.eligibility.status}
                </span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-zinc-600">Principal Action:</span>
                <span className={`font-bold ${
                  isApproved
                    ? "text-emerald-700"
                    : student.eligibility.approvalDecision === "Not Approved"
                    ? "text-red-700"
                    : "text-amber-700"
                }`}>
                  {student.eligibility.approvalDecision}
                </span>
              </div>
            </div>
          </div>

          {/* Original Images Access Links (shown on web, preserved for audit) */}
          <div className="mt-6 p-4 border border-zinc-200 rounded-lg bg-zinc-50 print:border-none print:p-0">
            <h4 className="font-bold text-zinc-800 uppercase text-[0.7rem] mb-2 flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-[#7c3aed]" />
              <span>Complete Original Scanned Documents Preservation</span>
            </h4>
            <div className="space-y-2">
              {student.documents.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between text-xs py-1.5 border-b border-zinc-200 last:border-none">
                  <div>
                    <span className="font-bold text-zinc-900 uppercase">{doc.documentType}</span>
                    <span className="text-zinc-500 ml-2">&bull; Status: {doc.status}</span>
                  </div>
                  {doc.originalImageUrl ? (
                    <a
                      href={doc.originalImageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[#7c3aed] font-semibold hover:underline print:hidden"
                    >
                      <span>View Complete Original Image</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="text-zinc-400 italic">Original file archived in private storage</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Explicit Administrative & Legal Disclaimer */}
          <div className="mt-8 p-3 bg-zinc-50 border border-zinc-200 rounded text-[0.7rem] text-zinc-600 leading-relaxed text-center">
            <strong>Official Notice:</strong> This digital record summarizes verified database records for institutional monitoring and progression verification only. It does not replace the official physical Form 137 / SF10 or Form 138 / SF9 issued under DepEd guidelines.
          </div>

          {/* Formal Institutional Sign-off Block */}
          <div className="mt-8 pt-6 border-t border-zinc-300 grid grid-cols-2 gap-8 text-xs">
            <div className="text-center">
              <div className="border-b border-zinc-900 pb-1 w-3/4 mx-auto font-bold text-zinc-900">
                CLASS ADVISER / REGISTRAR
              </div>
              <p className="text-[0.65rem] text-zinc-500 mt-1">Verified School Form Verifier</p>
            </div>
            <div className="text-center">
              <div className="border-b border-zinc-900 pb-1 w-3/4 mx-auto font-bold text-zinc-900">
                SCHOOL PRINCIPAL / SCHOOL HEAD
              </div>
              <p className="text-[0.65rem] text-zinc-500 mt-1">
                Taysan Resettlement Integrated School &bull; DepEd School ID 300792
              </p>
              {isApproved && student.approvalRecord?.approvedAt && (
                <p className="text-[0.65rem] text-emerald-700 font-semibold mt-1">
                  Officially Approved on {new Date(student.approvalRecord.approvedAt).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between p-4 border-t border-zinc-200 bg-zinc-50 print:hidden">
          <span className="text-xs text-zinc-500">
            DepEd Senior High School Automated Visual Validation System (AVV)
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold rounded-md bg-zinc-200 text-zinc-800 hover:bg-zinc-300 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
