export default function ErrorNote({ msg, retry }: { msg: string; retry?: () => void }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
      <div className="font-medium">Something went wrong</div>
      <div className="text-sm">{msg}</div>
      {retry && (
        <button onClick={retry} className="mt-2 rounded-md border px-3 py-1.5 text-sm hover:bg-white/60">
          Try again
        </button>
      )}
    </div>
  );
}
