import { useNavigate } from "react-router-dom";

export default function BackHome({ to = "/" }: { to?: string }) {
  const navigate = useNavigate();

  function onClick(e: React.MouseEvent) {
    e.preventDefault();

    // If we have real history, go back; otherwise go to fallback ("/" by default)
    if (window.history.length > 2) {
      navigate(-1);
    } else {
      navigate(to, { replace: true });
    }
  }

  return (
    <button
      className="btn btn-light"
      onClick={onClick}
      aria-label="Back to app"
      title="Back to app"
    >
      ← Back to app
    </button>
  );
}
