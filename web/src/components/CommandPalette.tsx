// web/src/components/CommandPalette.tsx
// Global ⌘K / Ctrl-K command palette for the owner dashboard.
// - Jump to any owner feature (fuzzy over OWNER_NAV).
// - Find a booking/guest by code / name / phone (member-scoped via the
//   search_bookings_palette RPC).
// Mounted once in RootLayout; self-gates to owner routes (needs a :slug).
// Dependency-light: no cmdk/kbar — keyboard nav + fuzzy match are local.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search, CornerDownLeft, ArrowUp, ArrowDown, X, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { OWNER_NAV, type OwnerNavItem } from "../lib/ownerNav";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const RECENTS_KEY = "vaiyu.palette.recents.v1";
const DEBOUNCE_MS = 220;

/* ── slug from /owner/<slug>/… (exclude the slug-less owner routes) ── */
function ownerSlug(pathname: string): string | null {
  const m = pathname.match(/^\/owner\/([^/]+)/);
  if (!m) return null;
  const s = m[1];
  if (!s || s === ":slug" || s === "services" || s === "register") return null;
  return s;
}

/* ── tiny fuzzy matcher: substring (strong) or subsequence (weak) ── */
type Match = { score: number; ranges: Array<[number, number]> };
function matchLabel(label: string, q: string): Match | null {
  if (!q) return { score: 0, ranges: [] };
  const L = label.toLowerCase();
  const Q = q.toLowerCase();
  const idx = L.indexOf(Q);
  if (idx >= 0) {
    // Word-start matches rank above mid-word matches.
    const boundary = idx === 0 || /\s/.test(L[idx - 1]);
    return { score: (boundary ? 1000 : 700) - idx, ranges: [[idx, idx + Q.length]] };
  }
  // subsequence
  const ranges: Array<[number, number]> = [];
  let li = 0;
  for (let qi = 0; qi < Q.length; qi++) {
    const c = Q[qi];
    let found = -1;
    for (; li < L.length; li++) if (L[li] === c) { found = li; break; }
    if (found < 0) return null;
    ranges.push([found, found + 1]);
    li = found + 1;
  }
  return { score: 300 - (li - Q.length), ranges };
}

type BookingHit = {
  booking_id: string;
  code: string;
  status: string;
  guest_name: string | null;
  phone: string | null;
  scheduled_checkin_at: string | null;
  active_stay_id: string | null;
};

type FlatItem =
  | { kind: "nav"; key: string; nav: OwnerNavItem; ranges: Array<[number, number]> }
  | { kind: "booking"; key: string; hit: BookingHit };

function Highlight({ text, ranges }: { text: string; ranges: Array<[number, number]> }) {
  if (!ranges.length) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let cur = 0;
  ranges.forEach(([a, b], i) => {
    if (a > cur) out.push(<span key={`p${i}`}>{text.slice(cur, a)}</span>);
    out.push(<mark key={`m${i}`} className="bg-transparent text-indigo-300 font-semibold">{text.slice(a, b)}</mark>);
    cur = b;
  });
  if (cur < text.length) out.push(<span key="t">{text.slice(cur)}</span>);
  return <>{out}</>;
}

