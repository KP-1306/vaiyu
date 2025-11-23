// web/src/routes/Stays.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import StayQuickLinks from "../components/guest/StayQuickLinks";
import ChatPanel from "../components/chat/ChatPanel";
import StayWalletPanel from "../components/rewards/StayWalletPanel";

type StayView = {
  id: string;
  hotel_id: string;
  hotel_name?: string | null;
  city?: string | null;
  cover_image_url?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  earned_paise?: number | null;
  review_status?: string | null;
};

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s
  );

export default function Stay() {
  const { id: rawId = "" } = useParams<{ id: string }>();
  const id = rawId;
  const isStayId = !!id && isUuid(id);
  const isStayCode = !!id && !isStayId;

  const [loading, setLoading] = useState(true);
  const [stay, setStay] = useState<StayView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dates = useMemo(() => {
    if (!stay) return null;
    const ci = stay.check_in ? new Date(stay.check_in) : null;
    const co = stay.check_out ? new Date(stay.check_out) : null;
    return { ci, co };
  }, [stay]);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setError(null);
      setStay(null);

      if (!id) {
        setLoading(false);
        setError("We couldn’t find that stay.");
        return;
      }

      // QR / guest-link mode: non-UUID stay code → no account DB fetch here.
      if (!isStayId) {
        setLoading(false);
        return;
      }

      try {
        // 1) Preferred: read from the view (works with our list page)
        const v = await supabase
          .from("user_recent_stays")
          .select(
            "id, hotel_id, hotel_name, city, cover_image_url, check_in, check_out, earned_paise, review_status"
          )
          .eq("id", id)
          .maybeSingle();

        if (!alive) return;

        if (!v.error && v.data) {
          setStay(v.data as StayView);
          setLoading(false);
          return;
        }

        // 2) Fallback: pull base stay + hydrate hotel bits
        const s = await supabase
          .from("stays")
          .select(
            "id, hotel_id, check_in, check_out, earned_paise, review_status"
          )
          .eq("id", id)
          .maybeSingle();

        if (!alive) return;

        if (!s.error && s.data) {
          const base = s.data as Partial<StayView>;
          let hotel_name: string | null = null;
          let city: string | null = null;
          if (base.hotel_id) {
            const h = await supabase
              .from("hotels")
              .select("name, city, cover_image_url")
              .eq("id", base.hotel_id)
              .maybeSingle();
            if (!alive) return;
            if (!h.error && h.data) {
              hotel_name = (h.data as any).name ?? null;
              city = (h.data as any).city ?? null;
              (base as any).cover_image_url =
                (h.data as any).cover_image_url ?? null;
            }
          }
          setStay({
            id: base.id as string,
            hotel_id: base.hotel_id as string,
            hotel_name,
            city,
            cover_image_url: (base as any).cover_image_url ?? null,
            check_in: (base as any).check_in ?? null,
            check_out: (base as any).check_out ?? null,
            earned_paise: (base as any).earned_paise ?? 0,
            review_status: (base as any).review_status ?? null,
          });
        } else {
          setError("We couldn’t find that stay.");
        }
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Something went wrong.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [id, isStayId]);

  // ─────────────────────────────────────────────
  // QR / canonical guest link mode: /stay/:code (non-UUID)
  // ─────────────────────────────────────────────
  if (isStayCode) {
    return <QrStayHome code={id} />;
  }

  // ─────────────────────────────────────────────
  // Original “Stay details” page for logged-in guest (UUID id)
  // ─────────────────────────────────────────────
  return (
    <main className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Stay details</h1>
        {/* Single, clear CTA — removes duplicate labels */}
        <Link to="/stays" className="btn btn-light">
          Back to all stays
        </Link>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <section className="mt-6 rounded-2xl border bg-white/90 shadow-sm p-6">
          <div className="h-4 w-56 bg-gray-200 rounded mb-3" />
          <div className="h-24 w-full bg-gray-100 rounded" />
        </section>
      )}

      {/* Not found / no data state */}
      {!loading && (error || !stay) && (
        <section className="mt-6 rounded-2xl border bg-white/90 shadow-sm p-6">
          <p className="text-sm text-gray-700">
            {error || "We couldn’t find that stay."} If you haven’t stayed with
            a partner hotel yet, you’ll see your trips here once they’re
            available.
          </p>
          <div className="mt-4 flex gap-2">
            <Link to="/stays" className="btn">
              Browse all stays
            </Link>
            <Link to="/guest" className="btn btn-light">
              Back to dashboard
            </Link>
          </div>
        </section>
      )}

      {/* Happy path */}
      {!loading && stay && (
        <section className="mt-6 rounded-2xl border bg-white/90 shadow-sm overflow-hidden">
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">
                  {stay.hotel_name ?? "Partner hotel"}
                </h2>
                <p className="text-sm text-gray-500">{stay.city ?? ""}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 text-sm">
              <div>
                <span className="text-gray-500">Dates:</span>{" "}
                {dates?.ci || dates?.co
                  ? `${dates?.ci ? dates.ci.toLocaleDateString() : "—"} → ${
                      dates?.co ? dates.co.toLocaleDateString() : "—"
                    }`
                  : "Coming soon"}
              </div>
              <div>
                <span className="text-gray-500">Credits:</span>{" "}
                ₹{(((stay.earned_paise ?? 0) as number) / 100).toFixed(2)}
              </div>
              {stay.review_status && (
                <div>
                  <span className="text-gray-500">Review:</span>{" "}
                  {stay.review_status}
                </div>
              )}
            </div>

            <div className="mt-6">
              <Link to="/stays" className="btn">
                Back to all stays
              </Link>
              <Link to="/guest" className="btn btn-light ml-2">
                Back to dashboard
              </Link>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

/**
 * QR / guest home for non-UUID `/stay/:code` links.
 * This does NOT change any existing logged-in /stays flow.
 */
function QrStayHome({ code }: { code: string }) {
  const [searchParams] = useSearchParams();
  const hotelSlug = searchParams.get("hotel") || "";

  const hotelLabel = hotelSlug
    ? hotelSlug.replace(/[-_]+/g, " ")
    : "your VAiyu stay";

  // Build a WhatsApp share link for this canonical stay URL (if we have window)
  const whatsAppUrl =
    typeof window !== "undefined"
      ? (() => {
          const basePath = `/stay/${encodeURIComponent(code)}${
            hotelSlug ? `?hotel=${encodeURIComponent(hotelSlug)}` : ""
          }`;
          const fullUrl = `${window.location.origin || ""}${basePath}`;
          const textLines = [
            `Hi, this is my VAiyu stay link for ${hotelLabel}.`,
            "",
            fullUrl,
          ];
          const text = encodeURIComponent(textLines.join("\n"));
          return `https://wa.me/?text=${text}`;
        })()
      : undefined;

  return (
    <main className="max-w-5xl mx-auto p-6">
      <header className="mb-4 space-y-1">
        <p className="text-xs uppercase tracking-wide text-gray-500">
          Your stay link
        </p>
        <h1 className="text-2xl font-semibold">
          Your stay at{" "}
          <span className="text-teal-700 font-semibold">{hotelLabel}</span>
        </h1>
        <p className="text-sm text-gray-600">
          From this one page you can reach room services, food &amp; beverages,
          chat, your bill, checkout and rewards for this stay.
        </p>
        <p className="text-xs text-gray-500">
          Stay code:{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5">{code}</code>
        </p>
      </header>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)] items-start">
        <div className="space-y-3">
          <StayQuickLinks
            stayCode={code}
            hotelSlug={hotelSlug || undefined}
            openWhatsAppUrl={whatsAppUrl}
          />

          <section className="rounded-xl bg-gray-50 p-3 text-xs text-gray-600">
            <p>
              Tip: you can bookmark this page or save it inside a WhatsApp chat
              — the same link will keep working for this stay.
            </p>
            <p className="mt-1 text-[10px] text-gray-400">
              URL:{" "}
              <code>
                /stay/{code}
                {hotelSlug ? `?hotel=${hotelSlug}` : ""}
              </code>
            </p>
          </section>
        </div>

        <div className="space-y-3">
          <ChatPanel
            stayCode={code}
            hotelName={hotelLabel}
            messages={[]}
            openWhatsAppUrl={whatsAppUrl}
          />
          <StayWalletPanel hotelName={hotelLabel} />
        </div>
      </div>
    </main>
  );
}
