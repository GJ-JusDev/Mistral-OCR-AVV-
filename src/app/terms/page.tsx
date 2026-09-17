import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { Card } from "@/components/ui/Card";

export default function TermsPage() {
  return (
    <PageContainer>
      <Header title="Terms and Conditions" description="Please read our terms carefully before using the system." />
      <div className="mt-6 max-w-4xl mx-auto">
        <Card padding="lg" className="bg-white shadow-sm border-[#dee2e6]">
          <div className="prose prose-zinc max-w-none text-[#212529]">
            <h2 className="text-xl font-semibold mb-4">1. Acceptance of Terms</h2>
            <p className="mb-6 text-[#495057]">
              By registering for and using this OCR Document Validation System, you agree to be bound by these Terms and Conditions. If you do not agree with any part of these terms, you may not use our services.
            </p>

            <h2 className="text-xl font-semibold mb-4 text-red-600">2. Developer Liability & Indemnification</h2>
            <p className="mb-6 text-[#495057]">
              <strong>Important Notice:</strong> The original developers and creators of this system are <strong>NOT LIABLE</strong> for any damages, fines, data breaches, or legal repercussions that may arise from the use of this software. The system is now deployed, operated, and handled entirely by external administrators and the respective educational institutions. By using this system, you acknowledge that the original developers have no ongoing control over its data or operations, and you agree to hold the developers harmless from any claims, liabilities, or fines.
            </p>

            <h2 className="text-xl font-semibold mb-4">3. Privacy and Data Usage</h2>
            <p className="mb-6 text-[#495057]">
              This system processes sensitive student records, including SF9 and SF10 documents. Users must ensure they have the appropriate authorization to upload and process these documents. Data uploaded to the system is the sole responsibility of the operating institution, which must adhere to all applicable data privacy laws.
            </p>

            <h2 className="text-xl font-semibold mb-4">4. User Responsibilities</h2>
            <p className="mb-6 text-[#495057]">
              As a registered teacher or administrator, you agree to:
              <ul className="list-disc pl-6 mt-2">
                <li>Maintain the confidentiality of your account credentials.</li>
                <li>Only upload documents that you are authorized to process.</li>
                <li>Manually review and verify OCR extraction results for accuracy.</li>
                <li>Not attempt to exploit, hack, or disrupt the system normal operations.</li>
              </ul>
            </p>

            <h2 className="text-xl font-semibold mb-4">5. Accuracy of Information</h2>
            <p className="mb-6 text-[#495057]">
              While the Optical Character Recognition (OCR) technology aims to be highly accurate, it is not infallible. Users are required to review flagged documents and verify the extracted data against the original images. The operators of this system are not responsible for decisions made based on unverified extracted data.
            </p>

            <h2 className="text-xl font-semibold mb-4">6. System Modifications</h2>
            <p className="mb-6 text-[#495057]">
              The administrators reserve the right to modify, suspend, or discontinue any part of the service at any time without prior notice.
            </p>
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}
