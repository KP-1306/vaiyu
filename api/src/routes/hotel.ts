import { Router } from "express";
import { getHotel, upsertHotel } from "../state";

const router = Router();

router.get("/:slug", (req, res) => {
  const h = getHotel(req.params.slug);
  if (!h) return res.status(404).json({ error: "Not found" });
  res.json(h);
});

router.post("/upsert", (req, res) => {
  const { slug, name } = req.body || {};
  if (!slug || !name) return res.status(400).json({ error: "slug & name required" });
  const saved = upsertHotel(req.body);
  res.json(saved);
});

export default router;
