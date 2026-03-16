import { Loader2 } from "lucide-react";

export default function Spinner({ label = "Synchronizing…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 p-12">
      <div className="relative">
        <div className="absolute inset-0 bg-gold-400/20 blur-xl rounded-full animate-pulse" />
        <Loader2 className="h-10 w-10 animate-spin text-gold-400 relative z-10" />
      </div>
      <div className="space-y-1 text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gold-400/60 animate-pulse">
            {label}
        </p>
        <p className="text-[8px] font-bold text-white/10 uppercase tracking-widest">
            Bespoke Engineering by Vaiyu
        </p>
      </div>
    </div>
  );
}
