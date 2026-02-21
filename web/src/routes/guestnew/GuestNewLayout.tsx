// GuestNewLayout.tsx — Shared layout with persistent bottom navigation
import { Outlet, NavLink, useLocation, Link } from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabase";
import "./guestnew.css";
import AccountControls from "../../components/AccountControls";

type NavItem = {
    label: string;
    to: string;
    icon: string;
};

const bottomNavItems: NavItem[] = [
    { label: "Home", to: "/guest", icon: "🏠" },
    { label: "Trips", to: "/guest/trips", icon: "🧳" },
    { label: "Rewards", to: "/guest/rewards", icon: "🎁" },
    { label: "Support", to: "/guest/support", icon: "❓" },
];

export default function GuestNewLayout() {
    const location = useLocation();
    const [email, setEmail] = useState<string | null>(null);
    const [displayName, setDisplayName] = useState<string | null>(null);
    const [tierPoints, setTierPoints] = useState(0);

    // Auth guard and user info
    useEffect(() => {
        let mounted = true;

        (async () => {
            const { data } = await supabase.auth
                .getSession()
                .catch(() => ({ data: { session: null } }));

            if (!mounted) return;

            if (!data.session) {
                const redirect = encodeURIComponent("/guest");
                window.location.replace(`/signin?intent=signin&redirect=${redirect}`);
                return;
            }

            const user = data.session.user;
            setEmail(user?.email ?? null);
            setDisplayName(
                (user?.user_metadata?.name as string) ??
                user?.user_metadata?.full_name ??
                null
            );

            // Fetch profile for display name
            if (user?.id) {
                const { data: prof } = await supabase
                    .from("profiles")
                    .select("full_name")
                    .eq("id", user.id)
                    .maybeSingle();
                if (prof?.full_name?.trim()) {
                    setDisplayName(prof.full_name.trim());
                }
            }
        })();

        return () => {
            mounted = false;
        };
    }, []);

    const initials = useMemo(() => {
        const name = displayName || email || "G";
        return name
            .split(" ")
            .filter(Boolean)
            .map((p) => p[0])
            .join("")
            .slice(0, 2)
            .toUpperCase();
    }, [displayName, email]);

    return (
        <div className="guestnew">
            {/* Header */}
            <header className="gn-header">
                <Link to="/guest" className="gn-header__logo">
                    <img src="/brand/vaiyu-logo.png" alt="Vaiyu" />
                    <span>Vaiyu</span>
                </Link>

                <div className="gn-header__actions">
                    {/* Search (desktop only) */}
                    <div className="gn-header__search gn-desktop-only">
                        <span>🔍</span>
                        <input type="text" placeholder="Search booking, hotel, city..." />
                        <button className="gn-btn gn-btn--secondary" style={{ padding: "4px 12px" }}>
                            Search
                        </button>
                    </div>

                    {/* Rewards pill */}
                    <div className="gn-header__pill gn-desktop-only">
                        <span className="gn-header__tier">Platinum</span>
                        <span>-</span>
                        <span className="gn-header__points">{tierPoints} pts</span>
                    </div>

                    {/* Notifications */}
                    <button className="gn-btn gn-btn--icon gn-btn--secondary">
                        🔔
                    </button>

                    {/* Avatar Dropdown */}
                    <div style={{ marginLeft: "12px", zIndex: 50, position: 'relative' }}>
                        <AccountControls
                            theme="dark"
                            buttonClassName="h-10 w-10 bg-[#dbae67] text-black text-sm font-bold hover:bg-[#e5bc7d]"
                        />
                    </div>
                </div>
            </header>

            {/* Main content area */}
            <div className="guestnew-content">
                <Outlet />
            </div>

            {/* Floating Support Button */}
            <div className="gn-floating-support">
                <Link to="/guest/support" className="gn-floating-support__btn">
                    💬 <span>Support</span> <span>›</span>
                </Link>
            </div>

            {/* Bottom Navigation */}
            <nav className="gn-bottom-nav">
                <div className="gn-bottom-nav__inner">
                    {bottomNavItems.map((item) => {
                        const isActive =
                            item.to === "/guest"
                                ? location.pathname === "/guest"
                                : location.pathname.startsWith(item.to);

                        return (
                            <NavLink
                                key={item.to}
                                to={item.to}
                                className={`gn-bottom-nav__item ${isActive ? "gn-bottom-nav__item--active" : ""}`}
                            >
                                <span className="gn-bottom-nav__icon">{item.icon}</span>
                                <span>{item.label}</span>
                            </NavLink>
                        );
                    })}
                </div>
            </nav>
        </div>
    );
}
