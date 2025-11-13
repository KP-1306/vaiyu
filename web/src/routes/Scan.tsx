// web/src/routes/Scan.tsx
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import SEO from "../components/SEO";

export default function Scan() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraSupported, setCameraSupported] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [decoded, setDecoded] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [autoRedirected, setAutoRedirected] = useState(false);

  const handleResolvedTarget = useCallback((value: string) => {
    // Basic normalisation
    const v = value.trim();
    if (!v) return;

    // 1) Full URL → just open
    if (/^https?:\/\//i.test(v)) {
      window.location.href = v;
      return;
    }

    // 2) Optional custom scheme like vaiyu://menu?hotelSlug=sunrise
    if (/^vaiyu:\/\//i.test(v)) {
      const url = v.replace(/^vaiyu:\/\//i, "https://vaiyu.co.in/");
      window.location.href = url;
      return;
    }

    // 3) Booking code (e.g. ABC123) → open stay menu
    if (/^[A-Za-z0-9_-]{4,20}$/.test(v)) {
      window.location.href = `/stay/${encodeURIComponent(v)}/menu`;
      return;
    }

    // 4) Fallback: treat it as a hotel slug → property menu
    window.location.href = `/menu?hotelSlug=${encodeURIComponent(v)}`;
  }, []);

  const handleDetected = useCallback(
    (raw: string) => {
      if (!raw || autoRedirected) return;
      setDecoded(raw);
      setAutoRedirected(true);
      handleResolvedTarget(raw);
    },
    [autoRedirected, handleResolvedTarget],
  );

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    let rafId: number | null = null;

    async function startCameraScan() {
      if (typeof window === "undefined") return;

      const BD = (window as any).BarcodeDetector;
      if (!BD) {
        setCameraSupported(false);
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraSupported(false);
        setCameraError("Camera access not supported in this browser.");
        return;
      }

      setCameraSupported(true);

      const detector = new BD({ formats: ["qr_code"] });

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
      } catch (err: any) {
        setCameraError(
          err?.message || "Unable to access camera. Please allow camera access.",
        );
        return;
      }
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      async function frame() {
        if (cancelled || !videoRef.current || !ctx) return;

        const v = videoRef.current;
        if (v.readyState === v.HAVE_ENOUGH_DATA) {
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          try {
            const barcodes = await detector.detect(imageData as any);
            if (barcodes && barcodes[0]) {
              const raw = barcodes[0].rawValue || "";
              if (raw) {
                handleDetected(raw);
                return; // stop after first successful scan
              }
            }
          } catch {
            // ignore detection errors and keep scanning
          }
        }

        rafId = window.requestAnimationFrame(frame);
      }

      rafId = window.requestAnimationFrame(frame);
    }

    startCameraScan();

    return () => {
      cancelled = true;
      if (rafId != null) window.cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [handleDetected]);

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!manual.trim()) return;
    handleResolvedTarget(manual);
  }

  return (
    <>
      <SEO title="Scan QR – Guest Menu" noIndex />

      <main className="max-w-xl mx-auto p-4 space-y-4">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold">Scan hotel QR</h1>
          <p className="text-sm text-gray-600">
            Point your camera at the QR card placed at reception or in your
            room. We’ll open the correct VAiyu guest menu for this property.
          </p>
        </header>

        {/* Camera scan area */}
        <section className="bg-white rounded shadow p-3 space-y-2">
          <div className="text-sm font-medium mb-1">
            1. Scan using your camera
          </div>

          {!cameraSupported && !cameraError && (
            <p className="text-xs text-gray-600">
              Your phone’s browser may not support in-app scanning. You can
              still use the{" "}
              <span className="font-semibold">system camera or WhatsApp</span>{" "}
              to scan the QR and open the link directly.
            </p>
          )}

          {cameraError && (
            <div className="p-2 text-xs rounded bg-amber-50 border border-amber-200 text-amber-800">
              {cameraError}
            </div>
          )}

          {cameraSupported && !cameraError && (
            <div className="relative mt-2 rounded-lg overflow-hidden border aspect-[3/4] bg-black">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                muted
                playsInline
              />
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-40 h-40 border-2 border-white/80 rounded-md shadow-[0_0_0_9999px_rgba(0,0,0,0.3)]" />
              </div>
              <div className="absolute bottom-2 inset-x-0 text-center text-[11px] text-white/80">
                Align the QR inside the square
              </div>
            </div>
          )}

          {decoded && (
            <p className="mt-2 text-[11px] text-gray-500 break-all">
              Last scanned: <span className="font-mono">{decoded}</span>
            </p>
          )}
        </section>

        {/* Manual / fallback entry */}
        <section className="bg-white rounded shadow p-3 space-y-2">
          <div className="text-sm font-medium mb-1">
            2. Or paste the link / code
          </div>
          <p className="text-xs text-gray-600">
            If you already have the{" "}
            <span className="font-mono text-[11px]">
              /menu?hotelSlug=&lt;slug&gt;
            </span>{" "}
            link or a booking code (like <b>ABC123</b>), paste it here and
            we’ll route you to the right screen.
          </p>

          <form
            onSubmit={handleManualSubmit}
            className="flex flex-col sm:flex-row gap-2 mt-2"
          >
            <input
              className="input flex-1"
              placeholder="Paste QR link, hotel slug or booking code"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
            />
            <button className="btn sm:w-32" type="submit">
              Open
            </button>
          </form>

          <p className="text-[11px] text-gray-500 mt-1">
            Examples:{" "}
            <code className="bg-gray-50 px-1 rounded">
              https://vaiyu.co.in/menu?hotelSlug=sunrise
            </code>{" "}
            or <code className="bg-gray-50 px-1 rounded">ABC123</code>.
          </p>
        </section>

        {/* Hint about WhatsApp usage */}
        <section className="bg-sky-50 border border-sky-100 rounded p-3 text-xs text-sky-900">
          <div className="font-medium mb-1">Tip for hotels</div>
          <p>
            You can also share the same guest menu link via{" "}
            <b>WhatsApp Business</b>. When guests tap the link in WhatsApp or
            scan the printed QR, they are taken to this property’s VAiyu
            menu only.
          </p>
        </section>
      </main>
    </>
  );
}
