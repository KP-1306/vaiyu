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
    s,
  );

export default function Stay() {
  const { id: rawId = "" } = useParams<{ id: string }>();
  const id = rawId;
  const isStayId = !!id && isUuid(id);
  const isStayCode = !!id && !isStayId;

  // Non-UUID → QR canonical guest link (/stay/:code)
  if (isStayCode) {
    return <QrStayHome code={id} />;
  }

  // UUID → logged-in guest stay details
  return <StayDetails id={id} />;
}

function StayDetails({ id }: { id: string }) {
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

      // Guard: if missing or not UUID, show friendly error.
      if (!id || !isUuid(id)) {
        setLoading(false);
        setError("We couldn’t find that stay.");
        return;
      }

      try {
        // Fetch from the same view used by the list page.
        const { data, error } = await supabase
          .from("user_recent_stays")
          .select(
            "id, hotel_id, hotel_name, city, cover_image_url, check_in, check_out, earned_paise, review_status",
          )
          .eq("id", id);

        if (!alive) return;

        if (error) {
          console.error("[StayDetails] user_recent_stays error", error);
          setError("We couldn’t find that stay.");
          setStay(null);
          return;
        }

        const row = (data && data.length > 0 ? data[0] : null) as
          | StayView
          | null;

        if (!row) {
          setError("We couldn’t find that stay.");
          setStay(null);
          return;
        }

        setStay(row);
      } catch (e: any) {
        if (!alive) return;
        console.error("[StayDetails] unexpected error", e);
        setError(e?.message || "Something went wrong.");
        setStay(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <main className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Stay details</h1>
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

      {/* Not found / error state */}
      {!loading && (error || !stay) && (
        <section className="mt-6 rounded-2xl border bg-white/90 shadow-sm p-6">
          <p className="text-sm text-gray-700">
            {error || "We couldn’t find that stay."} If you haven’t stayed with a
            partner hotel yet, you’ll see your trips here once they’re
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
 * Canonical one-stop page for guests coming from QR / WhatsApp
 * AND from Guest Dashboard when it links by stay code.
 */
function QrStayHome({ code }: { code: string }) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Support multiple param names for robustness
  const rawHotelId =
    searchParams.get("hotelId") ||
    searchParams.get("hotel_id") ||
    searchParams.get("propertyId") ||
    "";

  const rawSlug =
    searchParams.get("hotel") ||
    searchParams.get("hotelSlug") ||
    searchParams.get("property") ||
    searchParams.get("propertySlug") ||
    "";

  const hasHotelSlugParam = !!rawSlug;
  const hasHotelIdParam = !!rawHotelId;

  const hotelLabel = hasHotelSlugParam
    ? rawSlug.replace(/[-_]+/g, " ")
    : "your VAiyu stay";

  /**
   * 🔧 IMPORTANT FIX:
   * Normalize the current /stay/:code URL so downstream tiles
   * (especially Checkout) can read/forward booking + property context.
   *
   * This avoids needing guests to manually type property slug
   * IF Checkout already supports any of these keys.
   */
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    let changed = false;

    // Always ensure bookingCode + code exist
    if (!next.get("code")) {
      next.set("code", code);
      changed = true;
    }
    if (!next.get("bookingCode")) {
      next.set("bookingCode", code);
      changed = true;
    }

    // Preserve hotelId if we have it via any alias
    if (rawHotelId && !next.get("hotelId")) {
      next.set("hotelId", rawHotelId);
      changed = true;
    }

    // If we have a slug in any form, add all aliases
    if (rawSlug) {
      const slugKeys = ["hotel", "hotelSlug", "property", "propertySlug"];
      for (const k of slugKeys) {
        if (!next.get(k)) {
          next.set(k, rawSlug);
          changed = true;
        }
      }
    }

    // Avoid infinite loops
    const currentStr = searchParams.toString();
    const nextStr = next.toString();

    if (changed && nextStr !== currentStr) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, rawHotelId, rawSlug, setSearchParams]);

  // Build a canonical query for share links / hint text
  const canonicalQuery = useMemo(() => {
    const qp = new URLSearchParams();

    // Booking identity
    qp.set("code", code);
    qp.set("bookingCode", code);

    // Hotel identity
    if (rawHotelId) qp.set("hotelId", rawHotelId);

    if (rawSlug) {
      qp.set("hotel", rawSlug);
      qp.set("hotelSlug", rawSlug);
      qp.set("property", rawSlug);
      qp.set("propertySlug", rawSlug);
    }

    return qp;
  }, [code, rawHotelId, rawSlug]);

  const whatsAppUrl =
    typeof window !== "undefined"
      ? (() => {
          const basePath = `/stay/${encodeURIComponent(code)}${
            canonicalQuery.toString() ? `?${canonicalQuery.toString()}` : ""
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
            // Forward slug or id so Menu.tsx can load the correct hotel config
            hotelSlug={hasHotelSlugParam ? rawSlug : undefined}
            hotelId={hasHotelIdParam ? rawHotelId : undefined}
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
                {canonicalQuery.toString()
                  ? `?${canonicalQuery.toString()}`
                  : ""}
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
