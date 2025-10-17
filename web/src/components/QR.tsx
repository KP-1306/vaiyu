// web/src/components/QR.tsx
import React from "react";

/**
 * Super–light QR renderer (no JS libs).
 * Uses a well-known QR image endpoint. You can later swap to an in-app SVG generator
 * without changing consumers of <QR />.
 */
export default function QR({
  data,
  size = 128,
  className,
  alt = "QR code",
}: {
  data: string;
  size?: number;
  className?: string;
  alt?: string;
}) {
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(
    data
  )}`;
  return (
    <img
      src={src}
      width={size}
      height={size}
      className={className}
      alt={alt}
      loading="lazy"
      decoding="async"
    />
  );
}
