import SEO from "../components/SEO";

type BoxProps = { title: string; children: React.ReactNode };
const Box = ({ title, children }: BoxProps) => (
  <section className="card bg-white">
    <h2 className="font-semibold">{title}</h2>
    <div className="mt-2 text-gray-700">{children}</div>
  </section>
);

export default function Status() {
  const now = new Date().toLocaleString();

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 space-y-6">
      <SEO
        title="System Status — VAiyu"
        description="Current uptime and component status for VAiyu."
        canonical={`${window.location.origin}/status`}
      />

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">System Status</h1>
        <div className="text-sm text-gray-600">Last updated: {now}</div>
      </header>

      <Box title="Overall">
        <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 text-emerald-800 px-3 py-1 text-sm">
          <span>●</span> All systems operational
        </div>
      </Box>

      <div className="grid md:grid-cols-2 gap-4">
        <Box title="Edge Functions (Supabase)">
          No incidents reported. Deploys in the last 24h: ✅
        </Box>
        <Box title="Database (Supabase)">
          Read/write latency nominal. Backups healthy. ✅
        </Box>
        <Box title="Web (Netlify)">
          CDN and build pipeline healthy. ✅
        </Box>
        <Box title="Email (Magic Link)">
          Outbound transactional email healthy. ✅
        </Box>
      </div>

      <Box title="History">
        <p>No incidents in the last 30 days.</p>
      </Box>
    </main>
  );
}
