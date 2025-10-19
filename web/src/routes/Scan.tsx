import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Lightweight QR scanner using the native Shape Detection API (BarcodeDetector)
 * with graceful fallbacks:
 *  - If BarcodeDetector is available: live camera preview + auto-detect
 *  - Otherwise: file upload (accepts photos/screenshots of a QR)
 *
 * On successful scan:
 *  - If the text is a full URL => navigate to its pathname within this app (or window.location if off-domain)
 *  - Else if it looks like a code => push to /precheck/:code
 *  - Else show the scanned text so the user can copy.
 */
export default function Scan() {
  const nav = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultText, setResultText] = useState<string>("");

  useEffect(() => {
    (async () => {
      // @ts-ignore - experimental types
      const ok = "BarcodeDetector" in window;
      setSupported(ok);
      if (!ok) return;

      try {
        // @ts-ignore
        const formats = await (window as any).BarcodeDetector.getSupportedFormats?.();
        if (!formats || !formats.includes("qr_code")) {
          setSupported(false);
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        setScanning(true);
        // @ts-ignore
        const detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });

        let raf = 0;
        const tick = async () => {
          if (!videoRef.current) return;
          try {
            const bitmap = await createImageBitmap(videoRef.current);
            const codes = await detector.detect(bitmap);
            if (codes && codes.length > 0) {
              handleDetected(codes[0].rawValue || codes[0].rawValue || "");
              stopStream();
              return;
            }
          } catch (_) {}
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);

        const stopStream = () => {
          cancelAnimationFrame(raf);
          const s = videoRef.current?.srcObject as MediaStream | null;
          s?.getTracks().forEach((t) => t.stop());
          setScanning(false);
        };

        return () => stopStream();
      } catch (e: any) {
        setError(e?.message || "Camera access denied. Use the upload option below.");
        setScanning(false);
      }
    })();
  }, []);

  function handleDetected(text: string) {
    setResultText(text || "");
    if (!text) return;

    // Full URL?
    try {
      const u = new URL(text);
      if (u.origin === window.location.origin) {
        // Same domain → SPA navigate
        nav(u.pathname + u.search + u.hash);
        return;
      }
      // Different origin → continue to that URL
      window.location.href = u.toString();
      return;
    } catch {
      // Not a full URL — looks like a booking / precheck code?
    }

    // Simple heuristic: if alphanumeric-ish and 6–20 chars, treat as precheck code
    const codeish = /^[A-Za-z0-9_-]{6,20}$/.test(text);
    if (codeish) {
      nav(`/precheck/${encodeURIComponent(text)}`);
      return;
    }

    // Otherwise just display it; user can copy
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setResultText("");
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const img = await blobToImage(file);
      // If BarcodeDetector exists, try detecting from still image
      // @ts-ignore
      if ("BarcodeDetector" in window) {
        // @ts-ignore
        const detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });
        const bmp = await createImageBitmap(img);
        const codes = await detector.detect(bmp);
        if (codes && codes.length > 0) {
          handleDetected(codes[0].rawValue || "");
          return;
        }
      }
      setError("Couldn’t read a QR code from that image. Try a clearer photo.");
    } catch (err: any) {
      setError(err?.message || "Couldn’t process the image.");
    } finally {
      e.currentTarget.value = "";
    }
  }

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-semibold">Scan property QR</h1>
      <p className="text-sm text-gray-600 mt-1">
        Point your camera at the QR on the front desk to fetch your booking and start check-in.
      </p>

      {/* Live camera */}
      {supported ? (
        <div className="mt-4 rounded-xl overflow-hidden border bg-black">
          <video ref={videoRef} className="w-full h-[320px] object-cover" playsInline muted />
        </div>
      ) : (
        <div className="mt-4 p-3 rounded-xl border bg-yellow-50 text-sm">
          Your browser doesn’t support live QR scanning. Upload a photo of the QR instead.
        </div>
      )}

      {/* Fallback: upload photo */}
      <div className="mt-4">
        <label className="text-sm">Upload a QR photo (fallback)</label>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="block mt-1"
          onChange={onFile}
        />
      </div>

      {scanning ? (
        <p className="mt-2 text-xs text-gray-600">Scanning… keep the QR steady.</p>
      ) : null}

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      {resultText && (
        <div className="mt-4 rounded-lg border p-3 bg-white/90">
          <div className="text-xs text-gray-600">Scanned text</div>
          <div className="font-mono text-sm break-all">{resultText}</div>
          <div className="mt-2">
            <button
              className="btn btn-light"
              onClick={() => navigator.clipboard.writeText(resultText)}
            >
              Copy
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

async function blobToImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("Image load error"));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
