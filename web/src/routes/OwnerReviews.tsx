// web/src/routes/OwnerReviews.tsx
//
// Owner Reviews / Reputation — Supabase-native, reads the LIVE guest_reviews
// system (where the guest app actually writes), not the legacy `reviews` table.
// Owner actions that have real backing today: toggle visibility (is_public) and
// escalate (review_flags). Header metrics are computed client-side from the
// loaded rows (no dependency on a view's RLS).
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import OwnerGate from "../components/OwnerGate";
import SEO from "../components/SEO";
import { supabase } from "../lib/supabase";
import {
  Star,
  Flag,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  AlertTriangle,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  ShieldAlert,
} from "lucide-react";
import { useOwnerT } from "../i18n/useOwnerT";

type Review = {
  id: string;
  overall_rating: number;
  review_text: string | null;
  is_public: boolean;
  is_anonymous: boolean;
  created_at: string;
  guest_id: string | null;
  guests?: { full_name: string | null } | null;
};

type CatRating = { review_id: string; rating: number; label: string };

function Stars({ n }: { n: number }) {
  const t = useOwnerT('owner-reviews');
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={t('aria.starCount', '{{count}} stars', { count: n })}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={15}
          className={i <= n ? "text-amber-500 fill-amber-500" : "text-gray-300"}
        />
      ))}
    </span>
  );
}

