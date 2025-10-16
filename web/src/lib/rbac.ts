export type Role = "owner" | "manager" | "staff" | "guest";
export const hasRole = (userRole?: Role, allowed: Role[] = []) =>
  allowed.length === 0 ? true : !!userRole && allowed.includes(userRole);
