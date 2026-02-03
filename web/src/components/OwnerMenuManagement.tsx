import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import Spinner from "./Spinner";
import AddFoodItemModal, { FoodItemData } from "./AddFoodItemModal";

interface OwnerMenuManagementProps {
    hotelId: string;
}

// Updated to match new schema
type EditableMenuItem = {
    id?: string; // Optional for new items
    item_key?: string;
    name: string;
    category_id: string; // Now using ID
    price: number | "";
    isVeg: boolean;
    active: boolean;
    metadata?: any;
    internal_notes?: string;
    availability?: any; // Only present for new items to be inserted
};

interface MenuCategory {
    id: string;
    name: string;
}

function slugifyKey(name: string) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)+/g, "")
        .toUpperCase();
}

export default function OwnerMenuManagement({ hotelId }: OwnerMenuManagementProps) {
    const [items, setItems] = useState<EditableMenuItem[]>([]);
    const [categories, setCategories] = useState<MenuCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [ok, setOk] = useState<string | null>(null);

    const [showAddModal, setShowAddModal] = useState(false);
    const [editingItem, setEditingItem] = useState<EditableMenuItem | null>(null);

    // Load menu_items and categories
    useEffect(() => {
        if (hotelId) {
            loadData();
        }
    }, [hotelId]);

    async function loadData() {
        setLoading(true);
        setError(null);
        setOk(null);

        try {
            // 1. Fetch Categories
            const { data: catRows, error: catErr } = await supabase
                .from("menu_categories")
                .select("id, name")
                .eq("hotel_id", hotelId)
                .order("display_order");

            if (catErr) throw catErr;

            // Auto-seed Categories if empty
            if (!catRows || catRows.length === 0) {
                const defaults = [
                    { hotel_id: hotelId, key: 'ALL_DAY', name: 'All Day', display_order: 1 },
                    { hotel_id: hotelId, key: 'BREAKFAST', name: 'Breakfast', display_order: 2 },
                    { hotel_id: hotelId, key: 'LUNCH', name: 'Lunch', display_order: 3 },
                    { hotel_id: hotelId, key: 'DINNER', name: 'Dinner', display_order: 4 },
                    { hotel_id: hotelId, key: 'BEVERAGES', name: 'Beverages', display_order: 5 },
                ];

                const { error: seedErr } = await supabase
                    .from("menu_categories")
                    .insert(defaults);

                if (!seedErr) {
                    // Refetch
                    const { data: refetched } = await supabase
                        .from("menu_categories")
                        .select("id, name")
                        .eq("hotel_id", hotelId)
                        .order("display_order");
                    setCategories(refetched || []);
                }
            } else {
                setCategories(catRows || []);
            }

            // 2. Fetch Menu Items
            const { data: rows, error: menuErr } = await supabase
                .from("menu_items")
                .select("*, menu_item_availability(*)")
                .eq("hotel_id", hotelId)
                .order("name", { ascending: true });

            if (menuErr) throw menuErr;

            const normalized: EditableMenuItem[] = (rows || []).map((r: any) => ({
                id: r.id,
                item_key: r.item_key,
                name: (r.name ?? "").toString(),
                category_id: r.category_id, // Might be null if legacy data
                price:
                    typeof r.price === "number"
                        ? r.price
                        : "",
                isVeg:
                    // Check metadata first if standard columns fail, or prefer column
                    typeof r.is_veg === "boolean"
                        ? r.is_veg
                        : (r.metadata?.veg ?? true),
                active:
                    typeof r.active === "boolean"
                        ? r.active
                        : true,
                metadata: r.metadata || {},
                internal_notes: r.internal_notes || "",
                availability: r.menu_item_availability && r.menu_item_availability.length > 0 ? {
                    days: r.menu_item_availability.map((a: any) => a.day_of_week),
                    start_time: r.menu_item_availability[0].start_time, // Take first row's time
                    end_time: r.menu_item_availability[0].end_time,
                    hide_outside: r.menu_item_availability[0].hide_outside_window
                } : undefined
            }));

            setItems(normalized);
        } catch (e: any) {
            console.error(e);
            setError(e?.message || "Failed to load food menu.");
        } finally {
            setLoading(false);
        }
    }

    function updateItem(idx: number, patch: Partial<EditableMenuItem>) {
        setItems((prev) => {
            const next = [...prev];
            next[idx] = { ...next[idx], ...patch };
            return next;
        });
        if (ok) setOk(null);
    }

    // Called when modal saves
    function handleModalSave(data: FoodItemData) {
        if (editingItem) {
            // Update existing in list
            setItems((prev) => prev.map(item => {
                if (item === editingItem) {
                    return {
                        ...item,
                        name: data.name,
                        item_key: data.key,
                        category_id: data.category_id,
                        price: data.price,
                        isVeg: data.is_veg,
                        active: data.active,
                        metadata: data.metadata,
                        internal_notes: data.internal_notes,
                        availability: data.availability,
                        // Keep ID if it exists
                    };
                }
                return item;
            }));
            setEditingItem(null);
        } else {
            // Add to local list as a new item
            setItems((prev) => [
                ...prev,
                {
                    name: data.name,
                    item_key: data.key,
                    category_id: data.category_id,
                    price: data.price,
                    isVeg: data.is_veg,
                    active: data.active,
                    metadata: data.metadata,
                    internal_notes: data.internal_notes,
                    availability: data.availability // Store to insert later
                },
            ]);
        }
        if (ok) setOk(null);
    }

    function openEditModal(item: EditableMenuItem) {
        setEditingItem(item);
        setShowAddModal(true);
    }

    function openAddModal() {
        setEditingItem(null);
        setShowAddModal(true);
    }

    async function save() {
        if (!hotelId) return;
        setSaving(true);
        setError(null);
        setOk(null);

        try {
            const validItems = items.filter((i) => i.name.trim().length > 0);

            if (validItems.length === 0 && items.length > 0) {
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

                // Construct update payload
                // Prepare Update RPC payload
                const rpcUpdateParams = {
                    p_item_id: item.id,
                    p_hotel_id: hotelId,
                    p_name: item.name.trim(),
                    p_category_id: item.category_id || null, // Ensure valid UUID or handle null if RPC allows (RPC checks exists)
                    p_price: priceNumber,
                    p_is_veg: !!item.isVeg,
                    p_active: !!item.active,
                    p_metadata: {
                        ...(item.metadata || {}),
                        veg: item.isVeg
                    },
                    p_internal_notes: item.internal_notes,
                    p_availability_days: item.availability?.days || [],
                    p_start_time: item.availability?.start_time || "06:00",
                    p_end_time: item.availability?.end_time || "23:00",
                    p_hide_outside: item.availability?.hide_outside ?? true
                };

                const { error: updateErr } = await supabase.rpc('update_menu_item', rpcUpdateParams);

                if (updateErr) {
                    console.error("Update RPC Error:", updateErr);
                    throw updateErr;
                }
            }

            // Insert new items via RPC
            if (newItems.length > 0) {
                for (const i of newItems) {
                    const priceNumber =
                        i.price === "" || i.price == null
                            ? 0
                            : Math.max(0, Number(i.price) || 0);

                    // Prepare RPC payload
                    const rpcParams = {
                        p_hotel_id: hotelId,
                        p_name: i.name.trim(),
                        p_category_id: i.category_id,
                        p_price: priceNumber,
                        p_is_veg: !!i.isVeg,
                        p_active: !!i.active,
                        p_metadata: i.metadata || { veg: !!i.isVeg },
                        p_internal_notes: i.internal_notes,
                        p_availability_days: i.availability?.days || [],
                        p_start_time: i.availability?.start_time || "06:00",
                        p_end_time: i.availability?.end_time || "23:00",
                        p_hide_outside: i.availability?.hide_outside ?? true
                    };

                    const { error: rpcErr } = await supabase.rpc('create_menu_item', rpcParams);

                    if (rpcErr) {
                        console.error("RPC Error:", rpcErr);
                        throw rpcErr;
                    }
                }
            }

            setOk("Food menu saved. Changes are live in the guest menu.");
            loadData(); // Reload to get fresh IDs

        } catch (e: any) {
            console.error(e);
            setError(e?.message || "Failed to save food menu.");
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return (
            <div className="py-12 grid place-items-center">
                <Spinner label="Loading food menu…" />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {error && (
                <div className="p-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-md text-sm">
                    ⚠️ {error}
                </div>
            )}
            {ok && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-md text-sm">
                    ✅ {ok}
                </div>
            )}

            <section className="bg-white/5 rounded-lg border border-white/10 p-4 space-y-4">
                <div className="flex items-center justify-between gap-2">
                    <div>
                        <h2 className="text-lg font-medium text-white">Menu Items</h2>
                        <p className="text-xs text-slate-400 mt-1">
                            Manage food and beverage items available for guests to order.
                        </p>
                    </div>
                    <button
                        type="button"
                        className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-md transition-colors"
                        onClick={openAddModal}
                    >
                        + Add item
                    </button>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-white/5 text-slate-300 uppercase text-xs">
                            <tr>
                                <th className="px-3 py-3 rounded-tl-md w-16"></th>
                                <th className="px-3 py-3">Name</th>
                                <th className="px-3 py-3">Category</th>
                                <th className="px-3 py-3">Price</th>
                                <th className="px-3 py-3 text-center">Veg</th>
                                <th className="px-3 py-3 text-center">Active <span className="ml-1 text-slate-500" title="Toggle visibility regarding availability">ⓘ</span></th>
                                <th className="px-3 py-3 rounded-tr-md"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10">
                            {items.map((item, idx) => (
                                <tr key={item.id ?? `tmp-${idx}`} className="hover:bg-white/5 transition-colors">
                                    <td className="px-3 py-2">
                                        <div className="w-10 h-10 rounded bg-slate-800 border border-white/10 overflow-hidden flex items-center justify-center">
                                            {item.metadata?.image_url ? (
                                                <img src={item.metadata.image_url} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <span className="text-xs text-slate-600">No img</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-3 py-2">
                                        <input
                                            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-white focus:border-blue-500 focus:outline-none placeholder-slate-600"
                                            value={item.name}
                                            onChange={(e) =>
                                                updateItem(idx, { name: e.target.value })
                                            }
                                            placeholder="e.g. Masala Tea"
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        {/* Category Dropdown */}
                                        <select
                                            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-white focus:border-blue-500 focus:outline-none"
                                            value={item.category_id || ""}
                                            onChange={(e) =>
                                                updateItem(idx, { category_id: e.target.value })
                                            }
                                        >
                                            <option value="" disabled>Select Category</option>
                                            {categories.map(c => (
                                                <option key={c.id} value={c.id}>{c.name}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="px-3 py-2">
                                        <input
                                            type="number"
                                            min={0}
                                            className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-white focus:border-blue-500 focus:outline-none"
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
                                    <td className="px-3 py-2 text-center">
                                        <input
                                            type="checkbox"
                                            className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500 focus:ring-offset-slate-900"
                                            checked={item.isVeg}
                                            onChange={(e) =>
                                                updateItem(idx, { isVeg: e.target.checked })
                                            }
                                        />
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        {/* Toggle Switch */}
                                        <button
                                            type="button"
                                            onClick={() => updateItem(idx, { active: !item.active })}
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${item.active ? 'bg-blue-600' : 'bg-slate-700'
                                                }`}
                                        >
                                            <span
                                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${item.active ? 'translate-x-6' : 'translate-x-1'
                                                    }`}
                                            />
                                        </button>
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        <button
                                            onClick={() => openEditModal(item)}
                                            className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors"
                                            title="Edit Details"
                                        >
                                            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                            </svg>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {items.length === 0 && (
                                <tr>
                                    <td
                                        colSpan={7}
                                        className="px-3 py-8 text-center text-slate-500 italic"
                                    >
                                        No items yet. Click "+ Add item" to create your first dish.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            <div className="flex justify-end pt-2">
                <button
                    type="button"
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={save}
                    disabled={saving || !hotelId}
                >
                    {saving ? "Saving…" : "Save Changes"}
                </button>
            </div>

            <AddFoodItemModal
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
                onSave={handleModalSave}
                hotelId={hotelId}
                initialData={editingItem ? {
                    name: editingItem.name,
                    key: editingItem.item_key || slugifyKey(editingItem.name),
                    category_id: editingItem.category_id,
                    price: typeof editingItem.price === 'number' ? editingItem.price : 0,
                    is_veg: editingItem.isVeg,
                    active: editingItem.active,
                    metadata: editingItem.metadata || {},
                    internal_notes: editingItem.internal_notes || "",
                    availability: editingItem.availability
                } : undefined}
            />
        </div>
    );
}
