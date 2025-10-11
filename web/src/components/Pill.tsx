import React from "react";

type Props = {
  children: React.ReactNode;
  tone?: "brand" | "success" | "neutral" | "warning";
  className?: string;
};

const tones: Record<NonNullable<Props["tone"]>, string> = {
  brand: "bg-sky-100 text-sky-700 border-sky-200",
  success: "bg-emerald-100 text-emerald-700 border-emerald-200",
  neutral: "bg-gray-100 text-gray-700 border-gray-200",
  warning: "bg-amber-100 text-amber-800 border-amber-200",
};

export default function Pill({ children, tone = "brand", className = "" }: Props) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
