// web/src/routes/OwnerMenu.tsx
// Lightweight Food Menu editor for pilot hotels.
// Owners can manage items that show up in the guest "Food" tab.

import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import OwnerGate from "../components/OwnerGate";
import SEO from "../components/SEO";
import UsageMeter from "../components/UsageMeter";
import Spinner from "../components/Spinner";

type Hotel = {
  id: string;
  slug: string;
  name: string;
};

type EditableMenuItem = {
  id?: string;
  name: string;
  name_i18n?: Record<string, string>; // owner-supplied localized names; {} = English only
  category: string;
  price: number | "" ;
  isVeg: boolean;
  active: boolean;
};

function slugifyKey(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .toUpperCase();
}

function OwnerMenuInner() {
  const { slug } = useParams<{ slug?: string }>();

  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [items, setItems] = useState<EditableMenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [suggestingAll, setSuggestingAll] = useState(false);

  // Load hotel + menu_items for that hotel
  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      setOk(null);

      try {
        if (!slug) {
          throw new Error("Missing hotel slug in URL.");
        }

        // 1) Find hotel by slug (scoped by RLS to owner)
        const { data: hotelRow, error: hotelErr } = await supabase
          .from("hotels")
          .select("id, slug, name")
          .eq("slug", slug)
          .maybeSingle();

        if (hotelErr) throw hotelErr;
        if (!hotelRow) throw new Error("Hotel not found or access denied.");

        const h = hotelRow as Hotel;
        setHotel(h);

        // 2) Load menu_items for that hotel.
        // We select * so this stays tolerant if schema adds extra columns.
        const { data: rows, error: menuErr } = await supabase
          .from("menu_items")
          .select("*")
          .eq("hotel_id", h.id)
          .order("name", { ascending: true });

        if (menuErr) throw menuErr;

        const normalized: EditableMenuItem[] = (rows || []).map((r: any) => ({
          id: r.id,
          name: (r.name ?? "").toString(),
          name_i18n:
            r.name_i18n && typeof r.name_i18n === "object" ? r.name_i18n : {},
          category: (r.category ?? "All-day").toString(),
          price:
            typeof r.base_price === "number"
              ? r.base_price
              : typeof r.price === "number"
              ? r.price
              : "",
          isVeg:
            typeof r.is_veg === "boolean"
              ? r.is_veg
              : typeof r.veg === "boolean"
              ? r.veg
              : true,
          active:
            typeof r.active === "boolean"
              ? r.active
              : typeof r.is_active === "boolean"
              ? r.is_active
              : true,
        }));

        setItems(normalized);
      } catch (e: any) {
        console.error(e);
        setError(e?.message || "Failed to load food menu.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [slug]);

  function updateItem(idx: number, patch: Partial<EditableMenuItem>) {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        name: "",
        category: "All-day",
        price: "",
        isVeg: true,
        active: true,
      },
    ]);
  }

  // Offline-suggest a Hindi name for every item that doesn't have one yet.
  // Owner reviews the inline column, then Save persists. No translation API;
  // suggestions are editable (curated dictionary + phonetic fallback).
  async function suggestAllHindi() {
    setSuggestingAll(true);
    try {
      const { transliterateHi } = await import("../i18n/transliterateHi");
      setItems((prev) =>
        prev.map((it) => {
          if (it.name_i18n?.hi || !it.name.trim()) return it; // keep existing / skip blank
          const s = transliterateHi(it.name);
          return s ? { ...it, name_i18n: { ...(it.name_i18n || {}), hi: s } } : it;
        }),
      );
    } finally {
      setSuggestingAll(false);
    }
  }

  async function save() {
    if (!hotel) return;
    setSaving(true);
    setError(null);
    setOk(null);

    try {
      const validItems = items.filter((i) => i.name.trim().length > 0);

      if (validItems.length === 0) {
        setError("No valid items to save.");
        setSaving(false);
        return;
      }

      // Separate existing items (with id) from new items (without id)
      const existingItems = validItems.filter((i) => i.id);
      const newItems = validItems.filter((i) => !i.id);

      // Update existing items one by one
      for (const item of existingItems) {
        const priceNumber =
          item.price === "" || item.price == null
            ? 0
            : Math.max(0, Number(item.price) || 0);

        const { error: updateErr } = await supabase
          .from("menu_items")
          .update({
            item_key: slugifyKey(item.name),
            name: item.name.trim(),
            // Owner-supplied Hindi (additive; '{}' = English only). CHECK
            // constraint validates keys⊆{en,hi} + string values.
            name_i18n: item.name_i18n || {},
            category: item.category.trim() || "All-day",
            base_price: priceNumber,
            is_veg: !!item.isVeg,
            active: !!item.active,
          })
          .eq("id", item.id);

        if (updateErr) throw updateErr;
      }

      // Insert new items
      if (newItems.length > 0) {
        const newPayload = newItems.map((i) => {
          const priceNumber =
            i.price === "" || i.price == null
              ? 0
              : Math.max(0, Number(i.price) || 0);

          return {
            hotel_id: hotel.id,
            item_key: slugifyKey(i.name),
            name: i.name.trim(),
            name_i18n: i.name_i18n || {},
            category: i.category.trim() || "All-day",
            base_price: priceNumber,
            is_veg: !!i.isVeg,
            active: !!i.active,
          };
        });

        const { error: insertErr } = await supabase
          .from("menu_items")
          .insert(newPayload);

        if (insertErr) throw insertErr;
      }

      setOk("Food menu saved. Changes are live in the guest menu.");

      // Reload once to pick up generated IDs / defaults
      const { data: rows, error: reloadErr } = await supabase
        .from("menu_items")
        .select("*")
        .eq("hotel_id", hotel.id)
        .order("name", { ascending: true });

      if (reloadErr) throw reloadErr;

      const normalized: EditableMenuItem[] = (rows || []).map((r: any) => ({
        id: r.id,
        name: (r.name ?? "").toString(),
        name_i18n:
          r.name_i18n && typeof r.name_i18n === "object" ? r.name_i18n : {},
        category: (r.category ?? "All-day").toString(),
        price:
          typeof r.base_price === "number"
            ? r.base_price
            : typeof r.price === "number"
            ? r.price
            : "",
        isVeg:
          typeof r.is_veg === "boolean"
            ? r.is_veg
            : typeof r.veg === "boolean"
            ? r.veg
            : true,
        active:
          typeof r.active === "boolean"
            ? r.active
            : typeof r.is_active === "boolean"
            ? r.is_active
            : true,
      }));

      setItems(normalized);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Failed to save food menu.");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !hotel) {
    return (
      <div className="min-h-[40vh] grid place-items-center">
        <Spinner label="Loading food menu…" />
      </div>
    );
  }

  return (
    <main className="max-w-5xl mx-auto p-4 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Food menu</h1>
          <p className="text-sm text-gray-600">
            Lightweight editor for pilot hotels. Items here power the{" "}
            <strong>Food</strong> tab in the guest menu.
          </p>
          {hotel && (
            <p className="text-xs text-gray-500 mt-1">
              Hotel: <strong>{hotel.name}</strong> ({hotel.slug})
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {hotel?.id && <UsageMeter hotelId={hotel.id} />}
          {hotel?.slug && (
            <Link
              to={`/stay/demo/menu`}
              className="btn btn-light !py-1.5 !px-3 text-xs"
            >
              View guest menu
            </Link>
          )}
        </div>
      </header>

      {error && (
        <div className="card border border-amber-400 text-sm text-amber-900">
          ⚠️ {error}
        </div>
      )}
      {ok && (
        <div className="card border border-emerald-400 text-sm text-emerald-900">
          ✅ {ok}
        </div>
      )}

      <section className="bg-white rounded shadow p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium">Items</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-light !py-2 !px-3 text-sm"
              onClick={suggestAllHindi}
              disabled={suggestingAll || items.length === 0}
              title="Offline suggestion — fills a Hindi name for items that don't have one yet. Review, then Save."
            >
              {suggestingAll ? "…" : "Suggest Hindi (all)"}
            </button>
            <button
              type="button"
              className="btn btn-light !py-2 !px-3 text-sm"
              onClick={addItem}
            >
              + Add item
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500">
          Keep names short and clear. Prices are in your default currency. Use{" "}
          <strong>Active</strong> to hide items temporarily without deleting.
        </p>

        <div className="overflow-auto mt-3">
          <table className="min-w-[720px] w-full text-sm border">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2 border-b">Name</th>
                <th className="text-left px-3 py-2 border-b">Hindi (हिं)</th>
                <th className="text-left px-3 py-2 border-b">Category</th>
                <th className="text-left px-3 py-2 border-b">Price</th>
                <th className="text-left px-3 py-2 border-b">Veg</th>
                <th className="text-left px-3 py-2 border-b">Active</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={item.id ?? `tmp-${idx}`} className="border-b">
                  <td className="px-3 py-2">
                    <input
                      className="w-full rounded-md border px-2 py-1"
                      value={item.name}
                      onChange={(e) =>
                        updateItem(idx, { name: e.target.value })
                      }
                      placeholder="Masala Tea"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      lang="hi"
                      className="w-full rounded-md border px-2 py-1"
                      value={item.name_i18n?.hi || ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateItem(idx, {
                          name_i18n: v
                            ? { ...(item.name_i18n || {}), hi: v }
                            : {},
                        });
                      }}
                      placeholder="वैकल्पिक (हिंदी नाम)"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="w-full rounded-md border px-2 py-1"
                      value={item.category}
                      onChange={(e) =>
                        updateItem(idx, { category: e.target.value })
                      }
                      placeholder="Breakfast / All-day"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      className="w-28 rounded-md border px-2 py-1"
                      value={item.price === "" ? "" : item.price}
                      onChange={(e) =>
                        updateItem(idx, {
                          price:
                            e.target.value === ""
                              ? ""
                              : Number(e.target.value),
                        })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={item.isVeg}
                      onChange={(e) =>
                        updateItem(idx, { isVeg: e.target.checked })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={item.active}
                      onChange={(e) =>
                        updateItem(idx, { active: e.target.checked })
                      }
                    />
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-6 text-center text-gray-500"
                  >
                    No items yet. Click <strong>+ Add item</strong> to create
                    your first dish.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex gap-2">
        <button
          type="button"
          className="btn"
          onClick={save}
          disabled={saving || !hotel}
        >
          {saving ? "Saving…" : "Save menu"}
        </button>
      </div>
    </main>
  );
}

export default function OwnerMenu() {
  return (
    <>
      <SEO title="Food menu" noIndex />
      <OwnerGate>
        <OwnerMenuInner />
      </OwnerGate>
    </>
  );
}
