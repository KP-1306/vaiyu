// web/src/routes/OwnerMenu.tsx
// Standalone Food Menu editor route (/owner/:slug/menu — the left-nav "Food Menu").
//
// This used to be a separate, light-themed table whose Save was broken (it wrote
// to non-existent `base_price` / `category` columns; the schema has `price` /
// `category_id`). Rather than maintain a second, divergent menu editor, this route
// now renders the SAME working component used under Services & SLAs → Kitchen / F&B
// ("Menu & Food Items"): `OwnerMenuManagement`. One source of truth, correct save,
// and the bilingual Hindi (हिं) column — wrapped in the same dark console chrome as
// the rest of the owner pages so the look/feel is consistent.

import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import OwnerGate from "../components/OwnerGate";
import SEO from "../components/SEO";
import Spinner from "../components/Spinner";
import { OwnerLangToggle } from "../i18n/OwnerLangToggle";
import OwnerMenuManagement from "../components/OwnerMenuManagement";

type Hotel = {
  id: string;
  slug: string;
  name: string;
};

function OwnerMenuInner() {
  const { slug } = useParams<{ slug?: string }>();

  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Resolve the hotel by slug (RLS scopes this to owners/managers of the hotel),
  // then hand its id to the shared menu editor.
  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (!slug) {
          throw new Error("Missing hotel slug in URL.");
        }

        const { data: hotelRow, error: hotelErr } = await supabase
          .from("hotels")
          .select("id, slug, name")
          .eq("slug", slug)
          .maybeSingle();

        if (hotelErr) throw hotelErr;
        if (!hotelRow) throw new Error("Hotel not found or access denied.");

        setHotel(hotelRow as Hotel);
      } catch (e: any) {
        console.error(e);
        setError(e?.message || "Failed to load food menu.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [slug]);

  return (
    <div className="flex flex-col min-h-screen">
      {/* Same breadcrumb header as Services & SLAs for a consistent console feel */}
      <header className="flex h-10 items-center justify-between border-b border-white/10 bg-[#1A2040] px-4 shadow-sm shrink-0">
        <div className="flex items-center gap-2 text-xs">
          <Link
            to={slug ? `/owner/${slug}` : "/owner"}
            className="font-medium text-slate-400 hover:text-white"
          >
            Dashboard
          </Link>
          <span className="text-slate-600">›</span>
          <span className="font-semibold text-white">Food Menu</span>
        </div>
        <OwnerLangToggle />
      </header>

      {/* Same dark gradient background as the rest of the owner console */}
      <div className="flex-1 bg-gradient-to-b from-[#1A2040] via-[#0B0F1A] to-[#0B0F1A] text-white p-6 md:p-7">
        <div className="max-w-6xl mx-auto space-y-5">
          <div>
            <h1 className="text-2xl font-semibold">Food Menu</h1>
            <p className="text-sm text-slate-400 mt-1">
              Items here power the <strong>Food</strong> tab in the guest menu.
              {hotel && (
                <>
                  {" "}
                  · <strong>{hotel.name}</strong> ({hotel.slug})
                </>
              )}
            </p>
          </div>

          {loading && !hotel && (
            <div className="min-h-[40vh] grid place-items-center">
              <Spinner label="Loading food menu…" />
            </div>
          )}

          {error && (
            <div className="rounded border border-amber-400/40 bg-amber-500/10 text-amber-200 text-sm px-3 py-2">
              ⚠️ {error}
            </div>
          )}

          {/* Shared, working menu editor (correct price/category_id save +
              bilingual Hindi column). Same component used under Kitchen / F&B. */}
          {hotel && <OwnerMenuManagement hotelId={hotel.id} />}
        </div>
      </div>
    </div>
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
