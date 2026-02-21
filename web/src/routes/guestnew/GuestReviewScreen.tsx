import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import "./guestnew.css";

type Category = {
    id: string;
    code: string;
    label: string;
};

export default function GuestReviewScreen() {
    const { id: bookingCode } = useParams();
    const navigate = useNavigate();

    const [overallRating, setOverallRating] = useState(0);
    const [categoryRatings, setCategoryRatings] = useState<Record<string, number>>({});
    const [categories, setCategories] = useState<Category[]>([]);
    const [reviewText, setReviewText] = useState("");
    const [bookingDetails, setBookingDetails] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    // Fetch booking and categories
    useEffect(() => {
        async function loadData() {
            if (!bookingCode) return;

            // 1. Get Booking
            const { data: booking, error: bError } = await supabase
                .from("bookings")
                .select("id, hotel_id, guest_name, hotel:hotels(name, slug)")
                .eq("code", bookingCode)
                .maybeSingle();

            if (bError || !booking) {
                console.error("Booking not found", bError);
                setLoading(false);
                return;
            }

            setBookingDetails(booking);

            // 2. Get Categories for this hotel
            const { data: cats, error: cError } = await supabase
                .from("review_categories")
                .select("id, code, label")
                .eq("hotel_id", booking.hotel_id)
                .eq("is_active", true)
                .order("display_order", { ascending: true });

            if (!cError && cats) {
                setCategories(cats);
                // Initialize category ratings
                const initial: Record<string, number> = {};
                cats.forEach(c => initial[c.id] = 0);
                setCategoryRatings(initial);
            }

            setLoading(false);
        }

        loadData();
    }, [bookingCode]);

    const handleSubmit = async () => {
        if (!bookingDetails || overallRating === 0) return;
        setSubmitting(true);

        try {
            // 1. Create Review
            const { data: review, error: rError } = await supabase
                .from("guest_reviews")
                .insert({
                    hotel_id: bookingDetails.hotel_id,
                    booking_id: bookingDetails.id,
                    overall_rating: overallRating,
                    review_text: reviewText,
                    is_public: overallRating >= 4 // Auto-public for high ratings? Or keep private? 
                })
                .select("id")
                .single();

            if (rError) throw rError;

            // 2. Insert Category Ratings
            const ratingEntries = Object.entries(categoryRatings)
                .filter(([_, value]) => value > 0)
                .map(([catId, value]) => ({
                    hotel_id: bookingDetails.hotel_id,
                    review_id: review.id,
                    category_id: catId,
                    rating: value
                }));

            if (ratingEntries.length > 0) {
                const { error: catError } = await supabase
                    .from("review_ratings")
                    .insert(ratingEntries);
                if (catError) console.error("Error inserting category ratings", catError);
            }

            setSubmitted(true);
        } catch (err) {
            console.error("Submission failed", err);
            alert("Failed to submit review. Please try again.");
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return <div className="gn-review-screen"><div className="gn-review-card" style={{ textAlign: 'center' }}>Loading...</div></div>;
    if (!bookingDetails) return <div className="gn-review-screen"><div className="gn-review-card" style={{ textAlign: 'center' }}>Booking not found.</div></div>;

    if (submitted) {
        return (
            <div className="gn-review-screen">
                <div className="gn-review-card" style={{ textAlign: 'center' }}>
                    <h2 className="gn-review-title">Thank you, {bookingDetails.guest_name.split(' ')[0]}!</h2>
                    <p className="gn-review-subtitle" style={{ marginBottom: '24px' }}>Your feedback helps us improve.</p>

                    {overallRating >= 4 ? (
                        <div className="gn-google-upsell" style={{ animation: 'none', marginBottom: '32px' }}>
                            <div className="gn-google-icon">G</div>
                            <div className="gn-google-text">
                                <div className="gn-google-title">Would you share this on Google?</div>
                                <div className="gn-google-desc">It helps other travelers find us.</div>
                            </div>
                            <a href={`https://search.google.com/local/writereview?placeid=REPLACE_WITH_ACTUAL_ID`} target="_blank" rel="noreferrer" className="gn-google-link">Write Review</a>
                        </div>
                    ) : (
                        <p className="gn-review-subtitle">Our manager has been alerted to your feedback and will look into it.</p>
                    )}

                    <button className="gn-review-btn--primary" onClick={() => navigate("/guest")}>Back to Home</button>
                </div>
            </div>
        );
    }

    return (
        <div className="gn-review-screen">
            <div className="gn-review-card">
                <h1 className="gn-review-title">How was your stay?</h1>
                <p className="gn-review-subtitle">Thank you for staying with us at {bookingDetails.hotel.name}.</p>

                <div className="gn-overall-rating">
                    <div className="gn-stars">
                        {[1, 2, 3, 4, 5].map((star) => (
                            <span
                                key={star}
                                className={`gn-star ${star <= overallRating ? "gn-star--filled" : "gn-star--empty"}`}
                                onClick={() => setOverallRating(star)}
                            >
                                ★
                            </span>
                        ))}
                    </div>
                    {overallRating > 0 && (
                        <p style={{ marginTop: '12px', fontSize: '14px', color: '#dbae67', fontWeight: 600 }}>
                            {overallRating === 5 ? "Exceptional!" : overallRating === 4 ? "Very Good" : overallRating === 3 ? "Average" : overallRating === 2 ? "Poor" : "Disappointing"}
                        </p>
                    )}
                </div>

                {overallRating > 0 && (
                    <div className="gn-category-list">
                        <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.6)', marginBottom: '16px', textAlign: 'center' }}>Please rate each category below.</p>
                        {categories.map((cat) => (
                            <div key={cat.id} className="gn-category-item">
                                <div className="gn-category-label">
                                    <span>{cat.code === 'cleanliness' ? '✨' : cat.code === 'staff' ? '🧑‍💼' : cat.code === 'room' ? '🛌' : cat.code === 'service' ? '🛎️' : cat.code === 'location' ? '📍' : '⭐'}</span>
                                    {cat.label}
                                </div>
                                <div className="gn-mini-stars">
                                    {[1, 2, 3, 4, 5].map((s) => (
                                        <span
                                            key={s}
                                            className={`gn-mini-star ${s <= (categoryRatings[cat.id] || 0) ? "gn-mini-star--filled" : "gn-mini-star--empty"}`}
                                            onClick={() => setCategoryRatings(prev => ({ ...prev, [cat.id]: s }))}
                                        >
                                            ★
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}

                        <textarea
                            className="gn-review-textarea"
                            placeholder={overallRating <= 3 ? "What went wrong? Tell us more..." : "Tell us about your stay..."}
                            rows={4}
                            value={reviewText}
                            onChange={(e) => setReviewText(e.target.value)}
                        />

                        {overallRating >= 4 && (
                            <div className="gn-google-upsell">
                                <div className="gn-google-icon">G</div>
                                <div className="gn-google-text">
                                    <div className="gn-google-title">Share on Google</div>
                                    <div className="gn-google-desc">Support us by leaving a review on Google as well.</div>
                                </div>
                            </div>
                        )}

                        <div className="gn-review-actions">
                            <button className="gn-review-btn--secondary" onClick={() => navigate("/guest")}>Later</button>
                            <button
                                className="gn-review-btn--primary"
                                disabled={submitting || overallRating === 0}
                                onClick={handleSubmit}
                            >
                                {submitting ? "Submitting..." : "Submit Review"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
