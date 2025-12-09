import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, useNavigate, Link } from "react-router-dom";
import {
  getServices,
  getMenu,
  createTicket,
  createOrder,
  isDemo,
} from "../lib/api";
import { dbg, dbgError } from "../lib/debug";

type Service = { key: string; label_en: string; sla_minutes: number };
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

  // Ensure URL always has core identity hints (helps downstream too)
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
    if (hotelId && !next.get("hotelId")) {
      next.set("hotelId", hotelId);
      changed = true;
    }
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
  }, [stayCode, hotelId, hotelSlug, tab]);

  // Load services
  useEffect(() => {
    let alive = true;

    (async () => {
      setServicesState({ loading: true, error: null, items: [] });

      try {
        if (isDemo()) {
          const demo: Service[] = [
            { key: "housekeeping", label_en: "Housekeeping", sla_minutes: 20 },
            { key: "linen", label_en: "Fresh linen", sla_minutes: 30 },
            { key: "maintenance", label_en: "Maintenance", sla_minutes: 45 },
          ];
          if (alive) setServicesState({ loading: false, error: null, items: demo });
          return;
        }

        // We don't assume signature; call with one arg only.
        const items = (await (getServices as any)(stayCode)) as Service[];
        if (!alive) return;

        setServicesState({
          loading: false,
          error: null,
          items: Array.isArray(items) ? items : [],
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
  }, [stayCode]);

  // Load food
  useEffect(() => {
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

        const items = (await (getMenu as any)(stayCode)) as FoodItem[];
        if (!alive) return;

        setFoodState({
          loading: false,
          error: null,
          items: Array.isArray(items) ? items : [],
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
  }, [stayCode]);

  function switchTab(next: "services" | "food") {
    setTab(next);
    const nextQP = new URLSearchParams(searchParams);
    nextQP.set("tab", next);
    navigate({ search: nextQP.toString() }, { replace: true });
  }

  async function requestService(svc: Service) {
    try {
      dbg("[Menu] request service", svc.key, stayCode);

      const payload = {
        // booking identity
        bookingCode: stayCode,
        booking_code: stayCode,
        code: stayCode,

        // service identity
        serviceKey: svc.key,
        service_key: svc.key,
        key: svc.key,

        // friendly title/details
        title: svc.label_en,
        details: `Guest requested: ${svc.label_en}`,

        // property hints
        hotelId,
        hotel_id: hotelId,
        propertyId: hotelId,
        hotelSlug,
        hotel_slug: hotelSlug,
        propertySlug: hotelSlug,

        source: "guest",
      };

      await (createTicket as any)(payload);

      alert("Service request sent to the hotel team.");
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
      dbg("[Menu] place order", stayCode, cartItems);

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
        hotelId,
        hotel_id: hotelId,
        propertyId: hotelId,
        hotelSlug,
        hotel_slug: hotelSlug,
        propertySlug: hotelSlug,

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
    <main className="max-w-5xl mx-auto p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs text-gray-500">
            Stay code{" "}
            <code className="px-1 py-0.5 rounded bg-gray-100">{stayCode}</code>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Room services &amp; menu
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Request services or order food for this stay.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link to={`/stay/${encodeURIComponent(stayCode)}`} className="btn btn-light">
            Back to stay
          </Link>
          <Link to="/guest" className="btn btn-light">
            Dashboard
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-4 inline-flex rounded-full border bg-white shadow-sm p-1 text-xs">
        <button
          type="button"
          onClick={() => switchTab("services")}
          className={`px-4 py-1.5 rounded-full ${
            tab === "services" ? "bg-slate-900 text-white" : "text-slate-600"
          }`}
        >
          Services
        </button>
        <button
          type="button"
          onClick={() => switchTab("food")}
          className={`px-4 py-1.5 rounded-full ${
            tab === "food" ? "bg-slate-900 text-white" : "text-slate-600"
          }`}
        >
          Food
        </button>
      </div>

      {/* Services tab */}
      {tab === "services" && (
        <section className="mt-5 rounded-2xl border bg-white/90 shadow-sm p-4">
          <div className="text-sm font-semibold">Hotel services</div>
          <div className="text-xs text-gray-500 mt-1">
            Tap a service to create a ticket with SLA-aware tracking.
          </div>

          {servicesState.loading ? (
            <div className="mt-3 space-y-2">
              <div className="h-3 bg-gray-100 rounded animate-pulse" />
              <div className="h-3 bg-gray-100 rounded animate-pulse" />
              <div className="h-3 bg-gray-100 rounded animate-pulse" />
            </div>
          ) : servicesState.error ? (
            <div className="mt-3 text-sm text-amber-700">
              {servicesState.error}
            </div>
          ) : servicesState.items.length ? (
            <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {servicesState.items.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => requestService(s)}
                  className="rounded-xl border bg-slate-50 hover:bg-slate-100 transition p-4 text-left"
                >
                  <div className="text-xs text-gray-500">
                    SLA ~ {s.sla_minutes} mins
                  </div>
                  <div className="text-sm font-semibold mt-0.5">
                    {s.label_en}
                  </div>
                  <div className="mt-2 text-[11px] text-teal-700 font-medium">
                    Request now →
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-3 text-sm text-gray-600">
              No services available for this property yet.
            </div>
          )}
        </section>
      )}

      {/* Food tab */}
      {tab === "food" && (
        <section className="mt-5 grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
          <div className="rounded-2xl border bg-white/90 shadow-sm p-4">
            <div className="text-sm font-semibold">In-room dining</div>
            <div className="text-xs text-gray-500 mt-1">
              Add items to your cart and place an order.
            </div>

            {foodState.loading ? (
              <div className="mt-3 space-y-2">
                <div className="h-3 bg-gray-100 rounded animate-pulse" />
                <div className="h-3 bg-gray-100 rounded animate-pulse" />
                <div className="h-3 bg-gray-100 rounded animate-pulse" />
              </div>
            ) : foodState.error ? (
              <div className="mt-3 text-sm text-amber-700">{foodState.error}</div>
            ) : foodState.items.length ? (
              <div className="mt-3 grid sm:grid-cols-2 gap-3">
                {foodState.items.map((it) => {
                  const qty = cart[it.item_key] || 0;
                  return (
                    <div
                      key={it.item_key}
                      className="rounded-xl border bg-slate-50 p-3"
                    >
                      <div className="text-sm font-semibold">{it.name}</div>
                      <div className="text-xs text-gray-500">
                        ₹ {Number(it.base_price || 0).toLocaleString()}
                      </div>

                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => removeFromCart(it)}
                          className="btn btn-light"
                          disabled={!qty}
                        >
                          -
                        </button>
                        <div className="text-xs w-6 text-center">{qty}</div>
                        <button
                          type="button"
                          onClick={() => addToCart(it)}
                          className="btn"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3 text-sm text-gray-600">
                No menu items available for this property yet.
              </div>
            )}
          </div>

          {/* Cart summary */}
          <div className="rounded-2xl border bg-white/90 shadow-sm p-4 h-fit">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Your cart</div>
              <div className="text-xs text-gray-500">
                {cartCount} item{cartCount === 1 ? "" : "s"}
              </div>
            </div>

            {!cartItems.length ? (
              <div className="mt-3 text-xs text-gray-600">
                Add items to place an order.
              </div>
            ) : (
              <>
                <div className="mt-3 space-y-2">
                  {cartItems.map(({ item, qty }) => (
                    <div
                      key={item.item_key}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="truncate">
                        {item.name} × {qty}
                      </span>
                      <span className="font-medium">
                        ₹ {(item.base_price * qty).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 border-t pt-3 flex items-center justify-between text-sm">
                  <span className="text-gray-600">Total</span>
                  <span className="font-semibold">
                    ₹ {cartTotal.toLocaleString()}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={placeFoodOrder}
                  className="mt-3 btn w-full"
                >
                  Place order
                </button>
              </>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
