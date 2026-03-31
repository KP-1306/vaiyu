import React from "react";

export default function FAQShort() {
  const faqs = [
    {
      q: "Do we need a PMS integration to start?",
      a: "No. You can start in manual mode on day one — properties, rooms, services, tickets and guest links work out-of-the-box. PMS/PoS adapters can be added later without changing your workflows.",
    },
    {
      q: "How do SLAs work?",
      a: "Every ticket has a target time. We auto-route to the right team, start a countdown, nudge on risk, and show an on-time/late dashboard. SLA policies are configurable by service type and shift.",
    },
    {
      q: "Can we moderate AI drafts?",
      a: "Yes. AI drafts are never auto-published. Owners or designated approvers can review, edit, approve or reject. All drafts are traceable to verified stay data, with a full audit log.",
    },
    {
      q: "What’s the pricing model?",
      a: "Simple per-room, per-month pricing with tiers. A 7-day pilot is available; volume discounts for groups and annual commitments. Contact us for an exact quote for your portfolio.",
    },
    {
      q: "How long does setup take?",
      a: "You can be live in a day using demo data. With real data and branding, typical onboarding takes 2–5 days including roles, services, and guest links.",
    },
  ];

  return (
    <section id="faq" className="py-12 bg-transparent">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#f5f3ef]">Frequently Asked Questions</h2>
          <p className="mt-4 text-[#b8b3a8] text-lg">Short answers owners and operators ask first.</p>
        </div>

        <div className="divide-y divide-[#d4af37]/10 rounded-[2rem] border border-[#d4af37]/20 bg-[#141210]/90 backdrop-blur-xl shadow-[0_10px_40px_-20px_rgba(0,0,0,0.6)] overflow-hidden">
          {faqs.map((f, i) => (
            <details key={i} className="group open:bg-[#1a1816]/50 transition-colors">
              <summary className="cursor-pointer list-none p-6 sm:p-8 font-semibold text-[#f5f3ef] flex items-center justify-between text-lg outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]/50 rounded-lg">
                <span className="pr-4">{f.q}</span>
                <span className="text-[#d4af37] transition-transform duration-300 group-open:rotate-180 flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-full bg-[#1a1816] border border-[#d4af37]/20">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </span>
              </summary>
              <div className="px-6 sm:px-8 pb-8 text-[#b8b3a8] leading-relaxed text-base border-t border-transparent group-open:border-[#d4af37]/5 pt-4">
                {f.a}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
