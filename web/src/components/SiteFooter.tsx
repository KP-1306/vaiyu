import { Link } from "react-router-dom";

export default function SiteFooter() {
  return (
    <footer className="border-t border-gray-200">
      <div className="mx-auto max-w-7xl px-4 py-8 text-sm text-gray-600 flex flex-wrap items-center justify-between gap-3">
        <div>© {new Date().getFullYear()} VAiyu — Where Intelligence Meets Comfort.</div>

        <nav className="flex items-center gap-4">
          <Link className="hover:text-gray-800" to="/about-ai">AI</Link>
          <Link className="hover:text-gray-800" to="/#why">Why VAiyu</Link>
          <Link className="hover:text-gray-800" to="/owner">For Hotels</Link>
          <Link className="hover:text-gray-800" to="/#demo">Live Demo</Link>
          <Link className="hover:text-gray-800" to="/about">About</Link>
          <Link className="hover:text-gray-800" to="/press">Press</Link>
          <Link className="hover:text-gray-800" to="/privacy">Privacy</Link>
          <Link className="hover:text-gray-800" to="/terms">Terms</Link>
          <Link className="hover:text-gray-800" to="/contact">Contact</Link>
          <Link className="hover:text-gray-800" to="/careers">Careers</Link>
        </nav>
      </div>
    </footer>
  );
}
