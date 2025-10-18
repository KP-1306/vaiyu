import React, { useRef } from "react";
import { motion, useInView } from "framer-motion";

/**
 * STORY RIBBON — Onboarding • Security • Integrations
 * - A thin animated progress line runs left→right when the section enters view
 * - Three frames appear in sequence (staggered) to tell the story
 * - No external assets; inline icons; mobile-friendly
 */

export default function StoryRibbon_OnboardingSecurityIntegrations() {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  const container = {
    hidden: { opacity: 0, y: 12 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.4, staggerChildren: 0.18 },
    },
  };

  const item = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0, transition: { duration: 0.45 } },
  };

  return (
    <section id="ribbon" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Heading */}
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-semibold text-gray-900">
            Onboarding • Security • Integrations
          </h2>
          <p className="mt-3 text-gray-600 max-w-2xl mx-auto text-lg">
            Speed to value in a day. Enterprise-secure. Connects to what you already use.
          </p>
        </div>

        {/* Progress line (animates width) */}
        <div className="relative mb-8">
          <div className="h-[2px] w-full bg-gray-200 rounded-full" />
          <motion.div
            aria-hidden="true"
            className="absolute inset-y-0 left-0 h-[2px] rounded-full bg-gradient-to-r from-blue-600 via-emerald-500 to-amber-500"
            initial={{ width: 0 }}
            animate={{ width: inView ? "100%" : 0 }}
            transition={{ duration: 1.1, ease: "easeInOut" }}
          />
        </div>

        {/* Ribbon frames */}
        <motion.div
          ref={ref}
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
          className="grid gap-6 md:grid-cols-3"
        >
          {/* A) 1-Day Onboarding */}
          <motion.article variants={item} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <FrameHeader
              icon={<IconBolt className="text-blue-600" />}
              label="1-Day Onboarding"
            />
            <ol className="mt-4 space-y-3 text-gray-800">
              <StepDot n={1} title="Connect hotel" body="Create property & services" />
              <StepDot n={2} title="Turn on guest links" body="Pre-check-in, requests, menu" />
              <StepDot n={3} title="Train staff (45 min)" body="HK + Front Desk workflows" />
              <StepDot n={4} title="Go live" body="Monitor SLAs + AI review drafts" />
            </ol>
            <p className="mt-4 text-sm text-gray-500 italic">White-glove setup available.</p>
          </motion.article>

          {/* B) Security & Compliance */}
          <motion.article variants={item} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <FrameHeader
              icon={<IconShield className="text-emerald-600" />}
              label="Security & Compliance"
            />
            <ul className="mt-4 space-y-3 text-gray-800">
              <TrustRow icon={<IconCheck className="text-emerald-600" />} title="Supabase RLS" body="Row-level security; signed JWTs" />
              <TrustRow icon={<IconCheck className="text-emerald-600" />} title="Data region" body="India by default, or your choice" />
              <TrustRow icon={<IconCheck className="text-emerald-600" />} title="Backups & audit logs" body="Daily backups + access trails" />
              <TrustRow icon={<IconCheck className="text-emerald-600" />} title="Uptime 99.9%" body={<a href="/status" className="underline decoration-dotted hover:decoration-solid">Status page</a>} />
            </ul>
            <span className="mt-4 inline-block rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-medium text-emerald-700">
              Enterprise-grade
            </span>
          </motion.article>

          {/* C) Integrations */}
          <motion.article variants={item} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <FrameHeader
              icon={<IconNodes className="text-amber-600" />}
              label="Integrations"
            />
            <div className="mt-4 grid grid-cols-2 gap-3 text-gray-800">
              <LogoTile label="PMS" badge="Coming soon" />
              <LogoTile label="Email" />
              <LogoTile label="SMS" />
              <LogoTile label="WhatsApp" badge="Beta" />
              <LogoTile label="UPI" />
              <LogoTile label="Cards" />
              <LogoTile label="Netlify" />
              <LogoTile label="Supabase" />
            </div>
            <div className="mt-4 text-sm text-gray-500">
              Transparent roadmap. Owners appreciate clarity.
            </div>
          </motion.article>
        </motion.div>

        {/* CTA row (small) */}
        <div className="mt-8 flex justify-end">
          <a
            href="/status"
            className="text-sm text-gray-700 underline decoration-dotted hover:decoration-solid"
          >
            See full checklist →
          </a>
        </div>
      </div>
    </section>
  );
}

/* ---------- subcomponents ---------- */

function FrameHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-9 w-9 grid place-items-center rounded-xl bg-gray-100">{icon}</div>
      <h3 className="text-lg font-semibold text-gray-900">{label}</h3>
    </div>
  );
}

function StepDot({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex items-start gap-3">
      <div className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-blue-600 text-white grid place-items-center text-xs font-bold">
        {n}
      </div>
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-sm text-gray-600">{body}</div>
      </div>
    </li>
  );
}

function TrustRow({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <div className="mt-0.5">{icon}</div>
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-sm text-gray-600">{body}</div>
      </div>
    </li>
  );
}

function LogoTile({ label, badge }: { label: string; badge?: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white/90 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        <span className="font-medium">{label}</span>
      </div>
      {badge ? (
        <span className="rounded-full bg-gray-100 border border-gray-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-600">
          {badge}
        </span>
      ) : null}
    </div>
  );
}

/* ---------- inline icons ---------- */

function IconBolt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-5 w-5 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M13 3L4 14h6l-1 7 9-11h-6l1-7z" />
    </svg>
  );
}
function IconShield({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-5 w-5 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 3l7 3v6c0 4.4-3.1 8-7 8s-7-3.6-7-8V6l7-3z" />
      <path d="M9.5 12.5l2 2 3.5-3.5" />
    </svg>
  );
}
function IconNodes({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-5 w-5 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="18" cy="18" r="3" />
      <path d="M8.2 10.6 15.8 7.4M8.2 13.4 15.8 16.6" />
    </svg>
  );
}
function IconCheck({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-5 w-5 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 12l4 4L19 6" />
    </svg>
  );
}
