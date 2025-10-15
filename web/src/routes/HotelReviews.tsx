import { useParams } from "react-router-dom";
import SEO from "../components/SEO";
import ReviewsWidget from "../components/ReviewsWidget";

export default function HotelReviews() {
  const { slug = "TENANT1" } = useParams();

  return (
    <>
      <SEO title="Property Reviews" noIndex={false} />
      <main className="mx-auto max-w-5xl px-4 py-8 space-y-4">
        <header>
          <h1 className="text-xl font-semibold">Reviews</h1>
          <p className="text-sm text-gray-600">Verified, approved reviews for this property.</p>
        </header>

        <ReviewsWidget slug={slug} pageSize={12} />
      </main>
    </>
  );
}
