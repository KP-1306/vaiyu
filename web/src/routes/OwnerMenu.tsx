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

  async function save() {
    if (!hotel) return;
    setSaving(true);
    setError(null);
    setOk(null);

    try {
      const payload = items
        .filter((i) => i.name.trim().length > 0)
        .map((i) => {
          const priceNumber =
            i.price === "" || i.price == null
              ? 0
              : Math.max(0, Number(i.price) || 0);

          const row: any = {
            id: i.id,
            hotel_id: hotel.id,
            name: i.name.trim(),
            category: i.category.trim() || "All-day",
            base_price: priceNumber,
            is_veg: !!i.isVeg,
            active: !!i.active,
            item_key: slugifyKey(i.name),
          };

          // If id is undefined, Supabase will insert; otherwise it will update
          return row;
        });

      const { error: upsertErr } = await supabase
        .from("menu_items")
        .upsert(payload, { onConflict: "id" });

      if (upsertErr) throw upsertErr;

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
          <button
            type="button"
            className="btn btn-light !py-2 !px-3 text-sm"
            onClick={addItem}
          >
            + Add item
          </button>
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
                    colSpan={5}
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
