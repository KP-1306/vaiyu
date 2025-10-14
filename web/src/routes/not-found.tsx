import { Link } from "react-router-dom";
import SEO from "../components/SEO";
export default function NotFound() {
  return (
    <main className="min-h-[60vh] grid place-items-center px-6">
      <SEO title="Page not found" />
      <div className="text-center">
        <h1 className="text-5xl font-bold">404</h1>
        <p className="mt-2 text-gray-600">We couldn’t find that page.</p>
        <Link to="/" className="mt-6 inline-block px-4 py-2 rounded-xl bg-brand.primary text-white">Back home</Link>
      </div>
    </main>
  );
}
