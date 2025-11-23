// web/src/routes/Stay.tsx
import { Link, useParams, useSearchParams } from "react-router-dom";
import StayQuickLinks from "../components/guest/StayQuickLinks";
import ChatPanel from "../components/chat/ChatPanel";
import StayWalletPanel from "../components/rewards/StayWalletPanel";

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s
  );

export default function Stay() {
  const { id = "" } = useParams<{ id: string }>();

  const isStayId = !!id && isUuid(id);
  const isStayCode = !!id && !isStayId;

  // ─────────────────────────────────────────────
  // QR / canonical guest link mode: /stay/:code (non-UUID)
  // ─────────────────────────────────────────────
  if (isStayCode) {
    return <QrStayHome code={id} />;
  }

  // ─────────────────────────────────────────────
  // Original "Stay details" page for logged-in guest (UUID id or empty)
  // ─────────────────────────────────────────────
  return (
    <main className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Stay details</h1>
        <Link to="/stays" className="btn btn-light">
          All stays
        </Link>
      </div>

      <p className="text-sm text-gray-600 mt-2">
        You opened stay{" "}
        <span className="font-mono">{id || "not specified"}</span>.
      </p>

      <section className="mt-6 rounded-2xl border bg-white/90 shadow-sm p-5">
        <p className="text-sm text-gray-700">
          We’ll show booking info, hotel reply, review, and any credits earned
          for this stay.
        </p>

        <div className="mt-4 flex gap-2 flex-wrap">
          <Link to="/guest" className="btn btn-light">
            Back to dashboard
          </Link>
          <Link to="/stays" className="btn btn-light">
            See all stays
          </Link>
        </div>
      </section>
    </main>
  );
}

/**
 * QR / guest home for non-UUID `/stay/:code` links.
 * Canonical one-stop page for guests coming from QR / WhatsApp.
 */
function QrStayHome({ code }: { code: string }) {
  const [searchParams] = useSearchParams();
  const hotelSlug = searchParams.get("hotel") || "";

  const hotelLabel = hotelSlug
    ? hotelSlug.replace(/[-_]+/g, " ")
    : "your VAiyu stay";

  // Build a WhatsApp share link for this canonical stay URL (best-effort).
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
