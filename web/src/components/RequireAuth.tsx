// web/src/components/RequireAuth.tsx
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function RequireAuth({ children }: { children: JSX.Element }) {
  const { loading, user } = useAuth();
  const loc = useLocation();

  if (loading) return null; // or a spinner
  if (!user) {
    const redirect = encodeURIComponent(loc.pathname + loc.search);
    return <Navigate to={`/signin?intent=signin&redirect=${redirect}`} replace />;
  }
  return children;
}
