-- Fix service descriptions by matching on Labels (case-insensitive)

-- 1. First, trust existing 'description' column if it has data
UPDATE services 
SET description_en = description 
WHERE description IS NOT NULL AND description <> '' AND (description_en IS NULL OR description_en = '');

-- 2. Then backfill missing ones from our predefined list
-- Housekeeping
UPDATE services SET description_en = 'Schedule a full room cleaning service.' 
WHERE (description_en IS NULL OR description_en = '') AND label ILIKE '%Room Cleaning%';

UPDATE services SET description_en = 'Request evening turn down service.' 
WHERE (description_en IS NULL OR description_en = '') AND label ILIKE '%Turn Down%';

UPDATE services SET description_en = 'Request fresh towels and toiletries.' 
WHERE (description_en IS NULL OR description_en = '') AND label ILIKE '%Towel%';

UPDATE services SET description_en = 'Request extra pillows or blankets.' 
WHERE (description_en IS NULL OR description_en = '') AND label ILIKE '%Pillow%';

UPDATE services SET description_en = 'Request fresh linen change.' 
WHERE (description_en IS NULL OR description_en = '') AND label ILIKE '%Linen%';

UPDATE services SET description_en = 'Request laundry pickup.' 
WHERE (description_en IS NULL OR description_en = '') AND label ILIKE '%Laundry%';

-- Maintenance
UPDATE services SET description_en = 'Report plumbing issues like leaks or clogs.' 
WHERE (description_en IS NULL OR description_en = '') AND label ILIKE '%Plumbing%';

UPDATE services SET description_en = 'Report issues with lights or power.' 
WHERE (description_en IS NULL OR description_en = '') AND label ILIKE '%Electric%';

UPDATE services SET description_en = 'Maintenace for furniture, doors, or windows.' 
WHERE (description_en IS NULL OR description_en = '') AND label ILIKE '%Maintenance%';

UPDATE services SET description_en = 'Report AC or heating issues.' 
WHERE (description_en IS NULL OR description_en = '') AND label ILIKE '%AC%' OR label ILIKE '%Heating%';

-- F&B
UPDATE services SET description_en = 'Order water bottles to your room.' 
WHERE (description_en IS NULL OR description_en = '') AND label ILIKE '%Water%';

UPDATE services SET description_en = 'Request cutlery, plates, or glasses.' 
WHERE (description_en IS NULL OR description_en = '') AND label ILIKE '%Cutlery%' OR label ILIKE '%Plate%';

UPDATE services SET description_en = 'Request removal of trays or trash.' 
WHERE (description_en IS NULL OR description_en = '') AND label ILIKE '%Tray%' OR label ILIKE '%Trash%';

UPDATE services SET description_en = 'Request ice delivery.' 
WHERE (description_en IS NULL OR description_en = '') AND label ILIKE '%Ice%';

-- Front Desk
UPDATE services SET description_en = 'Request luggage assistance.' 
WHERE (description_en IS NULL OR description_en = '') AND label ILIKE '%Luggage%';

UPDATE services SET description_en = 'Request a wake-up call.', requires_description = true
WHERE (description_en IS NULL OR description_en = '') AND label ILIKE '%Wake%';

UPDATE services SET description_en = 'Report lost items.', requires_description = true
WHERE (description_en IS NULL OR description_en = '') AND label ILIKE '%Lost%';

UPDATE services SET description_en = 'Help with transportation or taxi.' 
WHERE (description_en IS NULL OR description_en = '') AND label ILIKE '%Taxi%' OR label ILIKE '%Transport%';

-- 3. Finally, sync back to description (so they are identical)
UPDATE services SET description = description_en WHERE description_en IS NOT NULL;

