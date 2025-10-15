// web/src/routes/SignIn.tsx
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { Link } from "react-router-dom";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`
      }
    });
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <div className="min-h-screen grid place-items-center bg-gray-50">
      <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Sign in to VAiyu</h1>
        <p className="text-sm text-gray-600 mt-1">We’ll email you a secure sign-in link.</p>

        {sent ? (
          <div className="mt-4 rounded-md bg-sky-50 p-3 text-sky-800 text-sm">
            Check your inbox for a sign-in link.
          </div>
        ) : (
          <form className="mt-4 space-y-3" onSubmit={handleSend}>
            <div>
              <label className="block text-sm font-medium">Work email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2"
                placeholder="you@hotel.com"
              />
            </div>
            {error && <div className="text-sm text-red-600">{error}</div>}
            <button className="btn w-full" type="submit">Send magic link</button>
          </form>
        )}

        <div className="mt-6 text-sm text-gray-600">
          <Link to="/" className="hover:underline">← Back to home</Link>
        </div>
      </div>
    </div>
  );
}
