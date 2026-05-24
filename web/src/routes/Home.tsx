// web/src/routes/Home.tsx
import HeroCarousel, { type Slide } from "../components/HeroCarousel";

const HOME_SLIDES: Slide[] = [
  {
    id: "welcome",
    headline: "Welcome to VAiyu",
    sub: "Smart hospitality, made simple.",
    variant: "solid",
  },
];

export default function Home() {
  return (
    <main>
      <HeroCarousel slides={HOME_SLIDES} />
      {/* …your landing sections… */}
    </main>
  );
}
