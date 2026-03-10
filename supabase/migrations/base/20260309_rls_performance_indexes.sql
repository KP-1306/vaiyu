-- Migration: RLS Performance Indexes
-- Speed up security checks for hotel memberships and roles

CREATE INDEX IF NOT EXISTS idx_hotel_members_user_hotel 
ON public.hotel_members(user_id, hotel_id);

CREATE INDEX IF NOT EXISTS idx_hotel_member_roles_member 
ON public.hotel_member_roles(hotel_member_id);
