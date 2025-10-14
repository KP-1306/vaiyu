import SEO from "../components/SEO";
import { Link } from "react-router-dom";

export default function Thanks() {
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-12 space-y-4">
      <SEO title="Thanks" canonical={`${location.origin}/thanks`} />
      <h1 className="text-2xl font-semibold">Thanks — we’ll be in touch.</h1>
      <p className="text-gray-600">
        Your request has been received. We usually reply within one business day.
      </p>
      <div>
        <Link to="/" className="btn btn-light">Back to home</Link>
      </div>
    </main>
  );
}