export default function OwnerReviews() {
  const { slug } = useParams();
  const t = useOwnerT('owner-reviews');
  const [hotelId, setHotelId] = useState<string | null>(null);
  const [rows, setRows] = useState<Review[]>([]);
  const [catsByReview, setCatsByReview] = useState<Record<string, CatRating[]>>({});
  const [flagged, setFlagged] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState("");

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      const { data: h, error: hErr } = await supabase
        .from("hotels")
        .select("id")
        .eq("slug", slug)
        .single();
      if (hErr) throw hErr;
      const hid = h.id as string;
      setHotelId(hid);

      const { data: revs, error: rErr } = await supabase
        .from("guest_reviews")
        .select(
          "id, overall_rating, review_text, is_public, is_anonymous, created_at, guest_id, guests(full_name)"
        )
        .eq("hotel_id", hid)
        .order("created_at", { ascending: false });
      if (rErr) throw rErr;
      setRows((revs as any as Review[]) || []);

      const { data: flags } = await supabase
        .from("review_flags")
        .select("review_id, status")
        .eq("hotel_id", hid)
        .in("status", ["open", "in_progress"]);
      const fmap: Record<string, boolean> = {};
      for (const f of flags || []) fmap[(f as any).review_id] = true;
      setFlagged(fmap);

      try {
        const { data: cats } = await supabase
          .from("review_ratings")
          .select("review_id, rating, review_categories(label)")
          .eq("hotel_id", hid);
        const byReview: Record<string, CatRating[]> = {};
        for (const c of (cats as any[]) || []) {
          const label = c.review_categories?.label;
          if (!label) continue;
          (byReview[c.review_id] ||= []).push({
            review_id: c.review_id,
            rating: c.rating,
            label,
          });
        }
        setCatsByReview(byReview);
      } catch {
        setCatsByReview({});
      }
    } catch (e: any) {
      setErr(e?.message || t('state.loadFailed', 'Failed to load reviews'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        (r.review_text || "").toLowerCase().includes(s) ||
        (r.guests?.full_name || "").toLowerCase().includes(s)
    );
  }, [rows, q]);

  const metrics = useMemo(() => {
    const total = rows.length;
    const avg = total
      ? Math.round((rows.reduce((s, r) => s + (r.overall_rating || 0), 0) / total) * 10) / 10
      : 0;
    const positive = rows.filter((r) => r.overall_rating >= 4).length;
    const negative = rows.filter((r) => r.overall_rating <= 2).length;
    const escalations = Object.keys(flagged).length;
    const last = rows[0]?.created_at || null;
    return { total, avg, positive, negative, escalations, last };
  }, [rows, flagged]);

  async function toggleVisibility(r: Review) {
    setBusyId(r.id);
    try {
      const { error } = await supabase
        .from("guest_reviews")
        .update({ is_public: !r.is_public })
        .eq("id", r.id);
      if (error) throw error;
      setRows((prev) =>
        prev.map((x) => (x.id === r.id ? { ...x, is_public: !x.is_public } : x))
      );
    } catch (e: any) {
      setErr(e?.message || t('state.visibilityFailed', 'Could not change visibility'));
    } finally {
      setBusyId(null);
    }
  }

  async function escalate(r: Review) {
    if (!hotelId || flagged[r.id]) return;
    setBusyId(r.id);
    try {
      const flag_type = r.overall_rating <= 2 ? "low_rating" : "complaint";
      const severity = r.overall_rating <= 2 ? "high" : "medium";
      const { error } = await supabase.from("review_flags").insert({
        hotel_id: hotelId,
        review_id: r.id,
        flag_type,
        severity,
      });
      if (error) throw error;
      setFlagged((prev) => ({ ...prev, [r.id]: true }));
    } catch (e: any) {
      setErr(e?.message || t('state.escalateFailed', 'Could not escalate'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <OwnerGate>
      <SEO title={t('seo.title', 'Guest Reviews')} noIndex />
      <main className="vaiyu-owner max-w-4xl mx-auto p-4 space-y-4">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{t('page.title', 'Guest Reviews')}</h1>
            <div className="text-sm text-gray-600">
              {t('page.subtitle', "Real reviews left by your guests. Control what's public and escalate the ones that need attention.")}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              className="input"
              placeholder={t('action.searchPlaceholder', 'Search reviews…')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ width: 240 }}
            />
            <button className="btn btn-light" onClick={load} disabled={loading}>
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> {t('action.refresh', 'Refresh')}
            </button>
          </div>
        </header>

        {/* Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="card text-center">
            <div className="text-2xl font-bold flex items-center justify-center gap-1">
              {metrics.avg || "—"} <Star size={18} className="text-amber-500 fill-amber-500" />
            </div>
            <div className="text-xs text-gray-500 mt-1">{t('metric.average', 'Average rating')}</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold">{metrics.total}</div>
            <div className="text-xs text-gray-500 mt-1">{t('metric.total', 'Total reviews')}</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-emerald-600 flex items-center justify-center gap-1">
              <ThumbsUp size={16} /> {metrics.positive}
            </div>
            <div className="text-xs text-gray-500 mt-1">{t('metric.positive', 'Positive (4–5★)')}</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-rose-600 flex items-center justify-center gap-1">
              <ThumbsDown size={16} /> {metrics.negative}
            </div>
            <div className="text-xs text-gray-500 mt-1">{t('metric.negative', 'Negative (1–2★)')}</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-amber-600 flex items-center justify-center gap-1">
              <ShieldAlert size={16} /> {metrics.escalations}
            </div>
            <div className="text-xs text-gray-500 mt-1">{t('metric.escalations', 'Open escalations')}</div>
          </div>
        </div>

        {err && (
          <div className="card flex items-center gap-2" style={{ borderColor: "#f59e0b" }}>
            <AlertTriangle size={16} className="text-amber-500" /> {err}
          </div>
        )}
        {loading && (
          <div className="card flex items-center gap-2 text-gray-600">
            <Loader2 size={16} className="animate-spin" /> {t('state.loading', 'Loading reviews…')}
          </div>
        )}
        {!loading && rows.length === 0 && !err && (
          <div className="card text-center text-gray-600">
            <MessageSquare size={22} className="mx-auto mb-2 text-gray-400" />
            {t('state.noReviews', 'No guest reviews yet. They appear here as guests submit them at checkout.')}
          </div>
        )}

        {/* List */}
        <div className="space-y-3">
          {filtered.map((r) => {
            const cats = catsByReview[r.id] || [];
            const name = r.is_anonymous
              ? t('row.anon', 'Anonymous guest')
              : r.guests?.full_name || t('row.guest', 'Guest');
            const isFlagged = !!flagged[r.id];
            const busy = busyId === r.id;
            return (
              <div key={r.id} className="card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Stars n={r.overall_rating} />
                      <span className="text-sm font-semibold">{name}</span>
                      <span className="text-xs text-gray-500">
                        {new Date(r.created_at).toLocaleDateString()}
                      </span>
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                          r.is_public
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {r.is_public ? t('row.public', 'Public') : t('row.private', 'Private')}
                      </span>
                      {isFlagged && (
                        <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                          {t('row.escalated', 'Escalated')}
                        </span>
                      )}
                    </div>
                    {r.review_text && (
                      <div className="mt-2 text-sm whitespace-pre-wrap">{r.review_text}</div>
                    )}
                    {cats.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {cats.map((c, i) => (
                          <span
                            key={i}
                            className="text-[11px] bg-gray-100 text-gray-700 rounded-md px-2 py-0.5 inline-flex items-center gap-1"
                          >
                            {c.label}
                            <span className="inline-flex items-center gap-0.5 font-semibold">
                              {c.rating}
                              <Star size={10} className="text-amber-500 fill-amber-500" />
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                    <button
                      className="btn btn-light"
                      onClick={() => toggleVisibility(r)}
                      disabled={busy}
                      title={r.is_public ? t('row.hideTitle', 'Hide from public') : t('row.showTitle', 'Show publicly')}
                    >
                      {busy ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : r.is_public ? (
                        <EyeOff size={14} />
                      ) : (
                        <Eye size={14} />
                      )}
                      {r.is_public ? t('row.makePrivate', 'Make private') : t('row.makePublic', 'Make public')}
                    </button>
                    <button
                      className="btn btn-outline"
                      onClick={() => escalate(r)}
                      disabled={busy || isFlagged}
                      title={isFlagged ? t('row.alreadyEscalatedTitle', 'Already escalated') : t('row.escalateTitle', 'Escalate for follow-up')}
                    >
                      <Flag size={14} /> {isFlagged ? t('row.escalated', 'Escalated') : t('row.escalateBtn', 'Escalate')}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </OwnerGate>
  );
}
