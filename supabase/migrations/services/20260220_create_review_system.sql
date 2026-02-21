-- Enterprise Guest Review System (Production Hardened)
-- ============================================================

-- ── 1. Core Review Table ──
CREATE TABLE IF NOT EXISTS guest_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    stay_id UUID REFERENCES stays(id) ON DELETE SET NULL,
    guest_id UUID REFERENCES guests(id) ON DELETE SET NULL,

    overall_rating INTEGER NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
    review_text TEXT,

    -- AI Sentiment Analysis stubs
    sentiment_score NUMERIC(5,2), -- -1.0 to +1.0
    sentiment_label TEXT, -- positive, neutral, negative
    ai_keywords JSONB DEFAULT '[]'::jsonb,

    is_public BOOLEAN DEFAULT false,
    is_anonymous BOOLEAN DEFAULT false,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT uq_review_per_booking UNIQUE (booking_id),
    CONSTRAINT uq_guest_reviews_id_hotel UNIQUE (id, hotel_id) -- Support cross-hotel data integrity FKs
);

-- Gap 3/5: updated_at trigger & Missing Indexes
CREATE TRIGGER trg_guest_reviews_updated
BEFORE UPDATE ON guest_reviews
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_guest_reviews_hotel_id ON guest_reviews(hotel_id);
CREATE INDEX idx_guest_reviews_created_at ON guest_reviews(created_at);
CREATE INDEX idx_guest_reviews_overall_rating ON guest_reviews(overall_rating);

-- Gap 7: Performance Under Scale (Optimized for Metrics View)
CREATE INDEX idx_guest_reviews_metrics ON guest_reviews(hotel_id, overall_rating, created_at);

-- ── 2. Flexible Categories ──
CREATE TABLE IF NOT EXISTS review_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    label TEXT NOT NULL,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_category_per_hotel UNIQUE (hotel_id, code),
    CONSTRAINT uq_review_categories_id_hotel UNIQUE (id, hotel_id) -- Support cross-hotel data integrity FKs
);


-- ── 3. Category Specific Ratings ──
CREATE TABLE IF NOT EXISTS review_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
    review_id UUID NOT NULL,
    category_id UUID NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_review_category UNIQUE (review_id, category_id),
    
    -- Gap 2: Cross-Hotel Data Integrity
    CONSTRAINT fk_review_rating_category FOREIGN KEY (category_id, hotel_id) REFERENCES review_categories(id, hotel_id) ON DELETE CASCADE,
    CONSTRAINT fk_review_rating_review FOREIGN KEY (review_id, hotel_id) REFERENCES guest_reviews(id, hotel_id) ON DELETE CASCADE
);

CREATE INDEX idx_review_ratings_review_id ON review_ratings(review_id);


-- ── 4. Target Linking (Staff/Services) ──
CREATE TABLE IF NOT EXISTS review_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
    review_id UUID NOT NULL,
    target_type TEXT NOT NULL CHECK (target_type IN ('staff', 'service')),
    target_id UUID NOT NULL,
    rating INTEGER CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    
    CONSTRAINT fk_review_target_review FOREIGN KEY (review_id, hotel_id) REFERENCES guest_reviews(id, hotel_id) ON DELETE CASCADE
);

CREATE INDEX idx_review_targets_review_id ON review_targets(review_id);

-- Gap 9: Referential Integrity for Targets
-- Gap 1: SECURITY DEFINER Risk (added SET search_path)
CREATE OR REPLACE FUNCTION trg_validate_review_target()
RETURNS TRIGGER 
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF NEW.target_type = 'staff' THEN
        IF NOT EXISTS (SELECT 1 FROM hotel_members WHERE id = NEW.target_id AND hotel_id = NEW.hotel_id) THEN
            RAISE EXCEPTION 'Invalid staff member target constraint violation';
        END IF;
    ELSIF NEW.target_type = 'service' THEN
        IF NOT EXISTS (SELECT 1 FROM services WHERE id = NEW.target_id AND hotel_id = NEW.hotel_id) THEN
            RAISE EXCEPTION 'Invalid service target constraint violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_review_target_integrity
BEFORE INSERT OR UPDATE ON review_targets
FOR EACH ROW
EXECUTE FUNCTION trg_validate_review_target();


