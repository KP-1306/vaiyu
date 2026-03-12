// web/src/routes/Owner.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Spinner from "../components/Spinner";

/* ─── Fallback cover images (curated Unsplash hotel/resort shots) ─── */
const FALLBACK_COVERS = [
  "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1582719508461-905c673771fd?w=800&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=800&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=800&q=80&auto=format&fit=crop",
];

/* ─── Types ─── */
type HotelCard = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  cover_image_path: string | null;
  role: string;
  rooms_total: number | null;
};

/* ─── Inline SVG Icons ─── */
function SearchIcon() {
  return (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 21h18M5 21V7l8-4v18M13 21V3l6 4v14M9 9v.01M9 13v.01M9 17v.01" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/* ─── Main Component ─── */
export default function Owner() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [hotels, setHotels] = useState<HotelCard[]>([]);
  const [search, setSearch] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const { data: sess } = await supabase.auth.getSession();
        const uid = sess?.session?.user?.id;
        const email = sess?.session?.user?.email ?? null;
        setUserEmail(email);
        if (!uid) {
          setErr("Not signed in.");
          setLoading(false);
          return;
        }

        // 1) memberships
        const memRes = await supabase
          .from("hotel_members")
          .select("hotel_id, role")
          .eq("user_id", uid);

        if (memRes.error) throw memRes.error;
        const members = memRes.data ?? [];
        if (members.length === 0) {
          setHotels([]);
          setLoading(false);
          return;
        }

        const ids = members.map((m) => m.hotel_id);
        const roleMap: Record<string, string> = {};
        members.forEach((m) => {
          roleMap[m.hotel_id] = m.role ?? "member";
        });

        // 2) hotels with cover images and city
        const hotRes = await supabase
          .from("hotels")
          .select("id, slug, name, city, cover_image_path, rooms_total")
          .in("id", ids);

        if (hotRes.error) throw hotRes.error;

        const hs: HotelCard[] = (hotRes.data ?? []).map((h: any) => ({
          id: h.id,
          slug: h.slug,
          name: h.name,
          city: h.city ?? null,
          cover_image_path: h.cover_image_path ?? null,
          role: roleMap[h.id] ?? "member",
          rooms_total: h.rooms_total ?? null,
        }));

        if (!alive) return;
        setHotels(hs);
        setLoading(false);

        // Auto-open when there's exactly one property
        if (hs.length === 1 && hs[0].slug) {
          nav(`/owner/${hs[0].slug}`, { replace: true });
        }
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Failed to load your properties.");
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [nav]);

  const filtered = useMemo(() => {
    if (!search.trim()) return hotels;
    const q = search.trim().toLowerCase();
    return hotels.filter(
      (h) =>
        h.name.toLowerCase().includes(q) ||
        (h.city && h.city.toLowerCase().includes(q))
    );
  }, [hotels, search]);

  /* ── Loading ── */
  if (loading) {
    return (
      <div className="min-h-screen bg-[#1a1c2e] grid place-items-center">
        <Spinner label="Loading your properties..." />
      </div>
    );
  }

  /* ── Error ── */
  if (err) {
    return (
      <div className="min-h-screen bg-[#1a1c2e] grid place-items-center">
        <div className="max-w-xl mx-auto p-6 rounded-2xl border border-white/10 bg-white/5 backdrop-blur shadow-lg">
          <div className="font-semibold text-rose-400 mb-2">Couldn't load your properties</div>
          <div className="text-sm text-slate-300 mb-3">{err}</div>
          <ul className="text-xs list-disc ml-5 space-y-1 text-slate-400">
            <li>Check that you're signed in with the invited/owner email.</li>
            <li>Make sure RLS policies allow <code className="text-slate-300">SELECT</code> on <code className="text-slate-300">hotel_members</code> and <code className="text-slate-300">hotels</code>.</li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1a1c2e]">
      {/* ── Header ── */}
      <header className="sticky top-0 z-30 bg-[#222540]/90 backdrop-blur-md border-b border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="text-white font-bold text-xl tracking-tight">
            Vai<span className="text-indigo-400">yu</span>
          </div>
          <div className="text-slate-400 text-sm font-medium hidden sm:block">
            Select a property to continue
          </div>
          <UserAvatar email={userEmail} />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* ── Toolbar: Search + Add ── */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-8">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500">
              <SearchIcon />
            </div>
            <input
              type="text"
              placeholder="Search property..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-11 pr-4 py-3 rounded-xl border border-white/10 bg-white/[0.06] text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400/40 transition-all"
            />
          </div>
          <Link
            to="/owner/register"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white bg-indigo-600 shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-500 hover:shadow-indigo-500/30 hover:scale-[1.02] active:scale-[0.98]"
          >
            <PlusIcon />
            Add property
          </Link>
        </div>

        {/* ── Property Grid ── */}
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-white/10 p-10 bg-white/[0.04] text-center">
            {hotels.length === 0 ? (
              <>
                <div className="text-4xl mb-3">🏨</div>
                <div className="font-semibold text-slate-200 mb-1">No properties yet</div>
                <div className="text-sm text-slate-400">Add a property or accept an invite sent to your email.</div>
              </>
            ) : (
              <>
                <div className="text-4xl mb-3">🔍</div>
                <div className="font-semibold text-slate-200 mb-1">No matches found</div>
                <div className="text-sm text-slate-400">Try a different search term.</div>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((h, idx) => (
              <PropertyCard key={h.id} hotel={h} index={idx} />
            ))}
          </div>
        )}

        {/* ── Footer Count ── */}
        {hotels.length > 0 && (
          <div className="mt-8 text-sm text-slate-500 font-medium">
            {hotels.length} {hotels.length === 1 ? "property" : "properties"}
          </div>
        )}
      </main>
    </div>
  );
}

