import SEO from "../components/SEO";

export default function Press() {
  const site = typeof window !== "undefined" ? window.location.origin : "https://vaiyu.co.in";
  return (
    <main id="main" className="mx-auto max-w-6xl px-4 py-10 space-y-8">
      <SEO
        title="Press & Media Kit"
        canonical={`${site}/press`}
        description="Logos, brand colors, and boilerplate for VAiyu."
        ogImage="/brand/vaiyu-logo-light.svg"
      />

      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Press & Media Kit</h1>
        <p className="text-gray-600">Download logos, brand colors, and boilerplate. For inquiries, email <a className="link" href="mailto:press@vaiyu.app">press@vaiyu.app</a>.</p>
      </header>

      {/* Logos */}
      <section className="card bg-white">
        <h2 className="text-lg font-semibold">Logos</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="p-4 rounded-xl border border-black/10 bg-gray-50">
            <div className="text-sm text-gray-600 mb-2">Dark on light</div>
            <img src="/brand/vaiyu-logo-dark.svg" alt="VAiyu logo dark" className="w-full h-auto" />
            <div className="mt-3 flex gap-2">
              <a className="btn btn-light" href="/brand/vaiyu-logo-dark.svg" download>Download SVG</a>
            </div>
          </div>
          <div className="p-4 rounded-xl border border-black/10 bg-[#0b1220]">
            <div className="text-sm text-white/70 mb-2">Light on dark</div>
            <img src="/brand/vaiyu-logo-light.svg" alt="VAiyu logo light" className="w-full h-auto" />
            <div className="mt-3 flex gap-2">
              <a className="btn btn-light" href="/brand/vaiyu-logo-light.svg" download>Download SVG</a>
            </div>
          </div>
        </div>
      </section>

      {/* Brand colors */}
      <section className="card bg-white">
        <h2 className="text-lg font-semibold">Brand colors</h2>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { name: "Primary", var: "brand.primary", hex: "#0F62FE" },
            { name: "Air",     var: "brand.air",     hex: "#00C853" },
            { name: "Spark",   var: "brand.spark",   hex: "#FF3B30" },
            { name: "Earth",   var: "brand.earth",   hex: "#FFD60A" },
            { name: "Space",   var: "brand.space",   hex: "#8E8E93" },
          ].map((c) => (
            <ColorSwatch key={c.name} name={c.name} token={c.var} hex={c.hex} />
          ))}
        </div>
        <div className="text-xs text-gray-500 mt-3">
          Download all tokens: <a className="link" href="/brand/brand-colors.json" download>brand-colors.json</a>
        </div>
      </section>

      {/* Boilerplate */}
      <section className="card bg-white">
        <h2 className="text-lg font-semibold">Boilerplate</h2>
        <p className="text-sm text-gray-700 mt-2">
          VAiyu is an AI OS for hospitality. We help hotels deliver faster service with truth-anchored reviews,
          refer-and-earn growth, and grid-smart operations. Learn more at <a className="link" href="/">vaiyu.co.in</a>.
        </p>
      </section>

      {/* Usage guidelines (short) */}
      <section className="card bg-white">
        <h2 className="text-lg font-semibold">Usage</h2>
        <ul className="mt-2 text-sm text-gray-700 list-disc pl-5 space-y-1">
          <li>Use dark logo on light backgrounds; light logo on dark.</li>
          <li>Maintain clearspace roughly equal to the height of the colored tiles.</li>
          <li>Don’t skew, recolor the tiles, or modify the wordmark.</li>
        </ul>
      </section>
    </main>
  );
}

function ColorSwatch({ name, token, hex }: { name: string; token: string; hex: string }) {
  return (
    <div className="rounded-xl border border-black/10 overflow-hidden">
      <div className="h-14" style={{ background: hex }} />
      <div className="p-2 text-xs">
        <div className="font-medium">{name}</div>
        <div className="text-gray-600">{hex}</div>
        <div className="mt-1 text-[10px] text-gray-500">token: {token}</div>
      </div>
    </div>
  );
}
