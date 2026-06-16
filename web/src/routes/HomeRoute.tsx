// web/src/routes/HomeRoute.tsx
//
// Landing page ("/") for the owner/marketing site.
//
// This is the homepage slice extracted verbatim from the former App.tsx. App.tsx
// was a legacy <Routes> tree mounted only at the data-router's index route
// ("/"), so the ONLY behaviour it actually reached was this: render the marketing
// Header + MarketingHome, and run the deep-link handler. Every other route in the
// old App.tsx was shadowed by the canonical routes in main.tsx. Preserving that
// exact behaviour here lets main.tsx point its index route straight at this
// component and retire App.tsx without any functional change.

import { Suspense, lazy, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Header from "../components/Header";

const MarketingHome = lazy(() => import("./MarketingHome"));

const PageSpinner = () => (
  <div className="grid min-h-[40vh] place-items-center text-sm text-gray-500">
    Loading…
  </div>
);

// Handle deep-links that land on "/" with a query param — ported verbatim from
// the old App.tsx so notification/email links and the 404.html bounce keep
// resolving to the request tracker.
function useDeepLinkHandler() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ticketId = params.get("ticketId");
    const from = params.get("from");

    // 1) Direct ticketId param, e.g. "/?ticketId=UUID"
    if (ticketId) {
      console.debug("[VAiyu_FE] DeepLink: ticketId param detected", {
        ticketId,
        pathname: location.pathname,
        search: location.search,
      });

      navigate(`/requestTracker/${encodeURIComponent(ticketId)}`, {
        replace: true,
      });
      return;
    }

    // 2) Bounce from 404.html: "/?from=/requestTracker/UUID"
    if (from) {
      try {
        const url = new URL(from, window.location.origin);
        if (url.pathname.startsWith("/requestTracker/")) {
          const id = url.pathname.split("/requestTracker/")[1] || "";
          if (id) {
            console.debug(
              "[VAiyu_FE] DeepLink: from param for requestTracker",
              {
                from,
                id,
              },
            );
            navigate(`/requestTracker/${encodeURIComponent(id)}`, {
              replace: true,
            });
          }
        } else {
          console.debug("[VAiyu_FE] DeepLink: from param (non-requestTracker)", {
            from,
          });
        }
      } catch (err) {
        console.warn("[VAiyu_FE] DeepLink: failed to parse 'from' param", err);
      }
    }
  }, [location.pathname, location.search, navigate]);
}

export default function HomeRoute() {
  useDeepLinkHandler();

  return (
    <Suspense fallback={<PageSpinner />}>
      <div className="min-h-screen bg-white flex flex-col">
        <Header />
        <main className="flex-1">
          <MarketingHome />
        </main>
      </div>
    </Suspense>
  );
}
