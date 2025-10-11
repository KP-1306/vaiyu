import { Link, useLocation } from "react-router-dom";

export default function GuestShell({
  hotelName = "Sunrise Resort",
  brand = "#145AF2",
  children,
}: {
  hotelName?: string;
  brand?: string;
  children: React.ReactNode;
}) {
  const loc = useLocation();
  const is = (p: string) => loc.pathname.startsWith(p);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-gray-100">
        <div className="h-14 px-4 flex items-center justify-between">
          <Link to="/" className="font-semibold tracking-tight">
            <span style={{ color: brand }}>VA</span>iyu
          </Link>
          <div className="text-sm font-medium">{hotelName}</div>
          <Link to="/guest/credits" className="text-sm underline">Credits</Link>
        </div>
      </header>

      {/* Page */}
      <main className="flex-1">{children}</main>

      {/* Bottom tabs (mobile) */}
      <nav className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-gray-200">
        <div className="grid grid-cols-4 text-sm">
          <Tab to="/stay/DEMO" label="Home" active={is("/stay")} />
          <Tab to="/stay/DEMO/menu" label="Order" active={is("/stay/DEMO/menu")} />
          <Tab to="/tickets" label="Requests" active={is("/tickets")} />
          <Tab to="/guest/profile" label="Profile" active={is("/guest/profile")} />
        </div>
      </nav>
    </div>
  );
}

function Tab({ to, label, active }: { to: string; label: string; active?: boolean }) {
  return (
    <Link
      to={to}
      className={
        "py-2 text-center " +
        (active ? "text-sky-700 font-medium" : "text-gray-600 hover:text-gray-800")
      }
    >
      {label}
    </Link>
  );
}
