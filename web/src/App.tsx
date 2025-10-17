import React from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { withBoundary, Spinner } from "./components/RouteErrorBoundary";


// Eager imports while debugging (flip to lazy once stable)
import HomeOrApp from "./routes/HomeOrApp";
import GuestDashboard from "./routes/GuestDashboard";
import Profile from "./routes/Profile";
import AuthCallback from "./routes/AuthCallback";

// Minimal OK page
function MinimalOK() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Router is working</h1>
      <p className="mt-2 text-gray-600">
        Use the navbar to enable routes one by one and note which one breaks.
      </p>
      <nav className="mt-6 flex gap-4 text-blue-700 underline">
        <Link to="/">/ (HomeOrApp)</Link>
        <Link to="/guest">/guest (GuestDashboard)</Link>
        <Link to="/profile">/profile</Link>
        <Link to="/auth/callback">/auth/callback</Link>
      </nav>
    </main>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Step 1: keep a guaranteed-good route */}
        <Route path="/ok" element={<MinimalOK />} />

        {/* Step 2: enable one-by-one while testing */}
        <Route path="/" element={withBoundary(<HomeOrApp />)} />
        <Route path="/guest" element={withBoundary(<GuestDashboard />)} />
        <Route path="/profile" element={withBoundary(<Profile />)} />
        <Route path="/auth/callback" element={withBoundary(<AuthCallback />)} />

        {/* Fallback */}
        <Route path="*" element={<Spinner label="Not found…" />} />
      </Routes>
    </BrowserRouter>
  );
}
