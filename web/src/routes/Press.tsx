// web/src/routes/Press.tsx

import { Link } from "react-router-dom";
import SEO from "../components/SEO";

export default function Press() {
  const site =
    typeof window !== "undefined" ? window.location.origin : "https://vaiyu.co.in";

  return (
    <main id="main" className="min-h-screen bg-[#0a0a0c] text-[#f5f3ef]">
      <SEO
        title="Press & Media Kit"
        canonical={`${site}/press`}
        description="Logos, brand colors, boilerplate, and a downloadable press kit for VAiyu."
        ogImage="/brand/vaiyu-logo-light.svg"
      />

      {/* Hero */}
      <section
        className="relative isolate text-[#f5f3ef]"
        style={{
          background:
            "radial-gradient(ellipse 120% 80% at 20% 10%, rgba(212, 175, 55, 0.08), transparent 50%), radial-gradient(ellipse 100% 60% at 80% 20%, rgba(139, 90, 43, 0.06), transparent 45%), radial-gradient(ellipse 90% 70% at 50% 100%, rgba(30, 20, 10, 0.8), transparent 60%)",
        }}
      >
        <div className="relative z-[1] mx-auto max-w-6xl px-4 py-14 sm:py-16">
          <span className="inline-flex items-center gap-2 rounded-full bg-[#1a1816] border border-[#d4af37]/20 px-3 py-1 text-xs text-[#d4af37]">
            🗞️ Press & media
          </span>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">
            Press & Media Kit
          </h1>
          <p className="mt-3 max-w-2xl text-[#b8b3a8]">
            Download logos, brand colors, boilerplate and a press-ready zip. For inquiries,
            email <a className="text-[#d4af37] hover:text-[#e9c55a] transition-colors underline decoration-[#d4af37]/30 hover:decoration-[#d4af37] underline-offset-4" href="mailto:press@vaiyu.co.in">press@vaiyu.co.in</a>.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <a className="inline-flex items-center justify-center px-4 py-2 font-medium bg-[#e9c55a] text-[#0a0a0c] rounded-xl hover:bg-[#d4af37] transition-colors" href="/brand/vaiyu-media-kit.zip" download>
              Download media kit (.zip)
            </a>
            <Link to="/" className="inline-flex items-center justify-center px-4 py-2 font-medium bg-[#1a1816] text-[#b8b3a8] border border-[#d4af37]/20 rounded-xl hover:bg-[#24221f] hover:text-[#f5f3ef] transition-colors">
              Back to home
            </Link>
          </div>
        </div>

        <svg
          viewBox="0 0 1440 140"
          className="pointer-events-none absolute bottom-[-1px] left-0 w-full"
          aria-hidden
        >
          <path fill="#0a0a0c" d="M0,80 C240,160 480,0 720,60 C960,120 1200,40 1440,100 L1440,140 L0,140 Z" />
        </svg>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 space-y-8">
        {/* Logos */}
        <section className="bg-[#141210]/90 backdrop-blur-md border border-[#d4af37]/20 rounded-2xl p-6 sm:p-8 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
          <h2 className="text-xl font-semibold text-[#f5f3ef]">Primary Logo</h2>
          <div className="mt-5 grid max-w-sm gap-6">
            <div className="p-8 rounded-2xl border border-[#d4af37]/20 bg-[#060608] flex items-center justify-center min-h-[200px] shadow-inner">
              <div className="h-24 w-24 rounded-full bg-[#141210] border border-[#d4af37]/30 shadow-[0_0_24px_rgba(212,175,55,0.2)] flex items-center justify-center p-1 overflow-hidden transition-transform hover:scale-105 duration-300">
                <img
                  src="/brand/vaiyu-logo.png"
                  alt="VAiyu Primary Logo"
                  className="w-full h-full object-contain rounded-full"
                />
              </div>
            </div>
            
            <a className="inline-flex w-full items-center justify-center px-4 py-3 font-semibold bg-[#1a1816] text-[#b8b3a8] border border-[#d4af37]/30 rounded-xl hover:bg-[#d4af37] hover:text-[#0a0a0c] transition-all hover:shadow-[0_0_15px_rgba(212,175,55,0.4)]" href="/brand/vaiyu-logo.png" download>
              Download Logo (PNG)
            </a>
          </div>
        </section>

        {/* Brand colors */}
        <section className="bg-[#141210]/90 backdrop-blur-md border border-[#d4af37]/20 rounded-2xl p-6 sm:p-8 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
          <h2 className="text-xl font-semibold text-[#f5f3ef]">Brand colors</h2>
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-5 gap-4">
            {[
              { name: "Primary", var: "brand.primary", hex: "#0F62FE" },
              { name: "Air", var: "brand.air", hex: "#00C853" },
              { name: "Spark", var: "brand.spark", hex: "#FF3B30" },
              { name: "Earth", var: "brand.earth", hex: "#FFD60A" },
              { name: "Space", var: "brand.space", hex: "#8E8E93" },
            ].map((c) => (
              <ColorSwatch key={c.name} name={c.name} token={c.var} hex={c.hex} />
            ))}
          </div>
          <div className="text-xs text-[#7a756a] mt-5">
            Download all tokens:{" "}
            <a className="text-[#d4af37] hover:text-[#e9c55a] transition-colors underline decoration-[#d4af37]/30 hover:decoration-[#d4af37] underline-offset-4" href="/brand/brand-colors.json" download>
              brand-colors.json
            </a>
          </div>
        </section>

        {/* Boilerplate + contact */}
        <section className="bg-[#141210]/90 backdrop-blur-md border border-[#d4af37]/20 rounded-2xl p-6 sm:p-8 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
          <h2 className="text-xl font-semibold text-[#f5f3ef]">Boilerplate</h2>
          <p className="text-sm text-[#b8b3a8] mt-3 leading-relaxed max-w-4xl">
            VAiyu is an AI OS for hospitality. We help hotels deliver faster service with
            truth-anchored reviews, refer-and-earn growth, and grid-smart operations.
            Learn more at <a className="text-[#d4af37] hover:text-[#e9c55a] transition-colors underline decoration-[#d4af37]/30 hover:decoration-[#d4af37] underline-offset-4" href="/">vaiyu.co.in</a>.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a className="inline-flex items-center justify-center px-4 py-2 font-medium bg-[#1a1816] text-[#b8b3a8] border border-[#d4af37]/20 rounded-xl hover:bg-[#24221f] hover:text-[#f5f3ef] transition-colors" href="/brand/vaiyu-boilerplate.txt" download>
              Download boilerplate (.txt)
            </a>
            <a className="inline-flex items-center justify-center px-4 py-2 font-medium bg-[#1a1816] text-[#b8b3a8] border border-[#d4af37]/20 rounded-xl hover:bg-[#24221f] hover:text-[#f5f3ef] transition-colors" href="mailto:press@vaiyu.co.in">
              Contact press
            </a>
          </div>
        </section>

        {/* Usage guidelines */}
        <section className="bg-[#141210]/90 backdrop-blur-md border border-[#d4af37]/20 rounded-2xl p-6 sm:p-8 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
          <h2 className="text-xl font-semibold text-[#f5f3ef]">Usage</h2>
          <ul className="mt-4 text-sm text-[#b8b3a8] list-none space-y-3">
            <li className="flex items-start gap-2"><span className="text-[#d4af37]">•</span> To preserve brand integrity, do not stretch or alter the dimensions of the primary crest.</li>
            <li className="flex items-start gap-2"><span className="text-[#d4af37]">•</span> Maintain clearspace roughly equal to a quarter of the logo's diameter.</li>
            <li className="flex items-start gap-2"><span className="text-[#d4af37]">•</span> The logo may be presented on both light and dark backgrounds, provided there is adequate contrast.</li>
          </ul>
        </section>
      </section>
    </main>
  );
}

function ColorSwatch({
  name,
  token,
  hex,
}: {
  name: string;
  token: string;
  hex: string;
}) {
  return (
    <div className="rounded-2xl border border-[#d4af37]/20 overflow-hidden bg-[#1a1816]/50 transition-colors hover:bg-[#1a1816] shadow-sm">
      <div className="h-16 w-full" style={{ background: hex }} />
      <div className="p-3.5 text-xs">
        <div className="font-semibold text-[#f5f3ef]">{name}</div>
        <div className="text-[#b8b3a8] mt-0.5">{hex}</div>
        <div className="mt-2 text-[10px] text-[#7a756a] font-mono tracking-tight text-ellipsis overflow-hidden">token: {token}</div>
      </div>
    </div>
  );
}
