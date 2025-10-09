import { Router } from "express";
import { findBookingForCheckin, assignRoomForBooking } from "../state";

const router = Router();

router.post("/", (req, res) => {
  const { code, phone } = req.body || {};
  if (!code || !phone) return res.status(400).json({ error: "code & phone are required" });

  const booking = findBookingForCheckin(code, phone);
  if (!booking) return res.status(404).json({ error: "Booking not found or not eligible" });

  const room = assignRoomForBooking(booking);
  if (!room) return res.status(409).json({ error: "No rooms available right now" });

  res.json({ message: "Checked in", booking, room });
});

export default router;
