✅ Full Flow: Guest Creates a Service Request
Let’s walk through it step by step.

1️⃣ Guest checks in (earlier in the journey)
Somewhere in your system (already or soon), you have:

guest_stays / bookings / checkins
Example row:

guest_id = g123
hotel_id = h1
room_id = r203
status = CHECKED_IN
👉 This is the single source of truth for the guest’s room.

2️⃣ Guest opens the app (session context is built)
When the guest logs in or opens the guest dashboard:
Backend/API does:

SELECT room_id
FROM guest_stays
WHERE guest_id = :guest_id
  AND status = 'CHECKED_IN';
Frontend stores this in memory:

guestContext = {
  hotelId: 'h1',
  roomId: 'r203',
  roomNumber: '203'
};
📌 This context lives in:
session
global store
React context
Redux
etc.

3️⃣ Guest views Services list
Frontend loads:

SELECT *
FROM services
WHERE hotel_id = :hotel_id
  AND active = true;
This shows:

🧺 Extra Towel
🧹 Room Cleaning
❄️ AC Not Cooling
❌ No room info here✅ Correct by design

4️⃣ Guest clicks “Request Now” on a service
At this moment, the frontend already knows:
service.department_id
guestContext.roomId
So the UI builds the request:

supabase.rpc('create_service_request', {
  p_hotel_id: guestContext.hotelId,
  p_department_id: service.department_id,
  p_room_id: guestContext.roomId,     // ⭐ THIS IS THE KEY
  p_zone_id: null,
  p_title: service.label,
  p_description: userNotes,
  p_created_by_type: 'GUEST',
  p_created_by_id: null
});
👉 This is where the room is attached.
Not earlier.Not in services.Exactly here.

5️⃣ Backend creates the ticket (what gets stored)
In tickets table:

id = t789
hotel_id = h1
service_department_id = housekeeping
room_id = r203
zone_id = null
title = "Extra Towel"
status = NEW
created_by_type = GUEST
📌 The room is now permanently attached to the ticket.

6️⃣ Staff sees the ticket (how room number appears)
Staff dashboard query (v_staff_runner_tickets):

LEFT JOIN rooms r ON r.id = t.room_id
UI displays:

Extra Towel
Room 203
Housekeeping
Staff never sees services directly — they see tickets, which already contain the room.

🧩 Why services MUST NOT store room info
Let’s be explicit:
❌ If services stored room info:
Services would become guest-specific (wrong)
Same service would need duplication per room
SLA logic breaks
Reporting becomes impossible
✅ With your design:
Services are reusable
Tickets are auditable
SLA works
Staff flow is clean

🛡️ Why your schema already supports this perfectly
Your tickets table already has:

room_id UUID,
zone_id UUID,
CHECK (
  (room_id IS NOT NULL AND zone_id IS NULL)
  OR
  (room_id IS NULL AND zone_id IS NOT NULL)
)
This enforces:
Guest → room-based ticket
Public area → zone-based ticket
Never ambiguous
That’s enterprise-grade correctness.

🔁 What happens for public areas (lobby, pool)?
Same flow, different context.
Front desk / staff UI:

supabase.rpc('create_service_request', {
  p_room_id: null,
  p_zone_id: selectedZoneId,
  ...
});
Guest UI:
never allowed to select zone

✅ Final mental model (memorize this)
Services describe availability.Guest context provides location.Tickets bind them together.

🚀 You’re actually done architecturally
Nothing in your schema needs redesign for this.
You just need to ensure:
Guest session always resolves room_id
UI passes it to the RPC
No fallback demo logic hides real errors
If you want next, I can:
Validate your guest-stay table
Help you design active_guest_context API
Add frontend guards to prevent “missing room” errors forever
Just tell me 👍



