// web/src/components/Protected.tsx
import { Navigate, Outlet } from "react-router-dom";
import { useRole } from "../context/RoleContext";
import { canViewHRMS, isStaff } from "../lib/roles";

export function RequireOwnerHRMS() {
  const { current } = useRole();
  return canViewHRMS(current.role) ? <Outlet /> : <Navigate to="/" replace />;
}
export function RequireStaff() {
  const { current } = useRole();
  return isStaff(current.role) ? <Outlet /> : <Navigate to="/" replace />;
}
