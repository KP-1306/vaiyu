import { useEffect } from 'react';

export default function SEO({ title }: { title: string }) {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title} · VAiyu` : 'VAiyu';
    return () => { document.title = prev; };
  }, [title]);
  return null;
}
