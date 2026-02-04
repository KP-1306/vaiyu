// web/src/routes/FoodMenu.tsx

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, useNavigate, Link } from "react-router-dom";
import {
  getServices,
  getMenu,
  createTicket,
  createFoodOrder, // Using the specific one from "Good Food" version
  isDemo,
  type Service,
  supa,
} from "../lib/api";
import { dbg, dbgError } from "../lib/debug";
import {
  Search, ShoppingBag, Plus, Minus, X, Info, Filter, Clock, AlertCircle, ArrowDownRight,
  Leaf, Utensils, Coffee, Sun, Moon, Wine, CupSoda, Percent, Cake, IceCream, Pizza, Sandwich, Soup,
  Bell, Camera, Wrench, Receipt
} from "lucide-react";
import { CustomZoneSelect } from "../components/CustomZoneSelect";

// --- Icons & Helpers ---

function getCategoryIcon(name: string) {
  const n = name.toLowerCase();
  if (n.includes("breakfast") || n.includes("morning")) return Coffee;
  if (n.includes("lunch") || n.includes("noon")) return Sun;
  if (n.includes("dinner") || n.includes("evening")) return Moon;
  if (n.includes("drink") || n.includes("beverage") || n.includes("cocktail") || n.includes("wine")) return Wine;
  if (n.includes("snack") || n.includes("start")) return Pizza;
  if (n.includes("dessert") || n.includes("sweet") || n.includes("cake")) return Cake;
  if (n.includes("kid") || n.includes("child")) return IceCream;
  if (n.includes("soup") || n.includes("salad")) return Soup;
  if (n.includes("sand")) return Sandwich;
  if (n.includes("deal") || n.includes("offer")) return Percent;
  return Utensils;
}

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

type FoodItem = {
  id: string;
  item_key: string;
  name: string;
  base_price: number;
  category_id?: string;
  category?: string;
  is_veg?: boolean;
  metadata?: {
    veg?: boolean;
    jain?: boolean;
    vegan?: boolean;
    spice_level?: 'Mild' | 'Medium' | 'Hot';
    image_url?: string;
    description?: string;
  };
  availability?: {
    days?: number[];
    start_time?: string;
    end_time?: string;
    hide_outside?: boolean;
  };
  active?: boolean;
};

type MenuCategory = {
  id: string;
  name: string;
  display_order?: number;
};

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

