import { Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
import SiteFooter from "../components/SiteFooter";

/** Scroll to top on route changes (fixes “privacy opens at bottom” issue) */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as any });
  }, [pathname]);
  return null;
}

export default function BaseLayout() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
      <ScrollToTop />
      {/* Main page content */}
      <div className="flex-1">
        <Outlet />
      </div>
      {/* Global footer on every page */}
      <SiteFooter />
    </div>
  );
}
