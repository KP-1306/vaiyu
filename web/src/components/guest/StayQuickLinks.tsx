// web/src/components/guest/StayQuickLinks.tsx

export type StayQuickLinksProps = {
  /** Optional stay / booking code for deep-links like /stay/:code/menu. */
  stayCode?: string;
  /**
   * Optional hotel slug – forwarded to the menu page so that the correct
   * property's services/food are loaded. Can be a slug OR an internal id.
   */
  hotelSlug?: string;
  /**
   * Optional hotel id (UUID or internal id). If hotelSlug is not provided,
   * this will be used as the generic hotel key.
   */
  hotelId?: string;
  /** Deep link for WhatsApp from Scan/OwnerSettings, if you want to reuse it. */
  openWhatsAppUrl?: string;

  /** Callbacks used by the Stay page to wire navigation / scrolling. */
  onOpenRoomServices?: () => void;
  onOpenFoodAndBeverages?: () => void;
  onOpenChat?: () => void;
  onOpenBill?: () => void;
  onOpenCheckout?: () => void;
  onOpenRewards?: () => void;

  /** Optional extra classes for the outer section. */
  className?: string;
};

/**
 * Tile grid used on the unified /stay/:code page to surface
 * all actions a guest can take from a single QR scan.
 *
 * Defaults are SAFE:
 *  - if callbacks are not provided, we fall back to simple
 *    window.location navigations using existing routes:
 *      • Services / Food → /stay/:code/menu?tab=...&hotel=...
 *      • Bill            → /bills
 *      • Checkout        → /checkout?code=... (+ hotel/property context)
 *      • Rewards         → /rewards
 *      • Chat            → WhatsApp link if given, else no-op
 *
 * This component also forwards multiple alias query params (hotel/hotelId/hotelSlug
 * and property/propertyId/propertySlug) to reduce mismatches across old/new handlers.
 */
