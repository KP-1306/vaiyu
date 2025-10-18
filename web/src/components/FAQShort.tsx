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
    <section id="faq" className="py-24 bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-semibold text-gray-900">Frequently Asked Questions</h2>
          <p className="mt-3 text-gray-600">Short answers owners and operators ask first.</p>
        </div>

        <div className="divide-y divide-gray-200 rounded-2xl border border-gray-200 bg-white">
          {faqs.map((f, i) => (
            <details key={i} className="group open:bg-gray-50">
              <summary className="cursor-pointer list-none p-5 sm:p-6 font-medium text-gray-900 flex items-center justify-between">
                <span>{f.q}</span>
                <span className="transition group-open:rotate-180">▾</span>
              </summary>
              <div className="px-5 sm:px-6 pb-6 text-gray-700 leading-relaxed">{f.a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
