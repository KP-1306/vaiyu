// In-memory state so API works without a DB

export type Theme = { brand?: string; mode?: "light" | "dark" };
export type Hotel = {
  slug: string; name: string; logo_url?: string; address?: string; about?: string;
  amenities?: string[]; phone?: string; email?: string; theme?: Theme;
};
export type Room = { hotel_slug: string; room_no: string; room_type: string; is_clean: boolean; is_occupied: boolean };
export type BookingStatus = "booked" | "checked_in" | "completed" | "cancelled";
export type Booking = {
  id: number; hotel_slug: string; guest_name: string; guest_phone: string;
  code: string; room_type: string; status: BookingStatus; room_no?: string;
};
export type Review = {
  id: number; hotel_slug: string; rating: number; title?: string; body?: string;
  verified: boolean; created_at: string; guest_name?: string;
};

const hotels: Record<string, Hotel> = {};
let rooms: Room[] = [];
let bookings: Booking[] = [];
let reviews: Review[] = [];
let idCounter = 1;

function seedOnce() {
  if (!hotels["vaiyu"]) {
    hotels["vaiyu"] = {
      slug: "vaiyu",
      name: "VAiyu Hotel",
      address: "Mall Road, Nainital, Uttarakhand",
      about: "A calm lake-view property with quick digital check-in.",
      amenities: ["WiFi", "Parking", "Breakfast", "Pet Friendly"],
      phone: "+91-99999-99999",
      email: "hello@vaiyu.com",
      theme: { brand: "#145AF2", mode: "light" }
    };
  }
  if (rooms.length === 0) {
    rooms = [
      { hotel_slug:"vaiyu", room_no:"101", room_type:"standard", is_clean:true,  is_occupied:false },
      { hotel_slug:"vaiyu", room_no:"102", room_type:"standard", is_clean:true,  is_occupied:false },
      { hotel_slug:"vaiyu", room_no:"201", room_type:"deluxe",   is_clean:true,  is_occupied:false },
      { hotel_slug:"vaiyu", room_no:"301", room_type:"suite",    is_clean:false, is_occupied:false },
    ];
  }
  if (bookings.length === 0) {
    bookings = [
      { id:idCounter++, hotel_slug:"vaiyu", guest_name:"Test Guest", guest_phone:"9999999999", code:"ABC123", room_type:"standard", status:"booked" }
    ];
  }
}
seedOnce();

// --- Hotel
export function getHotel(slug: string): Hotel | undefined { return hotels[slug]; }
export function upsertHotel(h: Hotel): Hotel { hotels[h.slug] = { ...hotels[h.slug], ...h }; return hotels[h.slug]; }

// --- Check-in
export function findBookingForCheckin(code: string, phone: string): Booking | undefined {
  return bookings.find(b => b.code === code && b.guest_phone === phone && b.status === "booked");
}
export function assignRoomForBooking(b: Booking): { room_no: string; room_type: string } | null {
  // pass 1: by requested type
  let r = rooms.find(x => x.hotel_slug===b.hotel_slug && x.room_type===b.room_type && x.is_clean && !x.is_occupied);
  // pass 2: any clean & free
  if (!r) r = rooms.find(x => x.hotel_slug===b.hotel_slug && x.is_clean && !x.is_occupied);
  if (!r) return null;

  // mark occupied + update booking
  r.is_occupied = true;
  b.status = "checked_in";
  b.room_no = r.room_no;
  return { room_no: r.room_no, room_type: r.room_type };
}

// --- Reviews
export function listReviews(slug: string): Review[] {
  return reviews.filter(r => r.hotel_slug === slug).sort((a,b)=>+new Date(b.created_at)-+new Date(a.created_at));
}
export function addReview(bookingCode: string, rating: number, title?: string, body?: string): Review | null {
  const b = bookings.find(x => x.code === bookingCode);
  if (!b) return null;
  const item: Review = {
    id: (reviews.at(-1)?.id || 0) + 1,
    hotel_slug: b.hotel_slug,
    rating, title, body,
    verified: b.status === "completed",
    created_at: new Date().toISOString(),
    guest_name: b.guest_name
  };
  reviews.unshift(item);
  return item;
}

// Optional helpers to flip mock booking status when you need "verified"
export function setBookingStatus(code: string, status: BookingStatus) {
  const b = bookings.find(x => x.code === code); if (b) b.status = status;
}
