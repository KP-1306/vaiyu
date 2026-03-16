import React from "react";
import { Check } from "lucide-react";

interface CheckInStepperProps {
    steps: string[];
    currentStep: number; // 0-indexed
}

export function CheckInStepper({ steps, currentStep }: CheckInStepperProps) {
    return (
        <div className="w-full py-8 md:py-12 px-4">
            <div className="flex items-center justify-center max-w-2xl mx-auto">
                {steps.map((step, index) => {
                    const isCompleted = index < currentStep;
                    const isCurrent = index === currentStep;
                    const isLast = index === steps.length - 1;

                    return (
                        <React.Fragment key={index}>
                            {/* Step Indicator Section */}
                            <div className="flex flex-col items-center gap-3 relative">
                                {/* Circle Indicator */}
                                <div
                                    className={`relative z-10 flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all duration-700
                                        ${isCompleted 
                                            ? "bg-gold-400 text-black shadow-[0_0_20px_rgba(212,175,55,0.4)]" 
                                            : isCurrent 
                                                ? "bg-white/[0.08] text-white" 
                                                : "bg-white/[0.04] text-white/40 border border-white/5"
                                        }
                                    `}
                                >
                                    {/* Show number for ALL steps, but add a checkmark badge for completed ones */}
                                    <span className={`${isCompleted ? "text-black" : isCurrent ? "text-white" : "text-white/30"}`}>
                                        0{index + 1}
                                    </span>
                                    
                                    {isCompleted && (
                                        <div className="absolute -top-1 -right-1 h-4 w-4 bg-white rounded-full flex items-center justify-center shadow-lg">
                                            <Check size={10} strokeWidth={4} className="text-black" />
                                        </div>
                                    )}

                                    {/* Rotating Active Ring */}
                                    {isCurrent && (
                                        <div className="absolute inset-[-4px] rounded-[15px] border border-gold-400/30 border-t-gold-400 animate-[spin_3s_linear_infinite]" />
                                    )}
                                    
                                    {/* Static Border for Current */}
                                    {isCurrent && (
                                        <div className="absolute inset-0 rounded-xl border border-gold-400/50 shadow-[inset_0_0_10px_rgba(212,175,55,0.2)]" />
                                    )}
                                </div>

                                {/* Persistent Text Label */}
                                <span
                                    className={`absolute -bottom-8 px-2 text-center text-[7px] sm:text-[9px] font-black uppercase tracking-[0.2em] sm:tracking-[0.3em] transition-all duration-700
                                        ${isCurrent ? "text-white opacity-100" : isCompleted ? "text-gold-400/60" : "text-white/20"}
                                    `}
                                    style={{ 
                                        width: 'max-content',
                                        maxWidth: '100px',
                                        whiteSpace: 'normal',
                                        lineHeight: '1.2'
                                    }}
                                >
                                    {step}
                                </span>
                            </div>

                            {/* Architectural Connector Line */}
                            {!isLast && (
                                <div className="mx-2 sm:mx-10 h-[1.5px] flex-1 bg-white/[0.05] min-w-[20px] sm:min-w-[80px] relative overflow-hidden rounded-full">
                                    <div
                                        className={`absolute inset-0 bg-gold-400 shadow-[0_0_10px_rgba(212,175,55,0.5)] transition-all duration-1000 ease-in-out ${
                                            index < currentStep ? "translate-x-0" : "-translate-x-full"
                                        }`}
                                    />
                                </div>
                            )}
                        </React.Fragment>
                    );
                })}
            </div>
        </div>
    );
}

// Add these to your global CSS or guestnew.css if needed:
// @keyframes shimmer {
//   0% { transform: translateX(-100%); }
//   100% { transform: translateX(200%); }
// }
