import { Link, NavLink } from "react-router-dom";
import LogoLockup from "./LogoLockup"; // optional; remove if you don't want the wordmark

export default function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-black/10 mt-16">
      <div className="mx-auto max-w-6xl px-4 py-8 flex flex-col gap-6">
        {/* Top row */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <LogoLockup size="sm" />
            <span className="text-sm text-gray-600">
              © {year} VAiyu — Where Intelligence Meets Comfort.
            </span>
          </div>

          {/* Legal quick links */}
          <nav aria-label="Legal" className="flex gap-4 text-sm text-gray-700">
            <NavLink to="/privacy" className="hover:underline">Privacy</NavLink>
            <NavLink to="/terms" className="hover:underline">Terms</NavLink>
          </nav>
        </div>

        {/* Link clusters */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 text-sm text-gray-700">
          <nav aria-label="About" className="flex flex-col gap-2">
            {/* Ensure these paths match your router config exactly */}
            <NavLink to="/about-ai" className="hover:underline">AI</NavLink>
            <NavLink to="/why" className="hover:underline">Why VAiyu</NavLink>
            <NavLink to="/about" className="hover:underline">About</NavLink>
            <NavLink to="/press" className="hover:underline">Press</NavLink>
          </nav>

          <nav aria-label="Product" className="flex flex-col gap-2">
            <NavLink to="/owner" className="hover:underline">For Hotels</NavLink>
            <NavLink to="/demo" className="hover:underline">Live Demo</NavLink>
            <NavLink to="/requesttracker" className="hover:underline">Requests</NavLink>
            <NavLink to="/grid" className="hover:underline">Grid Ops</NavLink>
          </nav>

          <nav aria-label="Company" className="flex flex-col gap-2">
            <NavLink to="/careers" className="hover:underline">Careers</NavLink>
            <NavLink to="/contact" className="hover:underline">Contact</NavLink>
            <NavLink to="/website" className="hover:underline">Website Kit</NavLink>
            <NavLink to="/status" className="hover:underline">Status</NavLink>

          </nav>

          {/* Socials placeholder (add real URLs when ready) */}
          <nav aria-label="Social" className="flex flex-col gap-2">
            <a href="https://x.com/yourhandle" target="_blank" rel="noopener noreferrer" className="hover:underline">X (Twitter)</a>
            <a href="https://www.linkedin.com/company/yourpage" target="_blank" rel="noopener noreferrer" className="hover:underline">LinkedIn</a>
            <a href="mailto:hello@vaiyu.app" className="hover:underline">Email</a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
