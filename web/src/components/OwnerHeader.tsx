// web/src/components/OwnerHeader.tsx
import React from "react";
import { Link } from "react-router-dom";

type OwnerHeaderProps = {
  title: string;
  subtitle?: string;
  /** Optional hotel slug for quick back link / context chip */
  slug?: string;
  /** Right-side actions (buttons, filters, etc.) */
  actions?: React.ReactNode;
  className?: string;
};

export default function OwnerHeader({
  title,
  subtitle,
  slug,
  actions,
  className = "",
}: OwnerHeaderProps) {
  return (
    <header
      className={
        "flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4 " +
        (className || "")
      }
    >
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
          {slug ? (
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
              {slug}
            </span>
          ) : null}
        </div>
        {subtitle ? (
          <p className="mt-1 text-sm text-gray-600">{subtitle}</p>
        ) : null}
        {slug ? (
          <p className="mt-1 text-xs text-gray-500">
            <Link
              to={`/owner/${encodeURIComponent(slug)}`}
              className="text-blue-600 hover:underline"
            >
              Back to Owner dashboard
            </Link>
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
