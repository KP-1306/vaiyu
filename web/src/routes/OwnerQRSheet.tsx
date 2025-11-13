// web/src/routes/OwnerQRSheet.tsx

import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import SEO from "../components/SEO";
import { getHotel } from "../lib/api";

type Hotel = {
  slug: string;
  name?: string;
  address?: string;
};

const COPIES = 6; // how many QR labels per page

export default function OwnerQRSheet() {
  const { slug = "" } = useParams();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);

    (async () => {
      try {
        if (!slug) throw new Error("Missing hotel slug in URL");
        const data: any = await getHotel(slug);
        if (cancelled) return;
        setHotel({
          slug,
          name: data?.name ?? data?.hotel?.name ?? slug,
          address: data?.address ?? data?.hotel?.address ?? "",
        });
      } catch (e: any) {
        if (cancelled) return;
        setErr(e?.message || "Failed to load hotel");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const shareUrl = useMemo(() => {
    if (!slug) return "";
    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "https://vaiyu.co.in";
    return `${origin}/menu?hotelSlug=${encodeURIComponent(slug)}`;
  }, [slug]);

  const qrSrc = useMemo(() => {
    if (!shareUrl) return "";
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
      shareUrl,
    )}`;
  }, [shareUrl]);

  const hotelName = hotel?.name || slug || "Your Hotel";

  function handlePrint() {
    window.print();
  }

  return (
    <>
      <SEO title="QR Sheet – Guest Menu" noIndex />

      <main className="max-w-5xl mx-auto p-4 space-y-4 print:p-2">
        {/* Header (hidden on print if you style .print:hidden globally) */}
        <header className="flex items-center justify-between gap-3 print:hidden">
          <div>
            <h1 className="text-xl font-semibold">QR Sheet for Guest Menu</h1>
            <p className="text-sm text-gray-600">
              Property: <b>{hotelName}</b>{" "}
              {hotel?.address && <span> • {hotel.address}</span>}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Print this sheet, cut the cards and place them in rooms / at
              reception. Scanning opens the VAiyu-powered guest menu for this
              property.
            </p>
          </div>
          <button className="btn btn-light" onClick={handlePrint}>
            Print
          </button>
        </header>

        {loading && (
          <div className="text-gray-500 print:hidden">Loading hotel…</div>
        )}
        {err && !loading && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-800 print:hidden">
            {err}
          </div>
        )}

        {/* Printable grid */}
        {!loading && !err && shareUrl && qrSrc && (
          <section className="bg-white rounded shadow p-4 print:shadow-none print:p-0">
            <div className="grid md:grid-cols-3 gap-4">
              {Array.from({ length: COPIES }).map((_, i) => (
                <div
                  key={i}
                  className="border rounded-lg p-3 flex flex-col items-center justify-between text-center break-inside-avoid-page"
                  style={{
                    pageBreakInside: "avoid",
                  }}
                >
                  <div className="text-xs text-gray-600 mb-2">
                    Scan for{" "}
                    <span className="font-semibold">{hotelName}</span> services
                    &amp; menu
                  </div>
                  <img
                    src={qrSrc}
                    alt="QR code for guest menu"
                    className="mb-2"
                  />
                  <div className="text-[11px] text-gray-700 leading-snug">
                    <div className="font-semibold">{hotelName}</div>
                    {hotel?.address && (
                      <div className="text-[10px]">{hotel.address}</div>
                    )}
                    <div className="mt-1 text-[10px] text-gray-500">
                      Powered by <span className="font-semibold">VAiyu</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Tiny footer note for print */}
            <p className="text-[10px] text-gray-400 mt-4 text-right">
              Guest menu link:{" "}
              <span className="underline break-all">{shareUrl}</span>
            </p>
          </section>
        )}

        {/* Fallback if slug/URL missing */}
        {!loading && !err && !shareUrl && (
          <div className="text-sm text-gray-600">
            Missing hotel slug. Open this page as{" "}
            <code>/owner/&lt;slug&gt;/qr</code>.
          </div>
        )}
      </main>
    </>
  );
}
