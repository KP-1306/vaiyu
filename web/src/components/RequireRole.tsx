import { PropsWithChildren } from "react";
import { hasRole, Role } from "@/lib/rbac";
import NoAccess from "./NoAccess";

type Props = PropsWithChildren<{ role?: Role; allowed?: Role[] }>;

export default function RequireRole({ role = "guest", allowed = [], children }: Props) {
  return hasRole(role, allowed) ? <>{children}</> : <NoAccess />;
}
