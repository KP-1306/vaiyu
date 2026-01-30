// web/src/routes/Menu.tsx

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, useNavigate, Link } from "react-router-dom";
import {
  getServices,
  getMenu,
  createTicket,
  createOrder,
  isDemo,
  type Service,
  supa, // [NEW] for storage upload
} from "../lib/api";
import { dbg, dbgError } from "../lib/debug";
import { X, Bell, Camera, AlertCircle, Utensils, Wrench, HelpCircle, Brush, ArrowDownRight } from "lucide-react";
import { CustomZoneSelect } from "../components/CustomZoneSelect";

function getServiceIcon(key: string) {
  const k = key.toLowerCase();
  if (k.includes("clean") || k.includes("housekeeping") || k.includes("maid")) return "✨";
  if (k.includes("towel") || k.includes("linen") || k.includes("pillow")) return "🌥️";
  if (k.includes("water") || k.includes("plumb") || k.includes("leak") || k.includes("bath")) return "🚿";
  if (k.includes("electric") || k.includes("light") || k.includes("power") || k.includes("socket")) return "💡";
  if (k.includes("wifi") || k.includes("net") || k.includes("tv")) return "📶";
  if (k.includes("food") || k.includes("dining") || k.includes("plate") || k.includes("cutlery")) return "🍽️";
  if (k.includes("key") || k.includes("lock") || k.includes("access")) return "🔑";
  if (k.includes("ac") || k.includes("heat") || k.includes("cool")) return "❄️";
  if (k.includes("laundry") || k.includes("iron")) return "👕";
  if (k.includes("maintenance") || k.includes("repair") || k.includes("fix")) return "🔧";
  if (k.includes("garbage") || k.includes("trash") || k.includes("bin")) return "🗑️";
  return "🛎️";
}
type FoodItem = { item_key: string; name: string; base_price: number };

type LoadState<T> = {
  loading: boolean;
  error: string | null;
  items: T[];
};

