import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Minimal QR scanner:
 * - Uses BarcodeDetector if available (Chrome, Edge, Android WebView).
 * - Falls back to manual code entry if camera/feature is not available.
 * Expects payload like:  "checkin:VA-12345:Hotel Name"
 * → navigates to /precheck/VA-12345
 */
export default function Scan() {
  const nav = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [supported, setSupported] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let detector: any = null;

    async function start() {
      const hasBarcode = "BarcodeDetector" in window;
      setSupported(hasBarcode);

      if (!hasBarcode) return;

      try {
        // @ts-ignore
        detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      } catch {
        setSupported(false);
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        const scanLoop = async () => {
          try {
            if (videoRef.current && detector) {
              const barcodes = await detector.detect(videoRef.current);
              if (barcodes?.length) {
                const raw = String(barcodes[0].rawValue || "");
                handlePayload(raw);
                return; // stop scanning on first hit
              }
            }
          } catch (e: any) {
            setError(e?.message || "Could not read QR.");
          }
          raf = requestAnimationFrame(scanLoop);
        };
        raf = requestAnimationFrame(scanLoop);
      } catch (e: any) {
        setError(e?.message || "Could not access camera.");
      }
    }

    function stop() {
      cancelAnimationFrame(raf);
      if (stream) {
        for (const t of stream.getTracks()) t.stop();
      }
    }

    start();
    return stop;
  }, [nav]);

  function handlePayload(raw: string) {
    // Expected "checkin:VA-12345:Hotel Name"
    const parts = raw.split(":");
    const code = parts[1] || raw; // if it’s just a code, still try it
    if (code) nav(`/precheck/${encodeURIComponent(code)}`, { replace: true });
  }

  function handleManualSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = new FormData(e.currentTarget).get("code") as string;
    if (code) nav(`/precheck/${encodeURIComponent(code)}`);
  }

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <h1 className="text-xl font-semibold">Scan property QR</h1>
      {supported ? (
        <>
          <div className="rounded-xl overflow-hidden border bg-black aspect-[4/3]">
            <video ref={videoRef} muted playsInline className="w-full h-full object-cover" />
          </div>
          <p className="text-sm text-gray-600">
            Point your camera at the VAiyu QR at the front desk. We’ll pick it up automatically.
          </p>
        </>
      ) : (
        <div className="rounded-lg border p-4 bg-gray-50">
          <div className="font-medium">Camera scan not available on this device.</div>
          <p className="text-sm text-gray-600 mt-1">
            You can still continue by entering your booking code.
          </p>
        </div>
      )}

      {error && <div className="text-sm text-red-600">{error}</div>}

      <form className="flex gap-2" onSubmit={handleManualSubmit}>
        <input name="code" className="input flex-1" placeholder="Enter booking code (e.g., VA-12345)" />
        <button className="btn" type="submit">Continue</button>
      </form>
    </main>
  );
}