-- ── 5. Hotel Responses ──
CREATE TABLE IF NOT EXISTS review_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
    review_id UUID NOT NULL,
    responded_by UUID NOT NULL REFERENCES hotel_members(id),
    response_text TEXT NOT NULL,
    is_public BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    CONSTRAINT uq_public_response_per_review UNIQUE (review_id), -- One official response per review
    CONSTRAINT fk_review_response_review FOREIGN KEY (review_id, hotel_id) REFERENCES guest_reviews(id, hotel_id) ON DELETE CASCADE
);

CREATE TRIGGER trg_review_responses_updated
BEFORE UPDATE ON review_responses
FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 6. Operational Flags (Escalation) ──
CREATE TABLE IF NOT EXISTS review_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
    review_id UUID NOT NULL,
    flag_type TEXT NOT NULL CHECK (flag_type IN ('low_rating', 'complaint', 'legal', 'refund_request')),
    severity TEXT DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    assigned_to UUID REFERENCES hotel_members(id),
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    CONSTRAINT uq_flag_type_per_review UNIQUE (review_id, flag_type), -- Prevent duplicate flag types
    CONSTRAINT fk_review_flag_review FOREIGN KEY (review_id, hotel_id) REFERENCES guest_reviews(id, hotel_id) ON DELETE CASCADE
);

CREATE TRIGGER trg_review_flags_updated
BEFORE UPDATE ON review_flags
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_review_flags_review_id ON review_flags(review_id);


-- ── 7. External Publications ──
CREATE TABLE IF NOT EXISTS review_publications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
    review_id UUID NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('google', 'tripadvisor', 'booking.com')),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'failed')),
    external_link TEXT,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    CONSTRAINT fk_review_pub_review FOREIGN KEY (review_id, hotel_id) REFERENCES guest_reviews(id, hotel_id) ON DELETE CASCADE
);

CREATE TRIGGER trg_review_publications_updated
BEFORE UPDATE ON review_publications
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_review_publications_review_id ON review_publications(review_id);


-- ── 8. Event Emission (Vaiyu Architecture) ──
-- Gap 8: Immutable Event Pattern
CREATE TABLE IF NOT EXISTS review_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
    review_id UUID NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('REVIEW_CREATED', 'REVIEW_UPDATED', 'REVIEW_FLAGGED', 'REVIEW_ESCALATED', 'REVIEW_RESPONDED', 'REVIEW_PUBLISHED')),
    actor_type TEXT NOT NULL CHECK (actor_type IN ('GUEST', 'SYSTEM', 'STAFF')),
    actor_id UUID,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT fk_review_event_review FOREIGN KEY (review_id, hotel_id) REFERENCES guest_reviews(id, hotel_id) ON DELETE CASCADE
);

CREATE INDEX idx_review_events_review_id ON review_events(review_id);


-- ── 9. Triggers & Automation ──

-- Gap 6 & 8: Booking State Validation & Hotel Check
CREATE OR REPLACE FUNCTION trg_validate_review_booking_state()
RETURNS TRIGGER 
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public -- Gap 1: Security Definer Risk
AS $$
DECLARE
    v_status TEXT;
    v_hotel_id UUID;
BEGIN
    SELECT status, hotel_id INTO v_status, v_hotel_id FROM bookings WHERE id = NEW.booking_id;
    -- Restrict reviews strictly to checked_out or completed stays to ensure feedback is post-service
    IF UPPER(v_status) NOT IN ('CHECKED_OUT', 'COMPLETED') THEN
        RAISE EXCEPTION 'Reviews can only be submitted for completed bookings (Status: %)', v_status;
    END IF;
    
    -- Gap 8: Hotel integrity check
    IF v_hotel_id != NEW.hotel_id THEN
        RAISE EXCEPTION 'Booking hotel does not match review hotel';
    END IF;
    
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_review_booking_state
BEFORE INSERT ON guest_reviews
FOR EACH ROW
EXECUTE FUNCTION trg_validate_review_booking_state();