export default function FoodMenu() {
  const { code: routeCode = "DEMO" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const qpTab = (searchParams.get("tab") || "").toLowerCase();
  const initialTab: "food" | "services" =
    qpTab === "food" ? "food" : "services";
  const [tab, setTab] = useState<"food" | "services">(initialTab);

  // Sync tab with URL
  useEffect(() => {
    const next = (searchParams.get("tab") || "").toLowerCase();
    const nextTab: "food" | "services" = next === "food" ? "food" : "services";
    setTab(nextTab);
  }, [searchParams.toString()]);

  // --- Identity Resolution ---
  const stayCode = useMemo(() => {
    const qpCode = pickFirst(
      searchParams.get("bookingCode"),
      searchParams.get("code"),
    );
    return pickFirst(qpCode, routeCode, "DEMO");
  }, [searchParams, routeCode]);

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

  const [resolvedHotelId, setResolvedHotelId] = useState<string | null>(null);
  const [resolvedStayId, setResolvedStayId] = useState<string | null>(null);
  const [resolvedRoomId, setResolvedRoomId] = useState<string | null>(null);
  const [resolvedZoneId, setResolvedZoneId] = useState<string | null>(null);
  const [stayLookupDone, setStayLookupDone] = useState(false);

  // Resolving IDs for fetches
  const propertyKey = useMemo(
    () => pickFirst(resolvedHotelId, hotelId, hotelSlug),
    [resolvedHotelId, hotelId, hotelSlug],
  );

  // --- Data State ---
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

  const [categories, setCategories] = useState<MenuCategory[]>([]);

  // --- Filter State (Food) ---
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [filters, setFilters] = useState({
    veg: false,
    nonVeg: false,
    jain: false,
    vegan: false,
  });

  // --- Filter State (Services) ---
  const [serviceCategory, setServiceCategory] = useState("All");
  const [selectedService, setSelectedService] = useState<Service | null>(null); // For Modal

  // --- Cart State ---
  const [cart, setCart] = useState<Record<string, number>>({});
  const cartCount = useMemo(
    () => Object.values(cart).reduce((a, b) => a + b, 0),
    [cart],
  );
  const [specialInstructions, setSpecialInstructions] = useState("");

  // --- Resolve Stay ---
  useEffect(() => {
    let alive = true;
    (async () => {
      // If we have a stay code, try resolution
      if (stayCode && stayCode !== "DEMO") {
        try {
          const { supabase } = await import("../lib/supabase");
          const { data, error } = await supabase
            .rpc("resolve_stay_by_code", { p_code: stayCode })
            .maybeSingle();

          if (!alive) return;

          if (data) {
            const d = data as any;
            if (d.stay_id) setResolvedStayId(d.stay_id);
            if (d.hotel_id) setResolvedHotelId(d.hotel_id);
            if (d.room_id) setResolvedRoomId(d.room_id);
            if (d.zone_id) setResolvedZoneId(d.zone_id);
            // Save stay code to session for tracking pages
            try { sessionStorage.setItem('vaiyu:stay_code', stayCode); } catch { }
          } else if (error) {
            dbgError("[Menu] Stay lookup RPC error:", error);
          }
        } catch (e: any) {
          dbgError("[Menu] Failed to resolve stay:", e);
        }
      } else if (hotelId && alive) {
        setResolvedHotelId(hotelId);
      }
      if (alive) setStayLookupDone(true);
    })();
    return () => { alive = false; };
  }, [stayCode, hotelId]);


  // --- Data Fetching ---
  useEffect(() => {
    if (!stayLookupDone) return;
    let alive = true;

    const fetchData = async () => {
      // 1. Services
      try {
        if (isDemo()) {
          const demo: Service[] = [
            { key: "housekeeping", label_en: "Housekeeping", sla_minutes: 20, department_id: "0000", department_name: "Housekeeping" },
            { key: "linen", label_en: "Fresh linen", sla_minutes: 30, department_id: "0000", department_name: "Housekeeping" },
            { key: "maintenance", label_en: "Maintenance", sla_minutes: 45, department_id: "1111", department_name: "Maintenance" },
          ];
          if (alive) setServicesState({ loading: false, error: null, items: demo });
        } else {
          const ctx = { stayCode, hotelId, hotelSlug, propertyKey };
          // Use propertyKey (hotel_id) primarily
          const items = await (getServices as any)(propertyKey, ctx);
          const list = Array.isArray(items) ? items : (items?.items || []);
          if (alive) setServicesState({ loading: false, error: null, items: list });
        }
      } catch (e: any) {
        if (alive) setServicesState({ loading: false, error: e.message, items: [] });
      }

      // 2. Food & Categories
      try {
        setFoodState(s => ({ ...s, loading: true }));
        if (isDemo()) {
          const demo: FoodItem[] = [
            { id: '1', item_key: "tea", name: "Masala Tea", base_price: 80, metadata: { veg: true } },
            { id: '2', item_key: "sandwich", name: "Grilled Sandwich", base_price: 160, metadata: { veg: true } },
            { id: '3', item_key: "thali", name: "Veg Thali", base_price: 280, metadata: { veg: true, jain: true } },
          ];
          if (alive) setFoodState({ loading: false, error: null, items: demo });
        } else {
          // Fetch Menu
          const menuRes = await (getMenu as any)(propertyKey);
          const menuItems = Array.isArray(menuRes) ? menuRes : (menuRes?.items || []);

          // Fetch Categories custom
          let fetchedCats: MenuCategory[] = [];
          if (resolvedHotelId || hotelId) {
            const { supabase } = await import("../lib/supabase");
            const { data: catData } = await supabase
              .from('menu_categories')
              .select('id, name, display_order')
              .eq('hotel_id', resolvedHotelId || hotelId)
              .eq('active', true)
              .order('display_order');
            if (catData) fetchedCats = catData;
          }

          if (alive) {
            setFoodState({ loading: false, error: null, items: menuItems });
            setCategories(fetchedCats.length ? fetchedCats : []);
          }
        }
      } catch (e: any) {
        if (alive) setFoodState({ loading: false, error: e.message, items: [] });
      }
    };

    fetchData();
    return () => { alive = false; };
  }, [stayLookupDone, propertyKey, stayCode, hotelId, hotelSlug, resolvedHotelId]);


  // --- Filtering (Food) ---
  const filteredFood = useMemo(() => {
    return foodState.items.filter(item => {
      // 1. Search
      if (searchQuery && !item.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      // 2. Category
      if (selectedCategory !== "All") {
        if (categories.length > 0) {
          if (item.category_id !== selectedCategory) return false;
        } else {
          if (item.category !== selectedCategory) return false;
        }
      }
      // 3. Dietary
      const meta = item.metadata || {};
      const isItemVeg = item.is_veg || meta.veg;
      if (filters.veg && !isItemVeg) return false;
      if (filters.nonVeg && isItemVeg) return false;
      if (filters.jain && !meta.jain) return false;
      if (filters.vegan && !meta.vegan) return false;

      return true;
    });
  }, [foodState.items, searchQuery, selectedCategory, filters, categories]);

  // Unique categories if DB categories fail
  const displayCategories = useMemo(() => {
    if (categories.length > 0) return categories;
    const names = Array.from(new Set(foodState.items.map(i => i.category || "General").filter(Boolean)));
    return names.sort().map(name => ({ id: name, name }));
  }, [categories, foodState.items]);

  // --- Cart Actions (Food) ---
  const addToCart = (item: FoodItem) => {
    setCart(prev => ({ ...prev, [item.item_key]: (prev[item.item_key] || 0) + 1 }));
  };

  const removeFromCart = (item: FoodItem) => {
    setCart(prev => {
      const next = { ...prev };
      if (next[item.item_key] > 1) next[item.item_key]--;
      else delete next[item.item_key];
      return next;
    });
  };

  const cartItems = useMemo(() => {
    const map = new Map(foodState.items.map(i => [i.item_key, i]));
    return Object.entries(cart)
      .map(([key, qty]) => ({ item: map.get(key)!, qty }))
      .filter(x => !!x.item);
  }, [cart, foodState.items]);

  const cartTotal = cartItems.reduce((sum, { item, qty }) => sum + (item.base_price * qty), 0);

  const placeOrder = async () => {
    if (!cartItems.length) return;
    if (!resolvedStayId || !resolvedRoomId) {
      alert("Stay context missing. Please ensure you scanned a valid QR code.");
      return;
    }

    try {
      const payload = {
        hotelId: resolvedHotelId || hotelId || "",
        stayId: resolvedStayId,
        roomId: resolvedRoomId,
        items: cartItems.map(x => ({
          menu_item_id: x.item.id,
          name: x.item.name,
          qty: x.qty,
          unit_price: x.item.base_price,
          modifiers: {}
        })),
        special_instructions: specialInstructions || null
      };

      const res = await createFoodOrder(payload);

      setCart({});
      setSpecialInstructions("");

      // Redirect to tracker
      // The new RPC returns { id: UUID, display_id: "ORD-XXX" }
      const resObj = (typeof res === 'object' ? res : null);
      const displayId = resObj?.display_id;
      const uuid = resObj?.id || (typeof res === 'string' ? res : null);

      const targetId = displayId || uuid;

      if (targetId) {
        navigate(`/track-order/${targetId}`);
      } else {
        alert("Request placed successfully! Kitchen will review shortly.");
      }
    } catch (e: any) {
      alert("Failed to place order: " + e.message);
    }
  };

  // --- Service Actions (Modal) ---
  function requestService(svc: Service) {
    setSelectedService(svc);
  }

  async function confirmServiceRequest(data: { note: string; priority: string; locationType: string; publicLocation: string; zoneId?: string; media_urls?: string[] }) {
    if (!selectedService) return;
    try {
      const effectiveHotelId = resolvedHotelId || hotelId;
      if (!resolvedRoomId && !resolvedZoneId) {
        alert("We could not verify your room location. Please rescan your room QR code.");
        return;
      }

      let detailsParts = [];
      if (data.note.trim()) detailsParts.push(data.note.trim());
      const details = detailsParts.join(" ");

      const payload = {
        bookingCode: stayCode,
        booking_code: stayCode, // Back-compat
        code: stayCode,
        stayId: resolvedStayId,

        serviceId: selectedService.id,
        serviceKey: selectedService.key,
        departmentId: selectedService.department_id,

        roomId: data.locationType === 'public' ? null : resolvedRoomId,
        zoneId: data.locationType === 'public' ? data.zoneId : null,

        title: selectedService.label_en,
        details: details,
        hotelId: effectiveHotelId,
        priority: data.priority,
        source: "GUEST",
        created_by_id: null,
        media_urls: data.media_urls || []
      };

      const res = await (createTicket as any)(payload);

      setSelectedService(null); // Close modal

      const ticketRef = (res as any)?.data || res;
      const friendlyId = ticketRef?.display_id;
      const uuid = ticketRef?.id;

      if (friendlyId) navigate(`/track/${friendlyId}`);
      else if (uuid) navigate(`/track/${uuid}`);
      else alert("Service request sent!");

    } catch (e: any) {
      alert(e?.message || "Could not create service request.");
    }
  }


  // --- RENDER ---
  return (
    <div className="min-h-screen bg-[#0f111a] text-slate-200 font-sans selection:bg-indigo-500/30 pb-20">
      {/* Background Mesh (Retaining the look user liked) */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-900/20 rounded-full blur-[128px]" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-indigo-900/10 rounded-full blur-[128px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
          <div>
            {/* Breadcrumb */}
            <nav className="flex items-center gap-2 text-sm mb-3">
              <Link to={`/stay/${encodeURIComponent(stayCode)}`} className="text-slate-400 hover:text-white transition-colors">Stay</Link>
              <span className="text-slate-600">›</span>
              <span className="text-indigo-400 font-medium">Room Service</span>
            </nav>
            <div className="flex items-center gap-3 mb-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-white/5 border border-white/5 text-slate-400">
                {stayCode}
              </span>
              {resolvedRoomId && <span className="text-xs text-indigo-400 font-medium">Room Verified</span>}
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">Room Service</h1>
            <p className="text-slate-500 mt-1 max-w-md">Experience exceptional dining and hospitality, delivered directly to your room.</p>
          </div>

          <div className="flex gap-3">
            <Link to={`/stay/${encodeURIComponent(stayCode)}/orders`} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800/50 hover:bg-slate-800 text-sm font-medium transition-colors border border-white/5">
              <Receipt size={16} />
              My Orders
            </Link>
            <Link to={`/stay/${encodeURIComponent(stayCode)}`} className="px-4 py-2 rounded-lg bg-slate-800/50 hover:bg-slate-800 text-sm font-medium transition-colors border border-white/5">
              Back to Stay
            </Link>
            <Link to="/guest" className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors shadow-lg shadow-indigo-500/20">
              Dashboard
            </Link>
          </div>
        </header>

        {/* Tabs */}
        <div className="flex items-center gap-8 border-b border-white/10 mb-8">
          <button
            onClick={() => setTab("food")}
            className={`pb-4 text-sm font-medium transition-all relative ${tab === 'food' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
          >
            In-Room Dining
            {tab === 'food' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-t-full" />}
          </button>
          <button
            onClick={() => setTab("services")}
            className={`pb-4 text-sm font-medium transition-all relative ${tab === 'services' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Services & Amenities
            {tab === 'services' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-t-full" />}
          </button>
        </div>


        {/* Content: FOOD (Original Layout) */}
        {tab === "food" && (
          <div className="grid lg:grid-cols-[1fr_380px] gap-8 items-start animate-fade-in-up">

            {/* Left: Menu Grid */}
            <div className="space-y-6">

              {/* Controls: Search & Filters */}
              <div className="bg-[#161b2c] border border-white/5 rounded-2xl p-4 space-y-4">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search menu items..."
                    className="w-full bg-[#0b0e14] border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-500/50 transition-colors"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                </div>

                {/* Dietary Toggles */}
                <div className="flex flex-wrap gap-3">
                  <FilterButton active={filters.veg} onClick={() => setFilters(f => ({ ...f, veg: !f.veg }))} color="text-green-400" border="border-green-500/30" bg="bg-green-500/10">Veg</FilterButton>
                  <FilterButton active={filters.nonVeg} onClick={() => setFilters(f => ({ ...f, nonVeg: !f.nonVeg }))} color="text-red-400" border="border-red-500/30" bg="bg-red-500/10">Non-Veg</FilterButton>
                  <FilterButton active={filters.jain} onClick={() => setFilters(f => ({ ...f, jain: !f.jain }))} color="text-amber-400" border="border-amber-500/30" bg="bg-amber-500/10">Jain</FilterButton>
                  <FilterButton active={filters.vegan} onClick={() => setFilters(f => ({ ...f, vegan: !f.vegan }))} color="text-emerald-400" border="border-emerald-500/30" bg="bg-emerald-500/10">Vegan</FilterButton>
                </div>

                {/* Categories */}
                <div className="pt-2">
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setSelectedCategory("All")}
                      className={`group flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${selectedCategory === "All"
                        ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                        : 'bg-[#1a2035] border-white/5 text-slate-400 hover:text-white hover:bg-[#232942] hover:border-white/10'
                        }`}
                    >
                      <Utensils size={14} className={selectedCategory === "All" ? "text-white" : "text-slate-500 group-hover:text-white transition-colors"} />
                      All Items
                    </button>

                    {displayCategories.map(cat => {
                      const Icon = getCategoryIcon(cat.name);
                      const isActive = selectedCategory === cat.id;
                      return (
                        <button
                          key={cat.id}
                          onClick={() => setSelectedCategory(cat.id)}
                          className={`group flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${isActive
                            ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                            : 'bg-[#1a2035] border-white/5 text-slate-400 hover:text-white hover:bg-[#232942] hover:border-white/10'
                            }`}
                        >
                          <Icon size={14} className={isActive ? "text-white" : "text-slate-500 group-hover:text-white transition-colors"} />
                          {cat.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Items Grid */}
              <div className="grid sm:grid-cols-2 gap-4">
                {filteredFood.map(item => {
                  const inCart = cart[item.item_key] || 0;
                  const meta = item.metadata || {};
                  const isVeg = item.is_veg || meta.veg;

                  return (
                    <div key={item.item_key} className="group bg-[#161b2c] border border-white/5 rounded-2xl p-4 flex gap-4 transition-all hover:border-white/10 hover:shadow-xl hover:shadow-black/20">
                      {/* Image Thumbnail */}
                      <div className="w-24 h-24 flex-shrink-0 rounded-xl bg-[#0b0e14] border border-white/5 overflow-hidden relative">
                        {meta.image_url ? (
                          <img src={meta.image_url} alt={item.name} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-700">
                            <Utensils key="u-icon" size={20} />
                          </div>
                        )}
                      </div>

                      <div className="flex-1 flex flex-col">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <div className={`w-3 h-3 rounded-sm border ${isVeg ? 'border-green-500' : 'border-red-500'} flex items-center justify-center`}>
                                <div className={`w-1.5 h-1.5 rounded-full ${isVeg ? 'bg-green-500' : 'bg-red-500'}`} />
                              </div>
                              {meta.jain && <span className="text-[10px] bg-amber-500/10 text-amber-500 px-1.5 rounded border border-amber-500/20">Jain</span>}
                              {meta.vegan && <span className="text-[10px] bg-emerald-500/10 text-emerald-500 px-1.5 rounded border border-emerald-500/20">Vegan</span>}
                            </div>
                            <h3 className="font-semibold text-white leading-tight mb-1">{item.name}</h3>
                            <div className="text-indigo-300 font-mono text-sm font-bold">₹{item.base_price || 0}</div>
                          </div>
                        </div>

                        <div className="mt-auto pt-4 flex justify-end">
                          {inCart > 0 ? (
                            <div className="flex items-center bg-[#0b0e14] rounded-lg border border-white/10 p-1 shadow-sm">
                              <button onClick={() => removeFromCart(item)} className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-white transition-colors">-</button>
                              <span className="w-6 text-center text-sm font-bold text-white">{inCart}</span>
                              <button onClick={() => addToCart(item)} className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-white transition-colors">+</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => addToCart(item)}
                              className="px-4 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-bold uppercase tracking-wider text-slate-300 hover:bg-white/10 hover:text-white transition-all shadow-sm"
                            >
                              Add
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {filteredFood.length === 0 && (
                  <div className="col-span-full py-12 text-center text-slate-500">
                    No items found matching your filters.
                  </div>
                )}
              </div>
            </div>

            {/* Right: Cart Sidebar (Sticky) */}
            <div className="lg:sticky lg:top-8">
              <div className="bg-[#161b2c] border border-white/5 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-6rem)]">
                <div className="p-5 border-b border-white/5 bg-[#1a2035] flex items-center justify-between sticky top-0 z-10">
                  <div className="flex items-center gap-2">
                    <ShoppingBag size={18} className="text-indigo-400" />
                    <h3 className="font-bold text-white">Current Order</h3>
                  </div>
                  <span className="bg-[#0b0e14] text-slate-400 text-xs font-mono px-2 py-1 rounded border border-white/5">
                    {cartCount} Items
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[200px]">
                  {cartItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-slate-600">
                      <ShoppingBag size={32} className="opacity-20 mb-2" />
                      <div className="text-sm">Your cart is empty</div>
                    </div>
                  ) : (
                    cartItems.map(({ item, qty }) => (
                      <div key={item.item_key} className="flex items-start justify-between group">
                        <div className="flex-1 pr-4">
                          <div className="text-sm font-medium text-slate-200">{item.name}</div>
                          <div className="text-xs text-slate-500 mt-1">₹{item.base_price} x {qty}</div>
                        </div>
                        <div className="flex items-center gap-2 bg-[#0b0e14] rounded px-1 border border-white/5">
                          <button onClick={() => removeFromCart(item)} className="p-1 text-slate-500 hover:text-red-400"><Minus size={12} /></button>
                          <span className="text-xs font-mono w-3 text-center">{qty}</span>
                          <button onClick={() => addToCart(item)} className="p-1 text-slate-500 hover:text-green-400"><Plus size={12} /></button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="p-5 border-t border-white/5 bg-[#0b0e14]">
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-slate-400 text-sm">Total Amount</span>
                    <span className="text-xl font-bold text-white font-mono">₹{cartTotal}</span>
                  </div>

                  {/* Special Instructions Input */}
                  <div className="mb-4">
                    <label className="block text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">
                      Special Instructions (Optional)
                    </label>
                    <textarea
                      value={specialInstructions}
                      onChange={(e) => setSpecialInstructions(e.target.value)}
                      placeholder="e.g. Less spicy, no onions, deliver after 9 PM..."
                      className="w-full bg-[#161b2c] border border-white/10 rounded-lg p-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 resize-none h-20"
                    />
                  </div>
                  <button
                    onClick={placeOrder}
                    disabled={cartItems.length === 0}
                    className="w-full py-3 bg-white text-black font-bold rounded-xl hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-white/10"
                  >
                    PLACE REQUEST
                  </button>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* Content: SERVICES (Enhanced with Modal) */}
        {tab === "services" && (
          <div className="animate-fade-in-up">

            {servicesState.loading ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map(i => <div key={i} className="h-32 bg-[#161b2c] animate-pulse rounded-2xl" />)}
              </div>
            ) : (
              <>
                {/* Department Filters */}
                <div className="flex gap-2 overflow-x-auto pb-4 no-scrollbar mb-6">
                  <button
                    onClick={() => setServiceCategory("All")}
                    className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${serviceCategory === "All" ? 'bg-indigo-600 text-white' : 'bg-[#161b2c] text-slate-400 border border-white/5'}`}
                  >
                    All Types
                  </button>
                  {Array.from(new Set(servicesState.items.map(s => s.department_name || "General"))).sort().map(dept => (
                    <button
                      key={dept}
                      onClick={() => setServiceCategory(dept)}
                      className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${serviceCategory === dept ? 'bg-indigo-600 text-white' : 'bg-[#161b2c] text-slate-400 border border-white/5'}`}
                    >
                      {dept}
                    </button>
                  ))}
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {servicesState.items
                    .filter(s => serviceCategory === "All" || (s.department_name || "General") === serviceCategory)
                    .map(s => (
                      <button
                        key={s.key}
                        onClick={() => requestService(s)}
                        className="group relative p-6 rounded-2xl bg-[#161b2c] border border-white/5 text-left hover:border-indigo-500/30 hover:bg-[#1a2035] transition-all hover:shadow-xl hover:shadow-black/20"
                      >
                        <div className="flex justify-between items-start mb-4">
                          <span className="text-3xl filter grayscale group-hover:grayscale-0 transition-all">{getServiceIcon(s.key)}</span>
                          <span className="px-2 py-1 rounded text-[10px] font-bold bg-[#0b0e14] text-slate-500 border border-white/5">
                            {s.sla_minutes}m
                          </span>
                        </div>
                        <h3 className="font-bold text-white mb-1 group-hover:text-indigo-400 transition-colors">{s.label_en}</h3>
                        <p className="text-xs text-slate-500 line-clamp-2 mb-4">{s.description_en || "Request this service to your room."}</p>

                        <div className="flex items-center gap-2 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300">
                          <span className="text-xs font-bold text-indigo-400 underline underline-offset-4 decoration-indigo-500/30">Request</span>
                          <ArrowDownRight size={14} className="text-indigo-400" />
                        </div>
                      </button>
                    ))}
                </div>
              </>
            )}

          </div>
        )}

        {/* Modal */}
        {selectedService && (
          <ServiceRequestModal
            service={selectedService}
            hotelId={resolvedHotelId || hotelId}
            onClose={() => setSelectedService(null)}
            onConfirm={confirmServiceRequest}
          />
        )}

      </div>
    </div>
  );
}

function FilterButton({ active, onClick, children, color, border, bg }: any) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border transition-all ${active
        ? `${bg} ${color} ${border}`
        : 'bg-[#0b0e14] text-slate-500 border-white/10 hover:border-white/20'
        }`}
    >
      {children}
    </button>
  );
}

// --- Service Request Modal Implementation ---
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
  onConfirm: (data: { note: string; priority: string; locationType: string; publicLocation: string; zoneId?: string; media_urls?: string[] }) => void
}) {
  const [note, setNote] = useState("");
  const [priority, setPriority] = useState("normal");
  const [locationType, setLocationType] = useState("room");
  const [selectedZoneId, setSelectedZoneId] = useState("");
  const [zones, setZones] = useState<HotelZone[]>([]);
  const [loadingZones, setLoadingZones] = useState(false);

  // Fetch zones
  useEffect(() => {
    if (!hotelId) return;
    (async () => {
      setLoadingZones(true);
      const { supabase } = await import("../lib/supabase");
      const { data } = await supabase
        .from('hotel_zones')
        .select('id, name, zone_type, floor')
        .eq('hotel_id', hotelId)
        .eq('is_active', true);

      if (data) {
        // Sort
        const sorted = data.sort((a, b) => a.name.localeCompare(b.name));
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
        const { error } = await s.storage.from('ticket-attachments').upload(path, file);
        if (error) throw error;
        const { data: { publicUrl } } = s.storage.from('ticket-attachments').getPublicUrl(path);
        newUrls.push(publicUrl);
      }
      setMediaUrls(prev => [...prev, ...newUrls]);
    } catch (err: any) {
      alert("Upload failed: " + err.message);
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
    if (locationType === 'public' && !selectedZoneId) {
      alert("Please select a specific area.");
      return;
    }
    setSubmitting(true);
    await onConfirm({
      note, priority, locationType, zoneId: selectedZoneId,
      publicLocation: zones.find(z => z.id === selectedZoneId)?.name || "",
      media_urls: mediaUrls
    });
    setSubmitting(false);
  };

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
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-[#18181b] rounded-3xl shadow-2xl overflow-y-auto max-h-[90vh] border border-white/10 text-white scrollbar-hide">

        {/* Modal Header */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between bg-white/5 sticky top-0 z-10 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-600/20 flex items-center justify-center text-amber-500 border border-amber-500/30">
              <Bell size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Guest Request</h3>
              <p className="text-xs text-gray-400 font-medium">{service.label_en}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-6">
          <div>
            <label className="block text-sm font-medium text-white mb-2">Request Details {service.requires_description && <span className="text-red-500">*</span>}</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Describe your request..." className="w-full h-32 p-4 rounded-xl bg-[#27272a] border border-white/10 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500 transition-all resize-none" autoFocus />
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-2">Location</label>
            <div className="flex bg-[#27272a] rounded-lg p-1 border border-white/5">
              <button onClick={() => setLocationType("room")} className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${locationType === "room" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}>In Room</button>
              <button onClick={() => setLocationType("public")} className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${locationType === "public" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}>Public Area</button>
            </div>
            {locationType === "public" && (
              <div className="mt-3">
                <label className="text-xs text-gray-400 mb-1.5 block">Select Area</label>
                {loadingZones ? <div className="text-sm text-gray-500">Loading...</div> : <CustomZoneSelect value={selectedZoneId} onChange={setSelectedZoneId} groupedZones={groupedZones} />}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-2">Priority</label>
            <div className="flex gap-3">
              {[{ id: 'low', label: 'Low', color: 'bg-green-500' }, { id: 'normal', label: 'Normal', color: 'bg-blue-500' }, { id: 'high', label: 'High', color: 'bg-red-500' }].map(p => (
                <label key={p.id} className={`flex-1 cursor-pointer rounded-xl px-2 py-3 flex items-center justify-center gap-2 border ${priority === p.id ? "bg-[#27272a] border-white/20" : "bg-transparent border-white/10"}`}>
                  <input type="radio" name="priority" value={p.id} checked={priority === p.id} onChange={() => setPriority(p.id)} className="hidden" />
                  <span className={`w-2 h-2 rounded-full ${p.color} ${priority === p.id ? 'ring-2 ring-offset-2 ring-offset-[#18181b]' : 'opacity-50'}`} />
                  <span className={`text-sm font-medium ${priority === p.id ? 'text-white' : 'text-gray-500'}`}>{p.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-2">Attachments</label>
            <div className="flex flex-wrap gap-2">
              <input type="file" id="u" multiple accept="image/*,video/*" className="hidden" onChange={handleUpload} />
              <label htmlFor="u" className={`flex items-center gap-2 px-4 py-3 rounded-xl border border-white/10 bg-[#27272a] text-gray-300 hover:text-white transition-colors text-sm font-medium cursor-pointer w-full justify-center ${uploading ? 'opacity-50' : ''}`}>
                <Camera size={16} /> <span>{uploading ? 'Uploading...' : 'Attach Photo/Video'}</span>
              </label>
              {mediaUrls.length > 0 && (
                <div className="grid grid-cols-4 gap-2 w-full mt-2">
                  {mediaUrls.map((url, i) => (
                    <div key={i} className="relative group aspect-square rounded-lg overflow-hidden border border-white/10">
                      <img src={url} className="w-full h-full object-cover" />
                      <button onClick={() => setMediaUrls(m => m.filter((_, idx) => idx !== i))} className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 text-white"><X size={16} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-5 pt-2 bg-[#18181b] sticky bottom-0 z-10 border-t border-white/5">
          <button onClick={handleSubmit} disabled={submitting} className="w-full py-3.5 rounded-xl font-bold text-sm shadow-lg flex items-center justify-center gap-2 bg-[#3b82f6] hover:bg-blue-600 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            {submitting ? 'Sending...' : 'Submit Request'}
          </button>
        </div>
      </div>
    </div>
  );
}
