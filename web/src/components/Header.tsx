// web/src/components/Header.tsx
import { useNavigate } from "react-router-dom";
import { signOutEverywhere } from "../lib/auth";   // <— add
// …other imports

export default function Header() {
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOutEverywhere();
    // send them to sign-in and bust any caches
    navigate(`/signin?intent=signin&_=${Date.now()}`, { replace: true });
  }

  return (
    <header className="...">
      {/* your existing nav … */}
      {/* In your account dropdown or menu: */}
      <button className="menu-item text-red-600" onClick={handleSignOut}>
        Sign out
      </button>
    </header>
  );
}
