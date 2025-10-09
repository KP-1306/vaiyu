import { Router } from "express";
import { getHotel, listReviews, addReview } from "../state";

const router = Router();

router.get("/:slug", (req, res) => {
  const h = getHotel(req.params.slug);
  if (!h) return res.status(404).json({ error: "Hotel not found" });
  res.json(listReviews(req.params.slug));
});

router.post("/", (req, res) => {
  const { bookingCode, rating, title, body } = req.body || {};
  if (!bookingCode || !rating) return res.status(400).json({ error: "bookingCode & rating required" });
  const r = addReview(bookingCode, rating, title, body);
  if (!r) return res.status(404).json({ error: "Booking not found" });
  res.json(r);
});

export default router;
