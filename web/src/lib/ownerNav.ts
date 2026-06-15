// web/src/lib/ownerNav.ts
// Manifest of owner-dashboard destinations for the global command palette.
// Paths mirror the owner routes in main.tsx (owner/:slug/*). Keep in sync when
// adding/removing an owner feature route.

import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, PlaneLanding, Sparkles, Users2, CalendarClock,
  ClipboardList, Wallet, TrendingUp, LineChart, Tag, CalendarRange, SlidersHorizontal,
  History, ReceiptText, PiggyBank, Megaphone, Radar, FileText, Handshake, Workflow,
  Package, Globe, Gauge, MessageCircle, CalendarDays, Star, Image, Upload, Settings,
  QrCode, UtensilsCrossed, Building2, BarChart3,
} from "lucide-react";

export type OwnerNavItem = {
  id: string;
  label: string;
  group: "Operations" | "Revenue & Money" | "Growth" | "Setup";
  icon: LucideIcon;
  keywords?: string;            // extra search terms (synonyms / abbreviations)
  to: (slug: string) => string; // destination path
  // Stub/"coming soon" routes that only exist to back a dashboard signpost
  // (and avoid a 404). Kept in the manifest so OwnerBreadcrumb can still label
  // them if a guest lands there, but excluded from command-palette search —
  // search must only surface real, available features.
  hidden?: boolean;
};

const slugBase = (slug: string) => `/owner/${slug}`;

