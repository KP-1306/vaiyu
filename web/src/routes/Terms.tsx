import { Link } from "react-router-dom";
import SEO from "../components/SEO";

export default function Terms() {
  return (
    <div className="min-h-screen bg-[#0a0a0c] text-[#f5f3ef]">
      <main className="mx-auto max-w-3xl px-4 py-16 sm:py-24">
        <SEO
          title="Terms of Service — VAiyu"
          description="Contractual terms governing the use of VAiyu’s products and services."
          canonical={`${window.location.origin}/terms`}
        />

        <div className="rounded-3xl border border-[#d4af37]/20 bg-[#141210]/90 p-8 sm:p-12 shadow-[0_4px_24px_rgba(0,0,0,0.4)] backdrop-blur-md">
          <h1 className="text-3xl font-bold tracking-tight text-[#f5f3ef]">Terms of Service</h1>
          <p className="mt-4 text-[#b8b3a8] text-lg">
            These terms govern use of VAiyu’s products and services. For the legally binding version,
            download the signed PDFs below.
          </p>

          <div className="mt-8 border-t border-[#d4af37]/10 pt-8">
            <ul className="list-none space-y-4 text-[#b8b3a8]">
              <li className="flex items-start gap-3">
                <span className="text-[#d4af37] mt-1">•</span>
                <span>Acceptable use and content-moderation rules apply.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-[#d4af37] mt-1">•</span>
                <span>Service levels and support windows are described in the SLA.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-[#d4af37] mt-1">•</span>
                <span>Data processing is covered by our DPA.</span>
              </li>
            </ul>
          </div>

          <div className="mt-10 flex flex-wrap gap-4">
            <a 
              className="inline-flex items-center justify-center px-6 py-3 font-semibold text-[#0a0a0c] bg-gradient-to-r from-[#e9c55a] to-[#d4af37] rounded-xl hover:opacity-90 shadow-lg"
              href="/legal/VAiyu-MSA.pdf" 
              target="_blank" 
              rel="noreferrer"
            >
              MSA (PDF)
            </a>
            <a 
              className="inline-flex items-center justify-center px-6 py-3 font-semibold text-[#b8b3a8] bg-[#1a1816] border border-[#d4af37]/20 rounded-xl hover:bg-[#24221f] hover:text-[#f5f3ef] transition-colors"
              href="/legal/VAiyu-DPA.pdf" 
              target="_blank" 
              rel="noreferrer"
            >
              DPA (PDF)
            </a>
            <a 
              className="inline-flex items-center justify-center px-6 py-3 font-semibold text-[#b8b3a8] bg-[#1a1816] border border-[#d4af37]/20 rounded-xl hover:bg-[#24221f] hover:text-[#f5f3ef] transition-colors"
              href="/legal/VAiyu-SLA.pdf" 
              target="_blank" 
              rel="noreferrer"
            >
              SLA (PDF)
            </a>
            <a 
              className="inline-flex items-center justify-center px-6 py-3 font-semibold text-[#b8b3a8] bg-[#1a1816] border border-[#d4af37]/20 rounded-xl hover:bg-[#24221f] hover:text-[#f5f3ef] transition-colors"
              href="/legal/VAiyu-AUP.pdf" 
              target="_blank" 
              rel="noreferrer"
            >
              AUP (PDF)
            </a>
          </div>

          <div className="mt-12 text-sm">
            <Link to="/" className="text-[#d4af37] hover:text-[#e9c55a] transition-colors underline decoration-[#d4af37]/30 hover:decoration-[#d4af37] underline-offset-4">
              ← Back to home
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
