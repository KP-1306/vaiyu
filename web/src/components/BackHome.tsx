import { Link, useLocation } from 'react-router-dom';

export default function BackHome() {
  const { pathname } = useLocation();
  // Hide on landing
  if (pathname === '/' || pathname === '') return null;

  return (
    <div className="fixed left-3 top-3 z-[60]">
      <Link
        to="/"
        className="rounded-full bg-white/85 backdrop-blur px-3 py-1.5 text-sm border border-gray-200 shadow-sm hover:bg-white"
        aria-label="Back to website"
      >
        ← Back to website
      </Link>
    </div>
  );
}
