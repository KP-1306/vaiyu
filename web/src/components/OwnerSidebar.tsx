// web/src/components/OwnerSidebar.tsx
import React from "react";
import {
  NavLink,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";

type OwnerSidebarProps = {
  /** Optional explicit slug. If omitted, we derive from URL. */
  slug?: string;
  className?: string;
};

export default function OwnerSidebar({
  slug: propSlug,
  className = "",
}: OwnerSidebarProps) {
  const { slug: paramSlug } = useParams<{ slug?: string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();

  const resolvedSlug =
    propSlug || paramSlug || searchParams.get("slug") || "demo";

  const base = `/owner/${encodeURIComponent(resolvedSlug)}`;

  const navGroups: {
    label: string;
    items: {
      to: string;
      label: string;
      hint?: string;
      icon?: string;
      /** Optional custom "active" matcher instead of default */
      matchPrefix?: string;
    }[];
  }[] = [
      {
        label: "Overview",
        items: [
          {
            to: `${base}`,
            label: "Dashboard & KPIs",
            hint: "Core performance view for this property.",
            icon: "📊",
            matchPrefix: `${base}`,
          },
          {
            to: `${base}/arrivals`,
            label: "Guest Arrivals",
            hint: "Today's expected check-ins and walk-ins.",
            icon: "🛬",
            matchPrefix: `${base}/arrivals`,
          },
          {
            to: `${base}/housekeeping`,
            label: "Housekeeping",
            hint: "Room cleaning status and task management.",
            icon: "🧹",
            matchPrefix: `${base}/housekeeping`,
          },
          {
            to: `${base}/revenue`,
            label: "Revenue & forecast",
            hint: "ADR, RevPAR and pick-up insights.",
            icon: "💰",
            matchPrefix: `${base}/revenue`,
          },
          {
            to: `${base}/rooms`,
            label: "Rooms & occupancy",
            hint: "Inventory and occupancy snapshot.",
            icon: "🛏️",
            matchPrefix: `${base}/rooms`,
          },
        ],
      },
      {
        label: "Operations",
        items: [
          {
            to: `/ops?slug=${encodeURIComponent(resolvedSlug)}`,
            label: "Live requests & orders",
            hint: "Front desk, SLAs and routing.",
            icon: "🛎️",
            matchPrefix: "/ops",
          },
          {
            to: `/ops/analytics?slug=${encodeURIComponent(resolvedSlug)}`,
            label: "Ops Manager Dashboard",
            hint: "Breaches, risks and performance.",
            icon: "📈",
            matchPrefix: "/ops/analytics",
          },
          {
            to: `/hk?slug=${encodeURIComponent(resolvedSlug)}`,
            label: "Housekeeping board",
            hint: "Room cleaning and turn-down tickets.",
            icon: "🧽",
            matchPrefix: "/hk",
          },
          {
            to: `${base}/qr`,
            label: "QRs & guest entry",
            hint: "Print codes for menu, requests and checkout.",
            icon: "📱",
            matchPrefix: `${base}/qr`,
          },
          {
            to: `${base}/menu`,
            label: "Departments/Services & SLAs",
            hint: "Add/Edit Departments/Services, and SLAs.",
            icon: "🍽️",
            matchPrefix: `${base}/menu`,
          },
          {
            to: `${base}/staff-shifts`,
            label: "Staff & Shifts",
            hint: "Rosters, shifts, and attendance.",
            icon: "busts_in_silhouette", // Using emoji or similar icon - will use emoji for consistency
          },
        ],
      },
      {
        label: "People & HR",
        items: [
          {
            to: `${base}/hrms`,
            label: "Attendance snapshot",
            hint: "Present, late and absent view (coming soon).",
            icon: "👥",
            matchPrefix: `${base}/hrms`,
          },
          {
            to: `${base}/hrms/attendance`,
            label: "Attendance details",
            hint: "Per-staff timelines and trends (stub route).",
            icon: "📅",
            matchPrefix: `${base}/hrms/attendance`,
          },
        ],
      },
      {
        label: "Pricing & setup",
        items: [
          {
            to: `${base}/pricing`,
            label: "Pricing & packages",
            hint: "Experiment-friendly rate structure (stub).",
            icon: "🏷️",
            matchPrefix: `${base}/pricing`,
          },
          {
            to: `/owner/settings?slug=${encodeURIComponent(resolvedSlug)}`,
            label: "Owner settings",
            hint: "Branding, services, access control.",
            icon: "⚙️",
            matchPrefix: "/owner/settings",
          },
        ],
      },
    ];

  const isItemActive = (to: string, matchPrefix?: string) => {
    const prefix = matchPrefix ?? to;
    return location.pathname === to || location.pathname.startsWith(prefix);
  };

  return (
    <aside
      className={
        "w-full md:w-64 lg:w-72 shrink-0 space-y-4 " + (className || "")
      }
      aria-label="Owner navigation"
    >
      {navGroups.map((group) => (
        <nav key={group.label} className="space-y-1">
          <div className="px-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {group.label}
          </div>
          <ul className="mt-1 space-y-1">
            {group.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) => {
                    const active = isActive || isItemActive(item.to, item.matchPrefix);
                    return [
                      "flex items-start gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-blue-50 text-blue-700 font-medium"
                        : "text-gray-800 hover:bg-gray-50",
                    ].join(" ");
                  }}
                  aria-label={item.hint ? `${item.label}: ${item.hint}` : item.label}
                >
                  {item.icon ? (
                    <span className="mt-0.5 text-base" aria-hidden>
                      {item.icon}
                    </span>
                  ) : null}
                  <span className="flex-1">
                    <span className="block">{item.label}</span>
                    {item.hint ? (
                      <span className="mt-0.5 block text-xs text-gray-500">
                        {item.hint}
                      </span>
                    ) : null}
                  </span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      ))}
    </aside>
  );
}
