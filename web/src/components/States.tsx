// web/src/components/States.tsx
export function Empty({ title="Nothing here yet", note }: {title?:string; note?:string}) {
  return <div className="text-center text-gray-500 py-10">
    <div className="text-lg font-medium">{title}</div>
    {note && <div className="text-sm mt-1">{note}</div>}
  </div>;
}

export function ErrorState({ error }: { error: string }) {
  return <div className="text-center text-red-600 py-6">{error}</div>;
}

export function Loading({ label="Loading…" }: { label?: string }) {
  return <div className="grid place-items-center py-10 text-gray-500">{label}</div>;
}
