import { 
  ScanSearch, 
  CheckCircle2, 
  CalendarClock, 
  ShieldCheck, 
  FileSpreadsheet, 
  AlertCircle, 
  Clock, 
  UserCheck 
} from "lucide-react";

const features = [
  {
    step: "01",
    title: "Intelligent Document Extraction",
    description:
      "Extract information from Senior High School SF9, SF10, and supported student documents using OCR.",
    icon: ScanSearch,
    badge: "SF9, SF10 & PSA OCR",
    highlights: [
      "Semestral grade tables (Q1-Q4 & Finals)",
      "Learner Reference Number (LRN) matching",
      "Two-sided SF9 front and back alignment",
    ],
  },
  {
    step: "02",
    title: "Academic Validation",
    description:
      "Help verify subject grades, detect discrepancies, and identify academic deficiencies.",
    icon: CheckCircle2,
    badge: "Automated Rule Engine",
    highlights: [
      "Grade discrepancy & anomaly detection",
      "Borderline grade warnings (72-77)",
      "Strict zero vs blank grade preservation",
    ],
  },
  {
    step: "03",
    title: "Attendance & Remedial Monitoring",
    description:
      "Support attendance review and tracking of remedial class outcomes.",
    icon: CalendarClock,
    badge: "DepEd Order Alignment",
    highlights: [
      "Monthly school days present vs absent",
      "Remedial class completion status",
      "Recomputed final rating tracking",
    ],
  },
  {
    step: "04",
    title: "Secure Role-Based Review",
    description:
      "Teachers verify extracted records while authorized school officials review eligibility decisions.",
    icon: ShieldCheck,
    badge: "Institutional Oversight",
    highlights: [
      "Authorized Teacher verification queue",
      "Principal executive eligibility decision",
      "Strict separation of duty safeguards",
    ],
  },
];

export default function FeaturesSection() {
  return (
    <section id="features" className="py-24 bg-[#102A43] text-white relative overflow-hidden">
      {/* Decorative ambient background glows */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#174EA6]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-[#F4C542]/5 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-[#F4C542]/15 text-[#F4C542] border border-[#F4C542]/30 mb-4">
            System Features
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white">
            Built for Precision & Institutional Trust
          </h2>
          <p className="mt-4 text-base sm:text-lg text-[#CBD5E1] leading-relaxed">
            Every feature is engineered specifically around Department of Education Senior High School
            form evaluation standards to assist educators without compromising human authority.
          </p>
        </div>

        {/* 4 Horizontally Arranged Feature Highlights (Desktop: 4 columns, Tablet: 2, Mobile: 1) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="group relative flex flex-col justify-between bg-[#0B1F33]/85 rounded-2xl p-6 sm:p-7 border border-white/10 hover:border-[#F4C542]/40 hover:bg-[#0B1F33] transition-all duration-300 shadow-lg hover:shadow-2xl hover:shadow-[#174EA6]/20 hover:-translate-y-1"
              >
                {/* Top: Icon & Step Tag */}
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#174EA6]/25 border border-[#174EA6]/50 text-[#F4C542] group-hover:scale-110 group-hover:bg-[#174EA6]/40 transition-all duration-200 shadow-inner">
                      <Icon className="h-6 w-6 text-[#F4C542]" />
                    </div>
                    <span className="text-xs font-mono font-semibold text-white/30 group-hover:text-[#F4C542] transition-colors">
                      {feature.step}
                    </span>
                  </div>

                  <span className="inline-block text-[11px] font-semibold text-[#CBD5E1] uppercase tracking-wider mb-2">
                    {feature.badge}
                  </span>

                  <h3 className="text-xl font-bold text-white group-hover:text-white transition-colors leading-snug">
                    {feature.title}
                  </h3>

                  <p className="mt-3 text-sm text-[#CBD5E1] leading-relaxed">
                    {feature.description}
                  </p>
                </div>

                {/* Bottom: Highlight checklist */}
                <div className="mt-6 pt-5 border-t border-white/5 space-y-2">
                  {feature.highlights.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-xs text-[#CBD5E1]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#F4C542] mt-1.5 shrink-0" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
