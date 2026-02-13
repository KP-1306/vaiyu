import { useEffect, useMemo, useState } from "react";
import {
  Link,
  useParams,
  useSearchParams,
  useLocation,
} from "react-router-dom";
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
  const location = useLocation();
  const stateStay = (location.state as any)?.stay as Partial<StayView> | undefined;

  const [loading, setLoading] = useState(true);
  const [stay, setStay] = useState<StayView | null>(
    stateStay && stateStay.id === id ? (stateStay as StayView) : null,
  );
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

      // Guard: if missing or not UUID, show friendly error.
      if (!id || !isUuid(id)) {
        setLoading(false);
        setError("We couldn’t find that stay.");
        setStay(null);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("user_recent_stays")
          .select(
            "id, hotel_id, hotel_name, city, cover_image_url, check_in, check_out, earned_paise, review_status",
          )
          .eq("id", id)
          .maybeSingle();

        if (!alive) return;

        if (error) {
          console.error("[StayDetails] user_recent_stays error", error);
          setError("We couldn’t find that stay.");
          setStay(null);
          return;
        }

        if (!data) {
          setError("We couldn’t find that stay.");
          setStay(null);
          return;
        }

        setStay(data as StayView);
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
    <main className="max-w-3xl mx-auto p-6 min-h-screen bg-slate-950 text-slate-200">
      <div className="flex items-center justify-between gap-2 mb-6">
        <h1 className="text-2xl font-bold text-white">Stay details</h1>
        <Link to="/stays" className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700 transition-colors">
          Back to all stays
        </Link>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <section className="rounded-2xl border border-slate-800 bg-[#1e293b] p-6 shadow-sm">
          <div className="h-4 w-56 bg-slate-700/50 rounded mb-3 animate-pulse" />
          <div className="h-24 w-full bg-slate-800/50 rounded animate-pulse" />
        </section>
      )}

      {/* Not found / error state */}
      {!loading && (error || !stay) && (
        <section className="rounded-2xl border border-slate-800 bg-[#1e293b] p-6 shadow-sm">
          <p className="text-sm text-slate-400">
            {error || "We couldn’t find that stay."} If you haven’t stayed with a
            partner hotel yet, you’ll see your trips here once they’re
            available.
          </p>
          <div className="mt-4 flex gap-2">
            <Link to="/stays" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors">
              Browse all stays
            </Link>
            <Link to="/guest" className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700 transition-colors">
              Back to dashboard
            </Link>
          </div>
        </section>
      )}

      {/* Happy path */}
      {!loading && stay && (
        <section className="rounded-2xl border border-slate-800 bg-[#1e293b] shadow-sm overflow-hidden">
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">
                  {stay.hotel_name ?? "Partner hotel"}
                </h2>
                <p className="text-sm text-slate-500">{stay.city ?? ""}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 text-sm">
              <div>
                <span className="text-slate-500">Dates:</span>{" "}
                <span className="text-slate-300">
                  {dates?.ci || dates?.co
                    ? `${dates?.ci ? dates.ci.toLocaleDateString() : "—"} → ${dates?.co ? dates.co.toLocaleDateString() : "—"
                    }`
                    : "Coming soon"}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Credits:</span>{" "}
                <span className="text-emerald-400 font-medium">₹{(((stay.earned_paise ?? 0) as number) / 100).toFixed(2)}</span>
              </div>
              {stay.review_status && (
                <div>
                  <span className="text-slate-500">Review:</span>{" "}
                  <span className="text-slate-300">{stay.review_status}</span>
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <Link to="/stays" className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700 transition-colors">
                Back to all stays
              </Link>
              <Link to="/guest" className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700 transition-colors">
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
  // Normalize code (uppercase to match DB)
  const normalizedCode = code.toUpperCase();
  const [searchParams, setSearchParams] = useSearchParams();

  // Extract special params as before
  const hotelSlug = searchParams.get("hotel") || searchParams.get("hotelSlug") || searchParams.get("property") || searchParams.get("propertySlug");
  const hotelId = searchParams.get("hotelId") || searchParams.get("propertyId");

  // Restore variables needed for downstream effects (fixes "rawHotelId undefined" error)
  const rawHotelId = hotelId || "";
  const rawSlug = hotelSlug || "";
  const hasHotelSlugParam = !!rawSlug;
  const hasHotelIdParam = !!rawHotelId;

  // Optimistic label if we have slug
  const hotelLabel = hasHotelSlugParam
    ? rawSlug.replace(/[-_]+/g, " ")
      .replace(/\b\w/g, c => c.toUpperCase()) // Capitalize Words
    : "your VAiyu stay";

  // We need to resolve the `stayId` (UUID) to enable real-time chat.
  // The code is just a string (booking code), multiple stays might share it (technically) 
  // but usually it's unique enough or we find the active one.
  const [stayUUID, setStayUUID] = useState<string>("");
  const [fetchedHotelName, setFetchedHotelName] = useState<string>("");

  useEffect(() => {
    let alive = true;
    (async () => {
      // Try to find the stay by booking code
      // We'll limit to active/future stays or just sort by checks_in_at desc
      const { data, error } = await supabase
        .from("stays")
        .select("id, hotel:hotels(label)")
        .ilike("booking_code", normalizedCode)
        .order("check_in_at", { ascending: false })
        .limit(1)
        .single();

      if (alive && data) {
        console.log("[Stay] Resolved stayUUID:", data.id);
        setStayUUID(data.id);
        if (data.hotel && typeof data.hotel !== 'string' && !Array.isArray(data.hotel)) {
          // @ts-ignore
          setFetchedHotelName(data.hotel.label);
        }
      } else {
        console.warn("[Stay] could not find stay by code:", normalizedCode);
      }
    })();
    return () => { alive = false; };
  }, [normalizedCode]);

  // Use the name from params if available (faster), or fallback to DB fetch
  const displayHotelName = fetchedHotelName || "your VAiyu stay";


  /**
   * Normalize the current /stay/:code URL so downstream tiles
   * (especially Checkout/Menu) can read/forward booking + property context.
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
      const slugKeys = ["hotel", "hotelSlug", "property", "propertySlug", "slug"];
      for (const k of slugKeys) {
        if (!next.get(k)) {
          next.set(k, rawSlug);
          changed = true;
        }
      }
    }

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
      qp.set("slug", rawSlug);
    }

    return qp;
  }, [code, rawHotelId, rawSlug]);

  const whatsAppUrl =
    typeof window !== "undefined"
      ? (() => {
        const basePath = `/stay/${encodeURIComponent(code)}${canonicalQuery.toString() ? `?${canonicalQuery.toString()}` : ""
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
    <main className="min-h-screen bg-slate-950 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 space-y-1">
          {/* Breadcrumbs */}
          <nav className="flex items-center gap-2 text-sm text-slate-500 mb-4">
            <Link to="/guest" className="hover:text-slate-300 transition-colors">Home</Link>
            <span className="text-slate-700">/</span>
            <span className="text-slate-300 font-medium">Stay</span>
          </nav>

          <div className="flex items-center justify-between">
            <div className="rounded-full bg-slate-900/50 px-2.5 py-1 text-[10px] font-medium text-slate-500 border border-slate-800">
              Code: <span className="text-slate-300 font-mono text-xs">{code}</span>
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Your stay at{" "}
            <span className="text-emerald-400">{hotelLabel}</span>
          </h1>
          <p className="max-w-2xl text-sm text-slate-400">
            Welcome. Tap a tile below to access services, order food, or contact the front desk.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)] items-start">
          <div className="space-y-6">
            <StayQuickLinks
              stayCode={code}
              hotelSlug={hasHotelSlugParam ? rawSlug : undefined}
              hotelId={hasHotelIdParam ? rawHotelId : undefined}
              openWhatsAppUrl={whatsAppUrl}
            />

            <section className="rounded-xl border border-dashed border-slate-700 bg-slate-900/30 p-4 text-xs text-slate-500">
              <p>
                <span className="font-semibold text-slate-400">Tip:</span> Bookmark this page or keep the link in WhatsApp
                — it's your personal key for this stay.
              </p>
            </section>
          </div>

          <div className="space-y-6">
            <ChatPanel
              stayId={stayUUID}
              stayCode={normalizedCode}
              hotelName={displayHotelName}
              messages={[]}
              openWhatsAppUrl={whatsAppUrl}
            />
            <StayWalletPanel hotelName={hotelLabel} />
          </div>
        </div>
      </div>
    </main>
  );
}