-- Gap 4 & 5 & 2: Idempotent Escalation Trigger and Race Condition Fix
CREATE OR REPLACE FUNCTION trg_escalate_low_rating()
RETURNS TRIGGER 
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public -- Gap 1: Security Definer Risk
AS $$
BEGIN
    -- Evaluate only on insert or if the rating drops below threshold during an update
    IF NEW.overall_rating <= 2 AND (TG_OP = 'INSERT' OR OLD.overall_rating > 2) THEN
        
        -- Gap 5: Race condition fix using ON CONFLICT DO NOTHING
        INSERT INTO review_flags (hotel_id, review_id, flag_type, severity, status)
        VALUES (NEW.hotel_id, NEW.id, 'low_rating', 'high', 'open')
        ON CONFLICT (review_id, flag_type) DO NOTHING;
        
        -- Emit event
        INSERT INTO review_events (hotel_id, review_id, event_type, actor_type, metadata)
        VALUES (NEW.hotel_id, NEW.id, 'REVIEW_FLAGGED', 'SYSTEM', jsonb_build_object('reason', 'low_rating_auto_escalation'));
        
    -- Gap 2: De-escalation condition
    ELSIF TG_OP = 'UPDATE' AND NEW.overall_rating > 2 AND OLD.overall_rating <= 2 THEN
        UPDATE review_flags SET status = 'resolved', updated_at = now()
        WHERE review_id = NEW.id AND flag_type = 'low_rating' AND status != 'resolved';
        
        IF FOUND THEN
            INSERT INTO review_events (hotel_id, review_id, event_type, actor_type, metadata)
            VALUES (NEW.hotel_id, NEW.id, 'REVIEW_UPDATED', 'SYSTEM', jsonb_build_object('reason', 'rating_improved_de_escalated'));
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- Use BEFORE to seamlessly update escalation_status without a cyclic UPDATE call
CREATE TRIGGER escalation_on_low_rating
BEFORE INSERT OR UPDATE OF overall_rating ON guest_reviews
FOR EACH ROW
EXECUTE FUNCTION trg_escalate_low_rating();

-- Event triggers
CREATE OR REPLACE FUNCTION trg_emit_review_created_event()
RETURNS TRIGGER 
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public -- Gap 1: Security Definer Risk
AS $$
BEGIN
    INSERT INTO review_events (hotel_id, review_id, event_type, actor_type, actor_id)
    VALUES (NEW.hotel_id, NEW.id, 'REVIEW_CREATED', CASE WHEN auth.uid() IS NULL THEN 'SYSTEM' ELSE 'GUEST' END, auth.uid());
    RETURN NEW;
END;
$$;

CREATE TRIGGER emit_review_created
AFTER INSERT ON guest_reviews
FOR EACH ROW
EXECUTE FUNCTION trg_emit_review_created_event();


-- ── 10. Security & Policies ──

ALTER TABLE guest_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_events ENABLE ROW LEVEL SECURITY;

-- Staff Policies (Full Access for their hotel) - Multi-Tenant Isolation
-- Gap 3: Missing DELETE protection. Use SELECT, INSERT, UPDATE instead of ALL.
CREATE POLICY "Staff select reviews" ON guest_reviews FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM hotel_members WHERE hotel_id = guest_reviews.hotel_id AND user_id = auth.uid()));
CREATE POLICY "Staff insert reviews" ON guest_reviews FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM hotel_members WHERE hotel_id = guest_reviews.hotel_id AND user_id = auth.uid()));

CREATE POLICY "Staff manage categories" ON review_categories FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM hotel_members WHERE hotel_id = review_categories.hotel_id AND user_id = auth.uid()));
CREATE POLICY "Staff manage ratings" ON review_ratings FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM hotel_members WHERE hotel_id = review_ratings.hotel_id AND user_id = auth.uid()));

CREATE POLICY "Staff select targets" ON review_targets FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM hotel_members WHERE hotel_id = review_targets.hotel_id AND user_id = auth.uid()));
CREATE POLICY "Staff insert targets" ON review_targets FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM hotel_members WHERE hotel_id = review_targets.hotel_id AND user_id = auth.uid()));

CREATE POLICY "Staff manage responses" ON review_responses FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM hotel_members WHERE hotel_id = review_responses.hotel_id AND user_id = auth.uid()));
CREATE POLICY "Staff manage flags" ON review_flags FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM hotel_members WHERE hotel_id = review_flags.hotel_id AND user_id = auth.uid()));
CREATE POLICY "Staff manage publications" ON review_publications FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM hotel_members WHERE hotel_id = review_publications.hotel_id AND user_id = auth.uid()));
CREATE POLICY "Staff view events" ON review_events FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM hotel_members WHERE hotel_id = review_events.hotel_id AND user_id = auth.uid()));

