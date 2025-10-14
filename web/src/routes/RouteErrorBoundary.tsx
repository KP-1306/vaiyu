import { Link, useRouteError } from "react-router-dom";
import { useEffect } from "react";
import { captureError } from "../lib/sentry";

export default function RouteErrorBoundary() {
  const error = useRouteError() as any;

  useEffect(() => {
    if (error) captureError(error, { where: "RouteErrorBoundary" });
  }, [error]);

  return (
    <main className="min-h-[60vh] grid place-items-center px-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">Oops — this route broke</h1>
        <p className="text-gray-600 mt-1 text-sm">
          {error?.statusText || error?.message || "Unknown error"}
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <button className="btn" onClick={() => location.reload()}>Reload</button>
          <Link className="btn btn-light" to="/">Back home</Link>
        </div>
      </div>
    </main>
  );
}
