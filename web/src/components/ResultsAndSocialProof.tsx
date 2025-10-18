// web/src/components/ResultsAndSocialProof.tsx
import React from "react";
import { motion } from "framer-motion";

export default function ResultsAndSocialProof() {
  return (
    <section id="results" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Caption block */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl sm:text-4xl font-semibold text-gray-900">
            Proven Results, Real Impact.
          </h2>
          <p className="mt-3 text-gray-600 max-w-2xl mx-auto text-lg leading-relaxed">
            Hotels using VAiyu see measurable efficiency gains, happier guests,
            and smoother operations — all powered by AI-driven intelligence.
          </p>
        </motion.div>

        {/* Split layout: Image + KPIs (Left) / Testimonials (Right) */}
        <div className="grid lg:grid-cols-2 gap-10 items-center">
          {/* Left — Image with KPI overlays */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="relative rounded-3xl overflow-hidden shadow-lg"
          >
            <img
              src="/illustrations/results_lobby.jpg"
              alt="Hotel lobby operations with staff in motion"
              className="w-full object-cover aspect-[4/3]"
              loading="lazy"
            />
            <div className="absolute bottom-4 left-4 flex flex-wrap gap-4">
              {[
                { label: "Room revenue", value: "+25%" },
                { label: "Operating costs", value: "−20%" },
                { label: "Guest satisfaction", value: "95%" },
              ].map((k, i) => (
                <div
                  key={i}
                  className="backdrop-blur-md bg-white/90 rounded-xl px-4 py-3 shadow-sm border border-gray-200"
                >
                  <div className="text-2xl font-bold text-gray-900">
                    {k.value}
                  </div>
                  <div className="text-sm text-gray-600">{k.label}</div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Right — Text-only testimonials */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="space-y-10"
          >
            <h3 className="text-2xl font-semibold text-gray-900">
              Results & Social Proof
            </h3>

            <blockquote className="border-l-4 border-blue-500 pl-5 text-gray-800 text-lg leading-relaxed italic">
              “A game changer for us.”
              <footer className="mt-2 text-sm text-gray-500 not-italic">
                — Hotel Owner
              </footer>
            </blockquote>

            <blockquote className="border-l-4 border-emerald-500 pl-5 text-gray-800 text-lg leading-relaxed italic">
              “Efficiency has improved across every department.”
              <footer className="mt-2 text-sm text-gray-500 not-italic">
                — General Manager
              </footer>
            </blockquote>

            <blockquote className="border-l-4 border-amber-500 pl-5 text-gray-800 text-lg leading-relaxed italic">
              “Guests noticed the difference from day one.”
              <footer className="mt-2 text-sm text-gray-500 not-italic">
                — Operations Director
              </footer>
            </blockquote>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