export default function CommandPalette() {
  const location = useLocation();
  const navigate = useNavigate();
  const slug = ownerSlug(location.pathname);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [bookings, setBookings] = useState<BookingHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const hotelIdRef = useRef<{ slug: string; id: string | null } | null>(null);

  /* load recents once */
  useEffect(() => {
    try { setRecents(JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]")); } catch { /* ignore */ }
  }, []);

  /* global ⌘K / Ctrl-K toggle */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        if (!ownerSlug(window.location.pathname)) return; // owner routes only
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* on open: reset + focus */
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setBookings([]);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  /* close if we navigate off owner routes */
  useEffect(() => { if (!slug && open) setOpen(false); }, [slug, open]);

  /* resolve slug → hotel_id (lazy, cached) for data search */
  const resolveHotelId = useCallback(async (): Promise<string | null> => {
    if (!slug) return null;
    if (hotelIdRef.current?.slug === slug) return hotelIdRef.current.id;
    const { data } = await supabase.from("v_public_hotels").select("id").ilike("slug", slug).maybeSingle();
    const id = (data as { id?: string } | null)?.id ?? null;
    hotelIdRef.current = { slug, id };
    return id;
  }, [slug]);

  /* debounced booking search */
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) { setBookings([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const hotelId = await resolveHotelId();
        if (!hotelId || cancelled) { if (!cancelled) { setBookings([]); setSearching(false); } return; }
        const { data, error } = await supabase.rpc("search_bookings_palette", {
          p_hotel_id: hotelId, p_query: q, p_limit: 6,
        });
        if (cancelled) return;
        setBookings(error || !Array.isArray(data) ? [] : (data as BookingHit[]));
      } catch { if (!cancelled) setBookings([]); } finally { if (!cancelled) setSearching(false); }
    }, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, open, resolveHotelId]);

  /* nav matches (filtered + scored) */
  const navMatches = useMemo(() => {
    const q = query.trim();
    if (!q) {
      const recentItems = recents
        .map((id) => OWNER_NAV.find((n) => n.id === id))
        .filter(Boolean) as OwnerNavItem[];
      const rest = OWNER_NAV.filter((n) => !recents.includes(n.id));
      return [...recentItems, ...rest].map((nav) => ({ nav, ranges: [] as Array<[number, number]> }));
    }
    const scored: Array<{ nav: OwnerNavItem; ranges: Array<[number, number]>; score: number }> = [];
    for (const nav of OWNER_NAV) {
      const onLabel = matchLabel(nav.label, q);
      const onKw = nav.keywords ? matchLabel(nav.keywords, q) : null;
      const best = onLabel && (!onKw || onLabel.score >= onKw.score) ? onLabel : onKw;
      if (!best) continue;
      scored.push({ nav, ranges: onLabel ? onLabel.ranges : [], score: best.score });
    }
    scored.sort((a, b) => b.score - a.score || a.nav.label.localeCompare(b.nav.label));
    return scored.slice(0, 8).map(({ nav, ranges }) => ({ nav, ranges }));
  }, [query, recents]);

  /* flat list for keyboard nav (nav first, then bookings) */
  const flat: FlatItem[] = useMemo(() => {
    const items: FlatItem[] = navMatches.map((m) => ({ kind: "nav", key: `nav:${m.nav.id}`, nav: m.nav, ranges: m.ranges }));
    bookings.forEach((b) => items.push({ kind: "booking", key: `bk:${b.booking_id}`, hit: b }));
    return items;
  }, [navMatches, bookings]);

  useEffect(() => { setActive((a) => Math.min(a, Math.max(0, flat.length - 1))); }, [flat.length]);

  /* keep active item in view */
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pushRecent = useCallback((id: string) => {
    setRecents((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 5);
      try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const choose = useCallback((item: FlatItem) => {
    if (!slug) return;
    if (item.kind === "nav") {
      pushRecent(item.nav.id);
      navigate(item.nav.to(slug));
    } else {
      // Deep-link to the arrivals/bookings board focused on this booking: the
      // board reads ?focus=<code>, switches to the all-dates view and pre-fills
      // its search so the matching row surfaces and can be acted on (folio,
      // check-in/out).
      navigate(`/owner/${slug}/arrivals?focus=${encodeURIComponent(item.hit.code)}`);
    }
    setOpen(false);
  }, [slug, navigate, pushRecent]);

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (flat[active]) choose(flat[active]); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  };

  if (!slug) return null;

  const showRecentsHeader = !query.trim() && recents.length > 0;
  let runningIdx = 0;

  return (
    <>
      {/* discoverable trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open search (Command or Control + K)"
        className="fixed bottom-5 right-5 z-[60] flex items-center gap-2 rounded-full border border-white/10 bg-[#16181b]/90 px-3.5 py-2 text-xs font-medium text-slate-300 shadow-xl backdrop-blur hover:border-indigo-500/40 hover:text-white transition"
      >
        <Search size={14} />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden sm:inline rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-400">{IS_MAC ? "⌘" : "Ctrl"} K</kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60 backdrop-blur-sm px-4 pt-[12vh]"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
        >
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[#16181b] shadow-2xl font-['Outfit']">
            {/* input */}
            <div className="flex items-center gap-3 border-b border-white/[0.06] px-4">
              <Search size={18} className="shrink-0 text-slate-500" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                onKeyDown={onInputKey}
                placeholder="Search features, bookings, guests…"
                aria-label="Search"
                aria-activedescendant={flat[active] ? `cp-${flat[active].key}` : undefined}
                className="w-full bg-transparent py-4 text-[15px] text-white placeholder-slate-500 outline-none"
              />
              {searching && <Loader2 size={16} className="shrink-0 animate-spin text-slate-500" />}
              <button onClick={() => setOpen(false)} aria-label="Close" className="shrink-0 rounded p-1 text-slate-500 hover:text-white">
                <X size={16} />
              </button>
            </div>

            {/* results */}
            <div ref={listRef} className="max-h-[55vh] overflow-y-auto py-2">
              {flat.length === 0 && (
                <div className="px-4 py-10 text-center text-sm text-slate-500">
                  {searching ? "Searching…" : "No matches. Try a feature name, booking code, or guest name."}
                </div>
              )}

              {/* nav section */}
              {navMatches.length > 0 && (
                <>
                  <div className="px-4 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                    {showRecentsHeader ? "Recent & all features" : "Features"}
                  </div>
                  {navMatches.map((m) => {
                    const idx = runningIdx++;
                    const Icon = m.nav.icon;
                    return (
                      <button
                        key={`nav:${m.nav.id}`}
                        id={`cp-nav:${m.nav.id}`}
                        data-idx={idx}
                        onMouseMove={() => setActive(idx)}
                        onClick={() => choose({ kind: "nav", key: `nav:${m.nav.id}`, nav: m.nav, ranges: m.ranges })}
                        role="option"
                        aria-selected={active === idx}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition ${active === idx ? "bg-indigo-500/15 text-white" : "text-slate-300"}`}
                      >
                        <Icon size={16} className={active === idx ? "text-indigo-300" : "text-slate-500"} />
                        <span className="flex-1 truncate"><Highlight text={m.nav.label} ranges={m.ranges} /></span>
                        <span className="text-[10px] uppercase tracking-wide text-slate-600">{m.nav.group}</span>
                      </button>
                    );
                  })}
                </>
              )}

              {/* bookings section */}
              {bookings.length > 0 && (
                <>
                  <div className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Bookings &amp; guests</div>
                  {bookings.map((b) => {
                    const idx = runningIdx++;
                    return (
                      <button
                        key={`bk:${b.booking_id}`}
                        id={`cp-bk:${b.booking_id}`}
                        data-idx={idx}
                        onMouseMove={() => setActive(idx)}
                        onClick={() => choose({ kind: "booking", key: `bk:${b.booking_id}`, hit: b })}
                        role="option"
                        aria-selected={active === idx}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition ${active === idx ? "bg-indigo-500/15 text-white" : "text-slate-300"}`}
                      >
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${active === idx ? "bg-indigo-500/25 text-indigo-200" : "bg-white/5 text-slate-400"}`}>
                          {(b.guest_name || "?").trim().charAt(0).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-slate-200">{b.guest_name || "Guest"}</span>
                          <span className="block truncate text-[11px] text-slate-500">{b.code}{b.phone ? ` · ${b.phone}` : ""}</span>
                        </span>
                        <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">{(b.status || "").replace(/_/g, " ")}</span>
                      </button>
                    );
                  })}
                </>
              )}
            </div>

            {/* footer hints */}
            <div className="flex items-center gap-4 border-t border-white/[0.06] px-4 py-2 text-[11px] text-slate-500">
              <span className="flex items-center gap-1"><ArrowUp size={11} /><ArrowDown size={11} /> navigate</span>
              <span className="flex items-center gap-1"><CornerDownLeft size={11} /> open</span>
              <span>esc to close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
