import { ReactNode } from "react";

type Props = {
  importChunk: () => Promise<unknown>;
  children: ReactNode;
};

export default function PrefetchOnHover({ importChunk, children }: Props) {
  return (
    <span
      onMouseEnter={() => { importChunk().catch(() => {}); }}
      onFocus={() => { importChunk().catch(() => {}); }}
    >
      {children}
    </span>
  );
}
