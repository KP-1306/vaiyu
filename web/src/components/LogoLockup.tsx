import React from "react";
type Size = "sm" | "md" | "lg";
const sizeMap: Record<Size, string> = { sm: "text-xl", md: "text-3xl", lg: "text-5xl" };

export default function LogoLockup({ size = "md" }: { size?: Size }) {
  const sz = sizeMap[size];
  return (
    <div className={`font-bold ${sz} leading-none select-none`} aria-label="VAiyu">
      <span className="logo-letter edge-clip text-brand-primary shadow-glowBlue">V</span>
      <span className="logo-letter edge-clip text-brand-air ml-0.5 shadow-glowGreen">A</span>
      <span className="logo-letter edge-clip text-brand-spark ml-0.5 shadow-glowRed">i</span>
      <span className="logo-letter edge-clip text-brand-earth ml-0.5 shadow-glowYellow">y</span>
      <span className="logo-letter edge-clip text-brand-space ml-0.5 shadow-glowGrey">u</span>
    </div>
  );
}