-- Gap 4: Missing RLS for INSERT on review_events (allow service_role/system and postgres to bypass)
CREATE POLICY "Service Role full access to events" ON review_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Guest Policies
CREATE POLICY "Guests create own reviews" ON guest_reviews FOR INSERT TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 
        FROM bookings b 
        JOIN guest_profiles gp ON b.guest_id = gp.id 
        WHERE b.id = booking_id AND gp.auth_user_id = auth.uid()
    )
);

CREATE POLICY "Guests view public reviews" ON guest_reviews FOR SELECT TO authenticated
USING (
    is_public = true 
    OR 
    EXISTS (
        SELECT 1 
        FROM bookings b 
        JOIN guest_profiles gp ON b.guest_id = gp.id 
        WHERE b.id = guest_reviews.booking_id AND gp.auth_user_id = auth.uid()
    )
);

CREATE POLICY "Public view categories" ON review_categories FOR SELECT USING (is_active = true);

-- Enable guest insertion on subqueries but strictly isolate to their review
CREATE POLICY "Guest insert child records" ON review_ratings FOR INSERT TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM guest_reviews gr
        JOIN bookings b ON gr.booking_id = b.id
        JOIN guest_profiles gp ON b.guest_id = gp.id
        WHERE gr.id = review_ratings.review_id 
        AND gp.auth_user_id = auth.uid()
    )
);

-- Gap 6: Explicitly NOT adding INSERT grants/policies for guests on targets, flags, responses, publications.


-- Grants
GRANT SELECT, INSERT ON guest_reviews TO authenticated, service_role; -- No UPDATE/DELETE makes reviews immutable once submitted
GRANT SELECT ON review_categories TO authenticated, service_role;
GRANT SELECT, INSERT ON review_ratings TO authenticated, service_role;
GRANT SELECT, INSERT ON review_targets TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON review_responses TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON review_flags TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON review_publications TO authenticated, service_role;
GRANT SELECT, INSERT ON review_events TO service_role; -- App generates these mostly


-- ── 11. Reporting & Analytics ──

CREATE OR REPLACE VIEW v_hotel_review_metrics AS
SELECT 
    gr.hotel_id,
    COUNT(DISTINCT gr.id) AS total_reviews,
    ROUND(AVG(gr.overall_rating), 2) AS average_rating,
    COUNT(DISTINCT gr.id) FILTER (WHERE gr.overall_rating >= 4) AS positive_reviews,
    COUNT(DISTINCT gr.id) FILTER (WHERE gr.overall_rating <= 2) AS negative_reviews,
    COUNT(DISTINCT f.review_id) FILTER (WHERE f.status IN ('open', 'in_progress')) AS active_escalations,
    MAX(gr.created_at) AS last_review_at
FROM guest_reviews gr
LEFT JOIN review_flags f ON gr.id = f.review_id
GROUP BY gr.hotel_id;

GRANT SELECT ON v_hotel_review_metrics TO authenticated, service_role;


-- ── 12. Default Categories for all Hotels ──
CREATE OR REPLACE FUNCTION seed_hotel_review_categories(p_hotel_id UUID)
RETURNS VOID 
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public -- Gap 1: Security Definer Risk
AS $$
BEGIN
    INSERT INTO review_categories (hotel_id, code, label, display_order)
    VALUES 
        (p_hotel_id, 'cleanliness', 'Cleanliness', 10),
        (p_hotel_id, 'staff', 'Staff Service', 20),
        (p_hotel_id, 'room', 'Room Comfort', 30),
        (p_hotel_id, 'service', 'Service Quality', 40),
        (p_hotel_id, 'location', 'Location', 50)
    ON CONFLICT (hotel_id, code) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION trg_seed_categories_on_hotel_creation()
RETURNS TRIGGER 
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public -- Gap 1: Security Definer Risk
AS $$
BEGIN
    PERFORM seed_hotel_review_categories(NEW.id);
    RETURN NEW;
END;
$$;

CREATE TRIGGER seed_categories_trigger
AFTER INSERT ON hotels
FOR EACH ROW
EXECUTE FUNCTION trg_seed_categories_on_hotel_creation();

-- Seed existing hotels
SELECT seed_hotel_review_categories(id) FROM hotels;
