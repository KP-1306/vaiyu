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
    safeNavigate("/bills");
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
        "rounded-2xl border bg-white/95 shadow-sm p-4 space-y-3 " +
        (className || "")
      }
    >
      <header>
        <h2 className="text-lg font-semibold">What would you like to do?</h2>
        <p className="text-xs text-gray-600 mt-1">
          All key actions for this stay in one place. Tap a tile to continue.
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-1">
        <Tile
          icon="🧹"
          title="Room services"
          subtitle="Housekeeping, amenities, laundry"
          onClick={handleRoomServices}
        />
        <Tile
          icon="🍽️"
          title="Food & beverages"
          subtitle="Order from the hotel menu"
          onClick={handleFood}
        />
        <Tile
          icon="💬"
          title="Chat with front desk"
          subtitle={
            openWhatsAppUrl
              ? "In-app or via WhatsApp"
              : "Ask anything about your stay"
          }
          onClick={handleChat}
        />
        <Tile
          icon="📄"
          title="My bill"
          subtitle="Review charges for this stay"
          onClick={handleBill}
        />
        <Tile
          icon="🚪"
          title="Checkout"
          subtitle="Plan your checkout time"
          onClick={handleCheckout}
        />
        <Tile
          icon="🎁"
          title="Rewards & offers"
          subtitle="Use credits or vouchers"
          onClick={handleRewards}
        />
        <Tile
          icon="📋"
          title="My requests"
          subtitle="Track your service requests"
          onClick={() => safeNavigate(`/stay/${cleanStayCode}/requests`)}
        />
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
      className="group flex flex-col items-start justify-between rounded-2xl border bg-slate-50/80 hover:bg-sky-50 hover:border-sky-200 transition-colors px-3 py-3 text-left h-full"
    >
      <div className="flex items-center gap-2">
        <span className="text-xl leading-none">{icon}</span>
        <span className="font-semibold text-sm">{title}</span>
      </div>
      <div className="mt-1 text-[11px] text-gray-600 group-hover:text-gray-700">
        {subtitle}
      </div>
      <div className="mt-2 text-[10px] text-sky-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
        Tap to continue →
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