export default function StayQuickLinks({
  stayCode,
  hotelSlug,
  hotelId,
  openWhatsAppUrl,
  onOpenRoomServices,
  onOpenFoodAndBeverages,
  onOpenChat,
  onOpenBill,
  onOpenCheckout,
  onOpenRewards,
  className,
}: StayQuickLinksProps) {
  const cleanStayCode = (stayCode || "").trim() || undefined;
  const cleanHotelSlug = (hotelSlug || "").trim() || undefined;
  const cleanHotelId = (hotelId || "").trim() || undefined;

  // Treat slug OR id as a single generic hotel key (fallback).
  const hotelKey = cleanHotelSlug || cleanHotelId;

  /** Build menu href with robust alias forwarding. */
  function buildMenuHref(tab?: "services" | "food") {
    const base = cleanStayCode
      ? `/stay/${encodeURIComponent(cleanStayCode)}/menu`
      : "/menu";

    const qp = new URLSearchParams();

    // Tab selection.
    if (tab) qp.set("tab", tab);

    // Stay context (safe for both /menu and /stay/:code/menu handlers).
    if (cleanStayCode) {
      qp.set("code", cleanStayCode);
      qp.set("bookingCode", cleanStayCode);
      qp.set("from", "stay");
    }

    // Hotel/property context aliases.
    // Prefer slug where available, otherwise id/key.
    if (cleanHotelSlug) {
      qp.set("hotel", cleanHotelSlug);
      qp.set("hotelSlug", cleanHotelSlug);
      qp.set("property", cleanHotelSlug);
      qp.set("propertySlug", cleanHotelSlug);
    } else if (hotelKey) {
      qp.set("hotel", hotelKey);
      qp.set("property", hotelKey);
    }

    if (cleanHotelId) {
      qp.set("hotelId", cleanHotelId);
      qp.set("propertyId", cleanHotelId);
    }

    const qs = qp.toString();
    return qs ? `${base}?${qs}` : base;
  }

  function buildCheckoutHref() {
    if (!cleanStayCode) return "/checkout";

    const qp = new URLSearchParams();
    qp.set("code", cleanStayCode);
    qp.set("bookingCode", cleanStayCode);
    qp.set("from", "stay");

    if (cleanHotelId) {
      qp.set("hotelId", cleanHotelId);
      qp.set("propertyId", cleanHotelId);
    }

    if (cleanHotelSlug) {
      qp.set("hotel", cleanHotelSlug);
      qp.set("hotelSlug", cleanHotelSlug);
      qp.set("property", cleanHotelSlug);
      qp.set("propertySlug", cleanHotelSlug);
    } else if (hotelKey) {
      // Fallback for older handlers that only read `hotel`.
      qp.set("hotel", hotelKey);
      qp.set("property", hotelKey);
    }

    return `/checkout?${qp.toString()}`;
  }

  function handleRoomServices() {
    if (onOpenRoomServices) return onOpenRoomServices();
    safeNavigate(buildMenuHref("services"));
  }

  function handleFood() {
    if (onOpenFoodAndBeverages) return onOpenFoodAndBeverages();
    safeNavigate(buildMenuHref("food"));
  }

  function handleBill() {
    if (onOpenBill) return onOpenBill();
    // User requested direct link to /stay/:code/orders for bills
    if (cleanStayCode) {
      safeNavigate(`/stay/${cleanStayCode}/orders`);
    } else {
      safeNavigate("/bills");
    }
  }

  function handleCheckout() {
    if (onOpenCheckout) return onOpenCheckout();
    safeNavigate(buildCheckoutHref());
  }

  function handleRewards() {
    if (onOpenRewards) return onOpenRewards();
    safeNavigate("/rewards");
  }

  function handleChat() {
    if (onOpenChat) return onOpenChat();
    if (openWhatsAppUrl) {
      try {
        window.open(openWhatsAppUrl, "_blank", "noreferrer");
      } catch {
        // ignore
      }
      return;
    }
    alert("Chat will appear here soon. For now, please call the front desk.");
  }

  return (
    <section
      id="stay-quick-links"
      className={
        "space-y-4 " +
        (className || "")
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Tile
          icon="🍽️"
          title="Order & Services"
          subtitle="Food, amenities, laundry & more"
          onClick={handleFood} // Using handleFood which routes to /menu, serving both purposes
        />
        <Tile
          icon="💬"
          title="Front Desk"
          subtitle={
            openWhatsAppUrl
              ? "Chat on WhatsApp"
              : "Ask us anything"
          }
          onClick={handleChat}
        />
        <Tile
          icon="📄"
          title="My bill"
          subtitle="Review your charges"
          onClick={handleBill}
        />
        <Tile
          icon="🚪"
          title="Checkout"
          subtitle="Plan your departure"
          onClick={handleCheckout}
        />
        <Tile
          icon="🎁"
          title="Rewards"
          subtitle="Credits & vouchers"
          onClick={handleRewards}
        />
        <Tile
          icon="📋"
          title="My requests"
          subtitle="Track service status"
          onClick={() => safeNavigate(`/stay/${cleanStayCode}/requests`)}
        />
        {/* Placeholder for layout balance if needed, or we can just leave it as grid fills naturally */}
      </div>
    </section>
  );
}

type TileProps = {
  icon: string;
  title: string;
  subtitle: string;
  onClick: () => void;
};

function Tile({ icon, title, subtitle, onClick }: TileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex flex-col items-start justify-between rounded-xl border border-slate-800 bg-[#1e293b] p-4 text-left transition-all duration-200 hover:border-slate-600 hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98] h-full"
    >
      {/* Hover Highlight */}
      <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />

      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900/50 text-2xl shadow-inner border border-slate-700/50">
        {icon}
      </div>

      <div>
        <div className="font-semibold text-slate-100 group-hover:text-white transition-colors">{title}</div>
        <div className="mt-1 text-[11px] font-medium text-slate-500 group-hover:text-slate-400 transition-colors leading-tight">
          {subtitle}
        </div>
      </div>
    </button>
  );
}

/** Safe navigation helper – keeps QR flows simple without importing router hooks. */
function safeNavigate(href: string) {
  try {
    if (href && typeof window !== "undefined") {
      window.location.href = href;
    }
  } catch {
    // ignore
  }
}