/* ─── Property Card ─── */
function PropertyCard({ hotel, index }: { hotel: HotelCard; index: number }) {
  const coverUrl =
    hotel.cover_image_path || FALLBACK_COVERS[index % FALLBACK_COVERS.length];

  const roleLabel =
    hotel.role === "owner"
      ? "Owner"
      : hotel.role === "manager"
        ? "Manager"
        : hotel.role === "staff"
          ? "Staff"
          : hotel.role;

  const roleColor =
    hotel.role === "owner"
      ? "bg-indigo-500/20 text-indigo-300"
      : hotel.role === "manager"
        ? "bg-amber-500/20 text-amber-300"
        : "bg-white/10 text-slate-400";

  return (
    <Link
      to={`/owner/${hotel.slug}`}
      className="group rounded-2xl border border-white/[0.08] bg-[#222540]/70 backdrop-blur-sm overflow-hidden transition-all duration-300 hover:shadow-2xl hover:shadow-indigo-500/10 hover:-translate-y-1 hover:border-indigo-500/30"
    >
      {/* Cover Image */}
      <div className="relative h-44 sm:h-48 overflow-hidden bg-slate-800">
        <img
          src={coverUrl}
          alt={hotel.name}
          loading="lazy"
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          onError={(e) => {
            (e.target as HTMLImageElement).src =
              FALLBACK_COVERS[index % FALLBACK_COVERS.length];
          }}
        />
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#222540]/60 via-transparent to-transparent" />
      </div>

      {/* Card Body */}
      <div className="p-4">
        {/* Name + Chevron */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-white text-base truncate group-hover:text-indigo-300 transition-colors">
              {hotel.name}
            </h3>
            {hotel.city && (
              <p className="text-sm text-slate-400 mt-0.5">{hotel.city}</p>
            )}
          </div>
          <div className="mt-1 text-slate-500 group-hover:text-indigo-400 transition-colors shrink-0">
            <ChevronIcon />
          </div>
        </div>

        {/* Footer: Room count + Role + Open Console */}
        <div className="mt-3 pt-3 border-t border-white/[0.06] flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            {/* Room count */}
            {hotel.rooms_total != null && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400">
                <BuildingIcon />
                {hotel.rooms_total} Rooms
              </span>
            )}
            {/* Role badge */}
            <span
              className={`inline-flex items-center text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${roleColor}`}
            >
              {roleLabel}
            </span>
          </div>

          <span className="text-xs font-semibold text-indigo-400 group-hover:text-indigo-300 transition-colors whitespace-nowrap">
            Open Console ›
          </span>
        </div>
      </div>
    </Link>
  );
}

/* ─── User Avatar ─── */
function UserAvatar({ email }: { email: string | null }) {
  const [open, setOpen] = useState(false);
  const initial = email ? email[0].toUpperCase() : "U";

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/signin";
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-9 h-9 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-slate-300 font-bold text-sm hover:bg-white/15 hover:text-white transition-colors"
        title={email ?? "Account"}
      >
        {initial}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-56 rounded-xl bg-[#2a2d4a] border border-white/10 shadow-2xl py-2 z-50">
            {email && (
              <div className="px-4 py-2 text-xs text-slate-400 truncate border-b border-white/[0.06]">
                {email}
              </div>
            )}
            <button
              onClick={handleSignOut}
              className="w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors"
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