function pickFirst(...vals: Array<string | null | undefined>) {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export default function Menu() {
  // booking code from route: /stay/:code/menu  (fallback to DEMO)
  const { code: routeCode = "DEMO" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const qpTab = (searchParams.get("tab") || "").toLowerCase();
  const initialTab: "food" | "services" =
    qpTab === "food" ? "food" : "services";
  const [tab, setTab] = useState<"food" | "services">(initialTab);

  // Keep tab in sync if URL query changes
  useEffect(() => {
    const next = (searchParams.get("tab") || "").toLowerCase();
    const nextTab: "food" | "services" = next === "food" ? "food" : "services";
    setTab(nextTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);

  // Normalize stay code from all aliases
  const stayCode = useMemo(() => {
    const qpCode = pickFirst(
      searchParams.get("bookingCode"),
      searchParams.get("code"),
    );
    return pickFirst(qpCode, routeCode, "DEMO");
  }, [searchParams, routeCode]);

  // Normalize property identity from all aliases
  const hotelId = useMemo(
    () =>
      pickFirst(
        searchParams.get("hotelId"),
        searchParams.get("hotel_id"),
        searchParams.get("propertyId"),
        searchParams.get("property_id"),
      ),
    [searchParams],
  );

  const hotelSlug = useMemo(
    () =>
      pickFirst(
        searchParams.get("hotel"),
        searchParams.get("hotelSlug"),
        searchParams.get("property"),
        searchParams.get("propertySlug"),
        searchParams.get("slug"),
      ),
    [searchParams],
  );

  // State to hold resolved hotel_id from stay lookup
  const [resolvedHotelId, setResolvedHotelId] = useState<string | null>(null);
  const [resolvedStayId, setResolvedStayId] = useState<string | null>(null);
  const [resolvedRoomId, setResolvedRoomId] = useState<string | null>(null);
  const [resolvedZoneId, setResolvedZoneId] = useState<string | null>(null);
  const [stayLookupDone, setStayLookupDone] = useState(false);

  // A single stable key we can use for fetching
  // When loading from stay code, MUST use resolvedHotelId (not stayCode)
  const propertyKey = useMemo(
    () => pickFirst(resolvedHotelId, hotelId, hotelSlug),
    [resolvedHotelId, hotelId, hotelSlug],
  );

  // Simple state for data
  const [servicesState, setServicesState] = useState<LoadState<Service>>({
    loading: true,
    error: null,
    items: [],
  });

  const [foodState, setFoodState] = useState<LoadState<FoodItem>>({
    loading: true,
    error: null,
    items: [],
  });

  // Cart for food
  const [cart, setCart] = useState<Record<string, number>>({});
  const cartCount = useMemo(
    () => Object.values(cart).reduce((a, b) => a + b, 0),
    [cart],
  );

  // First, resolve stay code to hotel_id, room_id, and zone_id
  useEffect(() => {
    let alive = true;

    (async () => {
      // If we have a stay code, look it up to get hotel_id, room_id, and zone_id
      if (stayCode && stayCode !== "DEMO") {
        try {
          const { supabase } = await import("../lib/supabase");

          // Get the authenticated user
          // Use secure RPC to resolve stay (bypassing RLS)
          const { data, error } = await supabase
            .rpc("resolve_stay_by_code", { p_code: stayCode })
            .maybeSingle();

          if (!alive) return;

          if (data) {
            const d = data as any;
            dbg("[Menu] Resolved stay via RPC:", d);
            if (d.stay_id) setResolvedStayId(d.stay_id);
            if (d.hotel_id) setResolvedHotelId(d.hotel_id);
            if (d.room_id) setResolvedRoomId(d.room_id);
            if (d.zone_id) setResolvedZoneId(d.zone_id);
          } else if (error) {
            dbgError("[Menu] Stay lookup RPC error:", error);
          } else {
            dbgError(`[Menu] No stay found for code: ${stayCode}`, null); // Fixed arg count
          }
        } catch (e: any) {
          dbgError("[Menu] Failed to resolve stay:", e);
        }
      } else if (hotelId) {
        // If no stay code but we have hotelId from URL, just set it
        if (alive) {
          setResolvedHotelId(hotelId);
        }
      }

      if (alive) setStayLookupDone(true);
    })();

    return () => {
      alive = false;
    };
  }, [stayCode, hotelId]);

  // Ensure URL always has core identity hints (helps downstream too)
  // BUT: Don't add hotelId if it was derived from stay code (keep URLs clean)
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    let changed = false;

    if (stayCode && !next.get("code")) {
      next.set("code", stayCode);
      changed = true;
    }
    if (stayCode && !next.get("bookingCode")) {
      next.set("bookingCode", stayCode);
      changed = true;
    }
    if (!next.get("from")) {
      next.set("from", "stay");
      changed = true;
    }

    // Only add hotelId/propertyId if they were in the original URL
    // Don't pollute URL with derived hotelId from stay lookup
    // (This keeps URLs clean and follows Google-architect principle)

    if (hotelSlug) {
      const keys = ["hotel", "hotelSlug", "property", "propertySlug", "slug"];
      for (const k of keys) {
        if (!next.get(k)) {
          next.set(k, hotelSlug);
          changed = true;
        }
      }
    }

    if (!next.get("tab")) {
      next.set("tab", tab);
      changed = true;
    }

    if (changed && next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stayCode, hotelSlug, tab]);

  /** Safe fetch helper that won't break older signatures */
  async function safeGetServices() {
    const ctx = { stayCode, hotelId, hotelSlug, propertyKey };

    console.log("[Menu] safeGetServices - propertyKey:", propertyKey);
    console.log("[Menu] safeGetServices - hotelId:", hotelId);
    console.log("[Menu] safeGetServices - resolvedHotelId:", resolvedHotelId);

    // Extra args are ignored in JS if the function doesn't accept them.
    const response = await (getServices as any)(propertyKey, ctx);

    console.log("[Menu] getServices response:", response);

    // Handle both {items: []} and direct [] responses
    const primary = Array.isArray(response) ? response : (response?.items || []);

    console.log("[Menu] Extracted services array:", primary);

    if (Array.isArray(primary) && primary.length) return primary;

    // Fallback: try stayCode specifically if propertyKey differs
    if (propertyKey !== stayCode) {
      console.log("[Menu] Trying fallback with stayCode:", stayCode);
      const fallbackResponse = await (getServices as any)(stayCode, ctx);
      const fallback = Array.isArray(fallbackResponse) ? fallbackResponse : (fallbackResponse?.items || []);
      console.log("[Menu] Fallback services array:", fallback);
      if (Array.isArray(fallback) && fallback.length) return fallback;
    }

    return [];
  }

  async function safeGetMenu() {
    const ctx = { stayCode, hotelId, hotelSlug, propertyKey };

    console.log("[Menu] safeGetMenu - propertyKey:", propertyKey);

    const response = await (getMenu as any)(propertyKey, ctx);

    console.log("[Menu] getMenu response:", response);

    // Handle both {items: []} and direct [] responses
    const primary = Array.isArray(response) ? response : (response?.items || []);

    console.log("[Menu] Extracted menu items array:", primary);

    if (Array.isArray(primary) && primary.length) return primary;

    if (propertyKey !== stayCode) {
      console.log("[Menu] Trying menu fallback with stayCode:", stayCode);
      const fallbackResponse = await (getMenu as any)(stayCode, ctx);
      const fallback = Array.isArray(fallbackResponse) ? fallbackResponse : (fallbackResponse?.items || []);
      console.log("[Menu] Fallback menu items array:", fallback);
      if (Array.isArray(fallback) && fallback.length) return fallback;
    }

    return [];
  }

  // Load services (only after stay lookup is done)
  useEffect(() => {
    // Wait for stay lookup to complete
    if (!stayLookupDone) return;

    let alive = true;

    (async () => {
      setServicesState({ loading: true, error: null, items: [] });

      try {
        if (isDemo()) {
          const demo: Service[] = [
            { key: "housekeeping", label_en: "Housekeeping", sla_minutes: 20, department_id: "00000000-0000-0000-0000-000000000000", department_name: "Housekeeping" },
            { key: "linen", label_en: "Fresh linen", sla_minutes: 30, department_id: "00000000-0000-0000-0000-000000000000", department_name: "Housekeeping" },
            { key: "maintenance", label_en: "Maintenance", sla_minutes: 45, department_id: "00000000-0000-0000-0000-000000000000", department_name: "Maintenance" },
          ];
          if (alive) setServicesState({ loading: false, error: null, items: demo });
          return;
        }

        const items = await safeGetServices();
        if (!alive) return;

        setServicesState({
          loading: false,
          error: null,
          items,
        });
      } catch (e: any) {
        dbgError("[Menu] getServices failed", e);
        if (!alive) return;
        setServicesState({
          loading: false,
          error: e?.message || "Could not load services.",
          items: [],
        });
      }
    })();

    return () => {
      alive = false;
    };
  }, [stayCode, hotelId, hotelSlug, propertyKey, stayLookupDone, resolvedHotelId]);

  // Load food (only after stay lookup is done)
  useEffect(() => {
    // Wait for stay lookup to complete
    if (!stayLookupDone) return;

    let alive = true;

    (async () => {
      setFoodState({ loading: true, error: null, items: [] });

      try {
        if (isDemo()) {
          const demo: FoodItem[] = [
            { item_key: "tea", name: "Masala Tea", base_price: 80 },
            { item_key: "sandwich", name: "Grilled Sandwich", base_price: 160 },
            { item_key: "thali", name: "Veg Thali", base_price: 280 },
          ];
          if (alive) setFoodState({ loading: false, error: null, items: demo });
          return;
        }

        const items = await safeGetMenu();
        if (!alive) return;

        setFoodState({
          loading: false,
          error: null,
          items,
        });
      } catch (e: any) {
        dbgError("[Menu] getMenu failed", e);
        if (!alive) return;
        setFoodState({
          loading: false,
          error: e?.message || "Could not load menu.",
          items: [],
        });
      }
    })();

    return () => {
      alive = false;
    };
  }, [stayCode, hotelId, hotelSlug, propertyKey, stayLookupDone, resolvedHotelId]);

  function switchTab(next: "services" | "food") {
    setTab(next);
    const nextQP = new URLSearchParams(searchParams);
    nextQP.set("tab", next);
    navigate({ search: nextQP.toString() }, { replace: true });
  }

  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedCategory, setSelectedCategory] = useState("All");

  function requestService(svc: Service) {
    setSelectedService(svc);
  }

  async function confirmRequest(data: { note: string; priority: string; locationType: string; publicLocation: string; zoneId?: string }) {
    if (!selectedService) return;
    try {
      dbg(`[Menu] request service ${selectedService.key} for stay ${stayCode}`);

      const effectiveHotelId = resolvedHotelId || hotelId;

      if (!resolvedRoomId && !resolvedZoneId) {
        alert("We could not verify your room location. Please rescan your room QR code or contact the front desk.");
        return;
      }

      // Construct rich details
      // We want to avoid redundant info (Title already has service name).
      // Just store the user's note directly.
      let detailsParts = [];

      if (data.note.trim()) {
        detailsParts.push(data.note.trim());
      }

      const details = detailsParts.join(" ");

      // If location is public, we might want to clear the room_id so it's not misleading,
      // OR keep it to link to the guest's stay but rely on the text description.
      // For now, let's keep the room_id linked (so we know WHO asked), but the description clarifies WHERE.

      const payload = {
        // booking identity
        bookingCode: stayCode,
        booking_code: stayCode,
        code: stayCode,
        stayId: resolvedStayId, // [NEW] Link to Stay

        // service identity
        serviceId: selectedService.id, // [NEW] Required by backend
        serviceKey: selectedService.key,
        departmentId: selectedService.department_id,

        // location identity
        roomId: data.locationType === 'public' ? null : resolvedRoomId, // Clear room if public
        zoneId: data.locationType === 'public' ? data.zoneId : null,    // Set zone if public

        // friendly title/details
        title: selectedService.label_en,
        details: details,

        // property hints
        hotelId: effectiveHotelId,
        priority: data.priority, // [NEW] Pass structured priority

        source: "GUEST",
        created_by_id: null,
        media_urls: (data as any).media_urls || [] // [NEW] Pass attachments
      };
      console.log("[Menu] createTicket payload:", payload);
      const res = await (createTicket as any)(payload);
      console.log("[Menu] createTicket response:", res);

      setSelectedService(null); // Close modal

      // Use display_id if available, otherwise fallback (legacy)
      const ticketRef = (res as any)?.data || res; // Handle if wrapped in data object
      console.log("[Menu] ticketRef:", ticketRef);

      const friendlyId = ticketRef?.display_id;
      const uuid = ticketRef?.id;
      console.log("[Menu] resolved IDs:", { friendlyId, uuid });

      if (friendlyId) {
        navigate(`/track/${friendlyId}`);
      } else if (uuid) {
        navigate(`/track/${uuid}`);
      } else {
        console.warn("[Menu] No ID found in response, showing alert.");
        alert("Service request sent to the hotel team.");
      }
    } catch (e: any) {
      dbgError("[Menu] createTicket failed", e);
      alert(e?.message || "Could not create service request.");
    }
  }

  function addToCart(item: FoodItem) {
    setCart((c) => ({
      ...c,
      [item.item_key]: (c[item.item_key] || 0) + 1,
    }));
  }

  function removeFromCart(item: FoodItem) {
    setCart((c) => {
      const next = { ...c };
      const q = next[item.item_key] || 0;
      if (q <= 1) delete next[item.item_key];
      else next[item.item_key] = q - 1;
      return next;
    });
  }

  const cartItems = useMemo(() => {
    const map = new Map(foodState.items.map((i) => [i.item_key, i]));
    return Object.entries(cart)
      .map(([key, qty]) => ({ item: map.get(key), qty }))
      .filter((x) => !!x.item) as { item: FoodItem; qty: number }[];
  }, [cart, foodState.items]);

  const cartTotal = useMemo(() => {
    return cartItems.reduce((a, x) => a + x.item.base_price * x.qty, 0);
  }, [cartItems]);

  async function placeFoodOrder() {
    if (!cartItems.length) return;

    try {
      dbg(`[Menu] place order for ${stayCode}`, cartItems);

      const effectiveHotelId = resolvedHotelId || hotelId;

      const payload = {
        bookingCode: stayCode,
        booking_code: stayCode,
        code: stayCode,

        items: cartItems.map((x) => ({
          item_key: x.item.item_key,
          itemKey: x.item.item_key,
          qty: x.qty,
          quantity: x.qty,
          price: x.item.base_price,
        })),

        // property hints
        hotelId: effectiveHotelId,
        hotel_id: effectiveHotelId,
        propertyId: effectiveHotelId,
        property_id: effectiveHotelId,

        hotelSlug,
        hotel_slug: hotelSlug,
        propertySlug: hotelSlug,
        property_slug: hotelSlug,

        hotel: hotelSlug || effectiveHotelId,
        property: hotelSlug || effectiveHotelId,

        source: "guest",
        total: cartTotal,
      };

      await (createOrder as any)(payload);

      setCart({});
      alert("Order placed! The hotel team will confirm shortly.");
    } catch (e: any) {
      dbgError("[Menu] createOrder failed", e);
      alert(e?.message || "Could not place food order.");
    }
  }

  return (
    <main className="min-h-screen bg-[#0b1120] font-sans pb-20 text-slate-200 selection:bg-emerald-500/30">
      {/* Subtle background gradient mesh for premium feel */}
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900/40 via-[#0b1120] to-[#0b1120] z-0" />

      <div className="relative z-10 max-w-5xl mx-auto p-6">
        <div className="flex flex-wrap items-center justify-between gap-6 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 rounded-md bg-white/10 border border-white/5 text-[10px] uppercase tracking-wider font-bold text-zinc-400">
                {stayCode}
              </span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white mb-2">
              Room Service
            </h1>
            <p className="text-zinc-500 text-sm max-w-md">
              Experience dining and hospitality services delivered directly to your room.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link to={`/stay/${encodeURIComponent(stayCode)}`} className="px-4 py-2 rounded-full bg-slate-800/50 border border-slate-700/50 text-slate-400 text-sm font-medium hover:bg-slate-800 hover:text-white hover:border-slate-600 transition-all">
              Back to stay
            </Link>
            <Link to="/guest" className="px-4 py-2 rounded-full bg-slate-800/50 border border-slate-700/50 text-slate-400 text-sm font-medium hover:bg-slate-800 hover:text-white hover:border-slate-600 transition-all">
              Dashboard
            </Link>
          </div>
        </div>

        {/* Tabs */}
        <div className="sticky top-4 z-20 mb-8 inline-flex p-1.5 rounded-full border border-white/5 bg-slate-900/80 backdrop-blur-md shadow-2xl shadow-black/50">
          <button
            type="button"
            onClick={() => switchTab("services")}
            className={`px-6 py-2 rounded-full text-sm font-medium transition-all duration-300 ${tab === "services"
              ? "bg-emerald-600 text-white shadow-lg shadow-emerald-900/20"
              : "text-slate-400 hover:text-slate-200"
              }`}
          >
            Services
          </button>
          <button
            type="button"
            onClick={() => switchTab("food")}
            className={`px-6 py-2 rounded-full text-sm font-medium transition-all duration-300 ${tab === "food"
              ? "bg-emerald-600 text-white shadow-lg shadow-emerald-900/20"
              : "text-slate-400 hover:text-slate-200"
              }`}
          >
            Dining
          </button>
        </div>

        {/* Services tab */}
        {tab === "services" && (
          <section className="animate-fade-in-up">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-white">Concierge & Housekeeping</h2>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 rounded-full border border-green-500/20">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                <span className="text-[10px] font-bold text-green-500 uppercase tracking-wide">Live</span>
              </div>
            </div>

            {servicesState.loading ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="h-40 bg-zinc-900/50 rounded-2xl animate-pulse border border-white/5" />
                ))}
              </div>
            ) : servicesState.error ? (
              <div className="p-6 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-3">
                <AlertCircle size={20} />
                {servicesState.error}
              </div>
            ) : servicesState.items.length ? (
              <div className="space-y-12 animate-fade-in">
                {/* Department Filters */}
                <div className="flex gap-2 overflow-x-auto pb-4 no-scrollbar -mx-6 px-6 sm:mx-0 sm:px-0">
                  <button
                    onClick={() => setSelectedCategory("All")}
                    className={`flex-shrink-0 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${selectedCategory === "All"
                      ? "bg-slate-700 border-slate-600 text-white shadow-lg"
                      : "bg-slate-800/30 border-white/5 text-slate-500 hover:border-slate-700 hover:text-slate-400"
                      }`}
                  >
                    All
                  </button>
                  {Array.from(new Set(servicesState.items.map(s => s.department_name || "General"))).sort().map(dept => (
                    <button
                      key={dept}
                      onClick={() => setSelectedCategory(dept)}
                      className={`flex-shrink-0 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${selectedCategory === dept
                        ? "bg-slate-700 border-slate-600 text-white shadow-lg"
                        : "bg-slate-800/30 border-white/5 text-slate-500 hover:border-slate-700 hover:text-slate-400"
                        }`}
                    >
                      {dept}
                    </button>
                  ))}
                </div>

                {Object.entries(
                  servicesState.items.reduce((acc, s) => {
                    const d = s.department_name || "General";
                    if (!acc[d]) acc[d] = [];
                    acc[d].push(s);
                    return acc;
                  }, {} as Record<string, Service[]>)
                )
                  .filter(([deptName]) => selectedCategory === "All" || deptName === selectedCategory)
                  .map(([deptName, deptServices]) => (
                    <div key={deptName} className="animate-fade-in">
                      <div className="flex items-center gap-4 mb-6">
                        <h3 className="text-zinc-500 text-xs font-bold uppercase tracking-[0.2em]">
                          {deptName}
                        </h3>
                        <div className="h-px bg-zinc-800 flex-1"></div>
                      </div>

                      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                        {deptServices.map((s) => {
                          const icon = getServiceIcon(s.key);
                          return (
                            <button
                              key={s.key}
                              type="button"
                              onClick={() => requestService(s)}
                              className="group relative flex flex-col items-start p-6 rounded-3xl bg-slate-900/40 border border-slate-800/60 hover:border-emerald-500/30 hover:bg-slate-800/80 hover:shadow-2xl hover:shadow-emerald-900/10 transition-all duration-500 w-full text-left overflow-hidden min-h-[160px] h-full"
                            >
                              <div className="relative w-full h-full flex flex-col justify-between z-10">
                                <div className="flex items-start justify-between w-full mb-4">
                                  <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-2xl shadow-inner group-hover:scale-110 group-hover:bg-slate-950 group-hover:border-slate-700 transition-all duration-500">
                                    {icon}
                                  </div>
                                  <div className="px-2.5 py-1 rounded-full bg-slate-900/80 border border-slate-800 text-[10px] font-bold text-slate-500 group-hover:text-emerald-400 transition-colors">
                                    ~{s.sla_minutes}m
                                  </div>
                                </div>

                                <div className="mt-auto w-full">
                                  <div className="text-lg font-bold text-zinc-200 group-hover:text-white transition-colors mb-1 pr-4">
                                    {s.label_en}
                                  </div>

                                  {s.description_en && (
                                    <div className="text-xs text-zinc-500 leading-relaxed mb-4 line-clamp-2 max-w-[90%] group-hover:text-zinc-400 transition-colors">
                                      {s.description_en}
                                    </div>
                                  )}

                                  <div className="flex items-center gap-2 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300">
                                    <span className="text-xs font-bold text-white underline underline-offset-4 decoration-zinc-700">Request Service</span>
                                    <ArrowDownRight size={14} className="text-white" />
                                  </div>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="text-center py-24 rounded-3xl border border-dashed border-zinc-800 bg-zinc-900/20">
                <div className="text-5xl opacity-20 mb-4 grayscale">🛎️</div>
                <div className="text-sm text-zinc-500 font-medium">No services currently available.</div>
              </div>
            )}
          </section>
        )}

        {/* Food tab */}
        {tab === "food" && (
          <section className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-8 animate-fade-in-up">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-white">In-Room Dining</h2>
              </div>

              {foodState.loading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map(i => <div key={i} className="h-24 bg-zinc-900/50 rounded-2xl animate-pulse" />)}
                </div>
              ) : foodState.error ? (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  {foodState.error}
                </div>
              ) : (
                <div className="grid gap-3">
                  {foodState.items.map((item) => {
                    const inCart = cart[item.item_key] || 0;
                    return (
                      <div key={item.item_key} className="group flex items-center justify-between p-4 rounded-2xl bg-zinc-900/30 border border-white/5 hover:bg-zinc-900 hover:border-white/10 transition-all duration-300">
                        <div>
                          <div className="font-bold text-zinc-200 group-hover:text-white text-lg">{item.name}</div>
                          <div className="text-sm text-zinc-500 font-mono mt-1">₹{item.base_price}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          {inCart > 0 ? (
                            <div className="flex items-center gap-3 bg-black rounded-lg p-1 border border-zinc-800">
                              <button onClick={() => removeFromCart(item)} className="w-8 h-8 rounded-md hover:bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">-</button>
                              <span className="text-sm font-mono w-4 text-center text-white font-bold">{inCart}</span>
                              <button onClick={() => addToCart(item)} className="w-8 h-8 rounded-md bg-white text-black shadow-sm flex items-center justify-center hover:bg-zinc-200 transition-colors">+</button>
                            </div>
                          ) : (
                            <button onClick={() => addToCart(item)} className="px-5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-bold uppercase tracking-wider hover:bg-white hover:text-black hover:border-white text-zinc-400 transition-all">
                              Add
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Cart summary */}
            <div className="relative">
              <div className="sticky top-24 rounded-3xl bg-zinc-900 border border-zinc-800 shadow-2xl p-6">
                <div className="flex items-center justify-between mb-6 pb-6 border-b border-zinc-800">
                  <div className="text-lg font-bold text-white">Current Order</div>
                  <div className="px-3 py-1 rounded-full bg-black text-xs text-zinc-400 font-mono border border-zinc-800">
                    {cartCount} item{cartCount === 1 ? "" : "s"}
                  </div>
                </div>

                {!cartItems.length ? (
                  <div className="text-center py-12">
                    <div className="text-3xl opacity-20 mb-3 grayscale">🍽️</div>
                    <div className="text-xs text-zinc-600 font-medium">
                      Your cart is empty.
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-4 mb-6">
                      {cartItems.map(({ item, qty }) => (
                        <div
                          key={item.item_key}
                          className="flex items-center justify-between text-sm text-zinc-400"
                        >
                          <span className="truncate pr-4 flex-1">
                            <span className="text-white font-medium">{item.name}</span> <span className="text-zinc-600 text-xs">× {qty}</span>
                          </span>
                          <span className="font-mono text-zinc-300">
                            ₹ {(item.base_price * qty).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="pt-6 border-t border-zinc-800 space-y-4">
                      <div className="flex items-center justify-between text-base">
                        <span className="text-zinc-400">Total Amount</span>
                        <span className="font-bold text-white text-xl font-mono">
                          ₹ {cartTotal.toLocaleString()}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={placeFoodOrder}
                        className="w-full bg-white text-black font-bold py-4 rounded-xl hover:bg-zinc-200 active:scale-[0.98] transition-all shadow-xl shadow-white/5 text-sm uppercase tracking-wider"
                      >
                        Place Request
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>
        )}
        {/* Request Modal */}
        {selectedService && (
          <ServiceRequestModal
            service={selectedService}
            hotelId={resolvedHotelId || hotelId}
            onClose={() => setSelectedService(null)}
            onConfirm={confirmRequest}
          />
        )}
      </div>
    </main>
  );
}

type HotelZone = {
  id: string;
  name: string;
  zone_type: string;
  floor: number | null;
}

function ServiceRequestModal({
  service,
  hotelId,
  onClose,
  onConfirm
}: {
  service: Service,
  hotelId: string | null,
  onClose: () => void,
  onConfirm: (data: { note: string; priority: string; locationType: string; publicLocation: string; zoneId?: string }) => void
}) {
  const [note, setNote] = useState("");
  const [priority, setPriority] = useState("normal");
  const [locationType, setLocationType] = useState("room"); // 'room' | 'public'
  const [publicLocation, setPublicLocation] = useState(""); // For legacy or fallback text
  const [selectedZoneId, setSelectedZoneId] = useState(""); // For structured zone

  const [zones, setZones] = useState<HotelZone[]>([]);
  const [loadingZones, setLoadingZones] = useState(false);

  // Fetch zones on mount
  useEffect(() => {
    if (!hotelId) return;

    (async () => {
      setLoadingZones(true);
      const { supabase } = await import("../lib/supabase");

      const { data, error } = await supabase
        .from('hotel_zones')
        .select('id, name, zone_type, floor')
        .eq('hotel_id', hotelId)
        .eq('is_active', true)
        // Order by simple columns first to avoid complex ORDER BY syntax issues if index missing
        .order('zone_type', { ascending: true })
        .order('name', { ascending: true });

      if (data) {
        // Custom sort in JS to match precise grouping requirements (Postgres "Case When" via JS)
        const sorted = data.sort((a, b) => {
          const typeOrder: Record<string, number> = {
            'FACILITY': 1,
            'CORRIDOR': 2,
            'OUTDOOR': 3,
            'BACK_OF_HOUSE': 4,
            'HOTEL_WIDE': 5
          };
          const rankA = typeOrder[a.zone_type] || 6;
          const rankB = typeOrder[b.zone_type] || 6;

          if (rankA !== rankB) return rankA - rankB;
          if (a.floor !== b.floor) return (a.floor || 0) - (b.floor || 0);
          return a.name.localeCompare(b.name);
        });
        setZones(sorted);
      }
      setLoadingZones(false);
    })();
  }, [hotelId]);

  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      const s = supa();
      if (!s) throw new Error("Upload client not available");

      const newUrls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = file.name.split('.').pop();
        const path = `temp/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

        const { error } = await s.storage
          .from('ticket-attachments')
          .upload(path, file);

        if (error) throw error;

        const { data: { publicUrl } } = s.storage
          .from('ticket-attachments')
          .getPublicUrl(path);

        newUrls.push(publicUrl);
      }
      setMediaUrls(prev => [...prev, ...newUrls]);
    } catch (err: any) {
      console.error("Upload failed", err);
      alert("Failed to upload image: " + err.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleSubmit = async () => {
    if (service.requires_description && !note.trim()) {
      alert("Please describe what you need.");
      return;
    }

    // Force selection of zone if public
    if (locationType === 'public' && !selectedZoneId) {
      alert("Please select a valid area/zone.");
      return;
    }

    setSubmitting(true);

    // Find zone name to pass as friendly "publicLocation" text for description fallback
    const zoneName = zones.find(z => z.id === selectedZoneId)?.name || "";

    await onConfirm({
      note,
      priority,
      locationType,
      publicLocation: zoneName,
      zoneId: selectedZoneId,
      media_urls: mediaUrls
    } as any);
    setSubmitting(false);
  };

  // Helper to group zones for Select
  const groupedZones = useMemo(() => {
    const groups: Record<string, HotelZone[]> = {};
    zones.forEach(z => {
      const type = z.zone_type.replace(/_/g, ' ');
      if (!groups[type]) groups[type] = [];
      groups[type].push(z);
    });
    return groups;
  }, [zones]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div className="relative w-full max-w-sm bg-[#18181b] rounded-3xl shadow-2xl overflow-y-auto max-h-[90vh] animate-scale-up border border-white/10 text-white scrollbar-hide">

        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between bg-white/5 sticky top-0 z-10 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-600/20 flex items-center justify-center text-amber-500 border border-amber-500/30">
              <Bell size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Guest Request</h3>
              <p className="text-xs text-gray-400 font-medium flex items-center gap-1">
                {service.label_en} <span className="opacity-50">•</span> ~{service.sla_minutes} min
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-6">

          {/* 1. Description */}
          <div>
            <label className="block text-sm font-medium text-white mb-2">
              What do you need? {service.requires_description && <span className="text-red-500">*</span>}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Describe the issue or request in your own words&#10;Example: 'Water leaking near bathroom sink'"
              className="w-full h-32 p-4 rounded-xl bg-[#27272a] border border-white/10 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all resize-none placeholder-gray-500"
              autoFocus
            />
          </div>

          {/* 3. Location */}
          <div>
            <label className="block text-sm font-medium text-white mb-2">Location</label>
            <div className="flex bg-[#27272a] rounded-lg p-1 border border-white/5">
              <button
                onClick={() => setLocationType("room")}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${locationType === "room"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-gray-400 hover:text-white"
                  }`}
              >
                In Room
              </button>
              <button
                onClick={() => setLocationType("public")}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${locationType === "public"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-gray-400 hover:text-white"
                  }`}
              >
                Public Area
              </button>
            </div>

            {locationType === "public" && (
              <div className="mt-3 animate-fade-in-down">
                <label className="text-xs text-gray-400 mb-1.5 block">Select Area <span className="text-red-500">*</span></label>

                {loadingZones ? (
                  <div className="w-full bg-[#27272a] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-gray-500">
                    Loading areas...
                  </div>
                ) : (
                  <CustomZoneSelect
                    value={selectedZoneId}
                    onChange={setSelectedZoneId}
                    groupedZones={groupedZones}
                  />
                )}

                <p className="text-[10px] text-gray-500 mt-2">
                  Staff will be dispatched to this specific zone.
                </p>
              </div>
            )}
          </div>

          {/* 4. Priority */}
          <div>
            <label className="block text-sm font-medium text-white mb-2">Priority</label>
            <div className="flex gap-3">
              {[
                { id: 'low', label: 'Low', color: 'bg-green-500' },
                { id: 'normal', label: 'Normal', color: 'bg-blue-500' },
                { id: 'high', label: 'High', color: 'bg-red-500' }
              ].map((p) => (
                <label
                  key={p.id}
                  className={`flex-1 cursor-pointer rounded-xl px-2 py-3 flex items-center justify-center gap-2 transition-all border ${priority === p.id
                    ? "bg-[#27272a] border-white/20"
                    : "bg-transparent border-white/10 text-gray-500 hover:bg-[#27272a]"
                    }`}
                >
                  <input
                    type="radio"
                    name="priority"
                    value={p.id}
                    checked={priority === p.id}
                    onChange={() => setPriority(p.id)}
                    className="hidden"
                  />
                  <span className={`w-2.5 h-2.5 rounded-full ${p.color} ${priority === p.id ? 'ring-2 ring-offset-2 ring-offset-[#18181b] ring-current' : 'opacity-50'}`} />
                  <span className={`text-sm font-medium ${priority === p.id ? 'text-white' : ''}`}>{p.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 5. Attachments */}
          <div>
            <label className="block text-sm font-medium text-white mb-2">Attachments</label>
            <div className="flex flex-wrap gap-2">
              <input
                type="file"
                id="file-upload"
                multiple
                accept="image/*,video/*"
                className="hidden"
                onChange={handleUpload}
              />
              <label
                htmlFor="file-upload"
                className={`flex items-center gap-2 px-4 py-3 rounded-xl border border-white/10 bg-[#27272a] text-gray-300 hover:text-white hover:bg-[#3f3f46] transition-colors text-sm font-medium cursor-pointer w-full justify-center ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
              >
                <Camera size={16} />
                <span>{uploading ? 'Uploading...' : 'Attach Photo/Video'}</span>
              </label>

              {mediaUrls.length > 0 && (
                <div className="grid grid-cols-4 gap-2 w-full mt-2">
                  {mediaUrls.map((url, i) => (
                    <div key={i} className="relative group aspect-square rounded-lg overflow-hidden border border-white/10 bg-black">
                      <img src={url} alt="Attachment" className="w-full h-full object-cover" />
                      <button
                        onClick={() => setMediaUrls(m => m.filter((_, idx) => idx !== i))}
                        className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-2">Helps us resolve faster</p>
          </div>

        </div>

        {/* Footer */}
        <div className="p-5 pt-2 bg-[#18181b] sticky bottom-0 z-10 border-t border-white/5">
          <button
            onClick={handleSubmit}
            disabled={
              submitting ||
              (locationType === 'public' && !selectedZoneId) ||
              (service.requires_description && !note.trim())
            }
            className={`w-full py-3.5 rounded-xl font-bold text-sm shadow-lg flex items-center justify-center gap-2 transition-all 
               ${submitting || (locationType === 'public' && !selectedZoneId) || (service.requires_description && !note.trim())
                ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                : 'bg-[#3b82f6] hover:bg-blue-600 text-white hover:shadow-blue-900/20 active:transform active:scale-[0.98]'}`
            }
          >
            {submitting ? (
              <span>Sending...</span>
            ) : (
              <span>Submit Request</span>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
