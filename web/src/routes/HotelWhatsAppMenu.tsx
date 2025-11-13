// web/src/routes/HotelWhatsAppMenu.tsx

import React from "react";
import { useParams } from "react-router-dom";

export default function HotelWhatsAppMenu() {
  const { slug } = useParams<{ slug: string }>();

  const safeSlug = slug || "";
  const menuUrl = `/menu?hotelSlug=${encodeURIComponent(safeSlug)}&via=whatsapp`;

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Hotel menu</h1>
        <p className="mt-1 text-sm text-gray-600">
          This link was opened from WhatsApp. Use the button below to view the live menu
          for this property.
        </p>
      </header>

      <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-700">
          You&apos;re viewing the menu link for:
        </p>
        <p className="text-sm font-medium text-gray-900 break-all">
          {safeSlug || "Unknown property"}
        </p>

        <a
          href={menuUrl}
          className="mt-3 inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
        >
          Open full menu
        </a>

        <p className="mt-2 text-xs text-gray-500">
          If the button doesn&apos;t work, you can copy this link into your browser:
          <br />
          <code className="mt-1 inline-block break-all rounded bg-gray-50 px-1 py-0.5 text-[11px]">
            {menuUrl}
          </code>
        </p>
      </section>
    </main>
  );
}
