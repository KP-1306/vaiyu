import { Link, useLocation } from "react-router-dom";
import SEO from "../components/SEO";

export default function NotFound() {
  const loc = useLocation();
  const site = typeof window !== "undefined" ? window.location.origin : "https://vaiyu.co.in";

  return (
    <main className="min-h-screen grid place-items-center px-4">
      <SEO
        title="404 — Page not found"
        description="The page you’re looking for doesn’t exist."
        canonical={`${site}${loc.pathname}`}
        noIndex
      />
      <div className="max-w-md text-center">
        <div className="text-7xl font-bold">404</div>
        <p className="mt-2 text-gray-600">
          We couldn’t find <code className="px-1 py-0.5 rounded bg-gray-100">{loc.pathname}</code>.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link to="/" className="btn">Go home</Link>
          <Link to="/contact" className="btn btn-light">Contact us</Link>
        </div>
      </div>
    </main>
  );
}
