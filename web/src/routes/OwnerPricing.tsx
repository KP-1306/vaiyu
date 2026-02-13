// web/src/routes/OwnerPricing.tsx
// Pricing & plans placeholder – no live rate editing yet, just a safe scaffold.

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";


type Hotel = {
  id: string;
  slug: string;
  name: string | null;
  city?: string | null;
};

export default function OwnerPricing() {
  const { slug } = useParams<{ slug?: string }>();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!slug) {
        setErrorText("Missing property slug in the URL.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setErrorText(null);
      try {
        const { data, error } = await supabase
          .from("hotels")
          .select("id, slug, name, city")
          .eq("slug", slug)
          .maybeSingle();

        if (!alive) return;

        if (error) {
          setErrorText(error.message || "Could not load property.");
          setHotel(null);
        } else if (!data) {
          setErrorText("We couldn’t find this property. It may not exist or you may not have access.");
          setHotel(null);
        } else {
          setHotel(data as Hotel);
        }
      } catch (e: any) {
        if (!alive) return;
        setErrorText(e?.message || "Unexpected error while loading property.");
        setHotel(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [slug]);

  const title =
    hotel?.name || (slug ? `Pricing · ${slug}` : "Pricing & plans");

  if (loading) {
    return (
      <main className="min-h-[60vh] grid place-items-center">
        <div className="rounded-xl border bg-white px-6 py-4 text-sm text-gray-600">
          Loading pricing view…
        </div>
      </main>
    );
  }

  if (errorText) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <div className="mt-4 rounded-xl border bg-rose-50 px-6 py-4 text-rose-900">
          <div className="font-semibold mb-1">Can’t open pricing</div>
          <p className="text-sm">{errorText}</p>
          <div className="mt-3 flex gap-2">
            <Link to="/owner" className="btn btn-light">
              Owner home
            </Link>
            {slug && (
              <Link to={`/owner/${slug}`} className="btn btn-light">
                Back to dashboard
              </Link>
            )}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-6xl mx-auto p-6">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500 mb-2">
        <Link to={slug ? `/owner/${slug}` : '/owner'} className="hover:text-amber-600 transition">Dashboard</Link>
        <span className="text-slate-300">/</span>
        <span className="text-slate-700">Pricing</span>
      </div>

      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-gray-600">
            Dedicated space for room pricing strategy, packages and channel rules. In this release it
            is a read-only scaffold so you can safely explore without impacting live rates.
          </p>
        </div>
        {slug && (
          <div className="flex gap-2">
            <Link to={`/owner/${slug}`} className="btn btn-light">
              Owner dashboard
            </Link>
            <Link to={`/owner/${slug}/revenue`} className="btn btn-light">
              Revenue &amp; forecast
            </Link>
          </div>
        )}
      </header>

      <section className="rounded-2xl border bg-white p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-800">
          How this page will evolve
        </h2>
        <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
          <li>
            Configure base rates, derived plans and simple{" "}
            <span className="font-medium">“shoulder date” nudges</span>.
          </li>
          <li>
            See soft and hot dates highlighted based on{" "}
            <span className="font-medium">pickup and forecast</span>.
          </li>
          <li>
            Export a simple CSV of recommended rate changes for your PMS / channel manager.
          </li>
        </ul>
        <p className="text-xs text-gray-500">
          Until live rate editing is enabled, please continue managing prices in your PMS or channel
          manager. This page is safe to open in demos and owner walk-throughs.
        </p>
      </section>
    </main>
  );
}