export const OWNER_NAV: OwnerNavItem[] = [
  // ── Operations ──
  { id: "dashboard", label: "Dashboard", group: "Operations", icon: LayoutDashboard, keywords: "home overview kpi", to: (s) => slugBase(s) },
  { id: "arrivals", label: "Arrivals & Bookings", group: "Operations", icon: PlaneLanding, keywords: "checkin check-in guests today bookings front desk", to: (s) => `${slugBase(s)}/arrivals` },
  { id: "housekeeping", label: "Housekeeping", group: "Operations", icon: Sparkles, keywords: "hk cleaning dirty clean inspect", to: (s) => `${slugBase(s)}/housekeeping` },
  { id: "pickup", label: "Pickup Report", group: "Operations", icon: CalendarClock, keywords: "bookings pickup pace", to: (s) => `${slugBase(s)}/bookings/pickup` },
  { id: "workforce", label: "Workforce", group: "Operations", icon: Users2, keywords: "staff team employees", to: (s) => `${slugBase(s)}/workforce` },
  { id: "staff-shifts", label: "Staff & Shifts", group: "Operations", icon: CalendarClock, keywords: "roster schedule shift board", to: (s) => `${slugBase(s)}/staff-shifts` },
  { id: "hrms", label: "HRMS", group: "Operations", icon: ClipboardList, keywords: "hr attendance leave payroll", to: (s) => `${slugBase(s)}/hrms` },
  { id: "menu", label: "Food Menu", group: "Operations", icon: UtensilsCrossed, keywords: "restaurant items dishes f&b", to: (s) => `${slugBase(s)}/menu` },
  { id: "qr", label: "QR Codes", group: "Operations", icon: QrCode, keywords: "table room qr scan", to: (s) => `${slugBase(s)}/qr` },

  // ── Revenue & Money ──
  { id: "payments", label: "Payments", group: "Revenue & Money", icon: Wallet, keywords: "folio collect refund cash razorpay", to: (s) => `${slugBase(s)}/payments` },
  { id: "revenue", label: "Revenue", group: "Revenue & Money", icon: TrendingUp, keywords: "adr revpar occupancy income", to: (s) => `${slugBase(s)}/revenue` },
  { id: "analytics", label: "Analytics", group: "Revenue & Money", icon: BarChart3, keywords: "reports metrics insights", to: (s) => `${slugBase(s)}/analytics` },
  { id: "pricing", label: "Dynamic Pricing", group: "Revenue & Money", icon: LineChart, keywords: "rate price auto yield", to: (s) => `${slugBase(s)}/pricing` },
  { id: "pricing-plans", label: "Rate Plans", group: "Revenue & Money", icon: Tag, keywords: "pricing plan tariff", to: (s) => `${slugBase(s)}/pricing/plans` },
  { id: "pricing-calendar", label: "Rate Calendar", group: "Revenue & Money", icon: CalendarRange, keywords: "pricing calendar daily rate", to: (s) => `${slugBase(s)}/pricing/calendar` },
  { id: "pricing-rules", label: "Pricing Rules", group: "Revenue & Money", icon: SlidersHorizontal, keywords: "auto rule occupancy", to: (s) => `${slugBase(s)}/pricing/rules` },
  { id: "pricing-history", label: "Pricing History", group: "Revenue & Money", icon: History, keywords: "audit price changes log", to: (s) => `${slugBase(s)}/pricing/history` },
  { id: "finance", label: "Finance", group: "Revenue & Money", icon: ReceiptText, keywords: "p&l profit accounts", to: (s) => `${slugBase(s)}/finance` },
  { id: "finance-budgets", label: "Budgets", group: "Revenue & Money", icon: PiggyBank, keywords: "finance budget plan", to: (s) => `${slugBase(s)}/finance/budgets` },
  { id: "finance-expenses", label: "Expenses", group: "Revenue & Money", icon: ReceiptText, keywords: "finance cost spend", to: (s) => `${slugBase(s)}/finance/expenses` },

  // ── Growth ──
  { id: "leads", label: "Leads (CRM)", group: "Growth", icon: Megaphone, keywords: "crm enquiry prospect pipeline", to: (s) => `${slugBase(s)}/leads` },
  { id: "follow-up", label: "Follow-up Radar", group: "Growth", icon: Radar, keywords: "reminder chase lead", to: (s) => `${slugBase(s)}/follow-up` },
  { id: "quote-drafts", label: "Quote Drafts", group: "Growth", icon: FileText, keywords: "quotation proposal", to: (s) => `${slugBase(s)}/quote-drafts` },
  { id: "partners", label: "Partners", group: "Growth", icon: Handshake, keywords: "agent travel partner commission", to: (s) => `${slugBase(s)}/partners` },
  { id: "drip", label: "Drip Campaigns", group: "Growth", icon: Workflow, keywords: "automation nurture sequence", to: (s) => `${slugBase(s)}/drip` },
  { id: "packages", label: "Packages", group: "Growth", icon: Package, keywords: "offer deal bundle", to: (s) => `${slugBase(s)}/packages` },
  { id: "seo-planner", label: "Local SEO Planner", group: "Growth", icon: Globe, keywords: "google landing search", to: (s) => `${slugBase(s)}/seo-planner` },
  { id: "visibility", label: "Visibility Score", group: "Growth", icon: Gauge, keywords: "gmb google business readiness", to: (s) => `${slugBase(s)}/visibility` },
  { id: "whatsapp", label: "WhatsApp Inbox", group: "Growth", icon: MessageCircle, keywords: "chat messages interakt", to: (s) => `${slugBase(s)}/whatsapp` },
  { id: "seasonal", label: "Seasonal Calendar", group: "Growth", icon: CalendarDays, keywords: "demand season peak", to: (s) => `${slugBase(s)}/seasonal` },
  { id: "ota", label: "OTA Optimizer", group: "Growth", icon: Globe, keywords: "channel listing booking.com mmt", to: (s) => `${slugBase(s)}/ota` },
  { id: "reviews", label: "Reviews", group: "Growth", icon: Star, keywords: "rating feedback guest", to: (s) => `${slugBase(s)}/reviews` },

  // ── Setup ──
  { id: "assets", label: "Digital Assets", group: "Setup", icon: Image, keywords: "photos logo brand media", to: (s) => `${slugBase(s)}/assets` },
  { id: "import-bookings", label: "Import Bookings", group: "Setup", icon: Upload, keywords: "csv upload migrate", to: (s) => `${slugBase(s)}/import-bookings` },
  { id: "settings", label: "Settings", group: "Setup", icon: Settings, keywords: "config preferences hotel", to: (s) => `${slugBase(s)}/settings` },
  { id: "services", label: "Services & SLA", group: "Setup", icon: Building2, keywords: "department sla service request", to: () => `/owner/services` },
];
