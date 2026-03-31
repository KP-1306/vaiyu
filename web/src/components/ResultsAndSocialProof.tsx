import React from "react";

export default function ResultsAndSocialProof() {
  return (
    <section id="results" className="py-12 bg-transparent">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Caption */}
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#f5f3ef]">
            Proven Results, Real Impact.
          </h2>
          <p className="mt-4 text-[#b8b3a8] max-w-2xl mx-auto text-lg leading-relaxed">
            Hotels using VAiyu see measurable efficiency gains, happier guests,
            and smoother operations — all powered by AI-driven intelligence.
          </p>
        </div>

        {/* Split layout */}
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left — Image + KPIs */}
          <div className="relative rounded-[2rem] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.6)] ring-1 ring-[#d4af37]/20">
            <img
              src="/illustrations/results_lobby.jpg"
              alt="Hotel lobby operations with staff in motion"
              className="w-full object-cover aspect-[4/3] opacity-80"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0c]/80 via-transparent to-transparent pointer-events-none" />
            <div className="absolute bottom-6 left-6 flex flex-wrap gap-4 z-10">
              {[
                { label: "Room revenue", value: "+25%" },
                { label: "Operating costs", value: "−20%" },
                { label: "Guest satisfaction", value: "95%" },
              ].map((k, i) => (
                <div
                  key={i}
                  className="backdrop-blur-xl bg-[#141210]/80 rounded-2xl px-5 py-4 shadow-lg border border-[#d4af37]/30"
                >
                  <div className="text-2xl font-bold text-[#e9c55a]">{k.value}</div>
                  <div className="text-sm font-medium text-[#b8b3a8] mt-1 tracking-wide">{k.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right — text-only testimonials */}
          <div className="space-y-8">
            <h3 className="text-2xl font-semibold text-[#f5f3ef] mb-8">Results & Social Proof</h3>
            <blockquote className="border-l-[3px] border-[#d4af37]/50 pl-6 py-1 text-[#f5f3ef] text-xl leading-relaxed italic relative">
              <span className="absolute -left-3 -top-3 text-[#d4af37]/20 text-5xl font-serif">"</span>
              A game changer for us.
              <footer className="mt-3 text-sm font-medium text-[#d4af37] tracking-widest uppercase not-italic">— Hotel Owner</footer>
            </blockquote>
            <blockquote className="border-l-[3px] border-[#d4af37]/50 pl-6 py-1 text-[#f5f3ef] text-xl leading-relaxed italic relative">
               <span className="absolute -left-3 -top-3 text-[#d4af37]/20 text-5xl font-serif">"</span>
              Efficiency has improved across every department.
              <footer className="mt-3 text-sm font-medium text-[#d4af37] tracking-widest uppercase not-italic">— General Manager</footer>
            </blockquote>
            <blockquote className="border-l-[3px] border-[#d4af37]/50 pl-6 py-1 text-[#f5f3ef] text-xl leading-relaxed italic relative">
               <span className="absolute -left-3 -top-3 text-[#d4af37]/20 text-5xl font-serif">"</span>
              Guests noticed the difference from day one.
              <footer className="mt-3 text-sm font-medium text-[#d4af37] tracking-widest uppercase not-italic">— Operations Director</footer>
            </blockquote>
          </div>
        </div>
      </div>
    </section>
  );
}
