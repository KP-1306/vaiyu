// web/src/lib/roles.ts
export type HotelRole = "owner" | "manager" | "staff" | "viewer" | "guest";

export function canViewHRMS(role: HotelRole) {
  return role === "owner" || role === "manager";
}
export function isStaff(role: HotelRole) {
  return role === "staff" || role === "manager";
}
