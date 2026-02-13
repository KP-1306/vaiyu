import React from "react";
import { Check } from "lucide-react";

interface CheckInStepperProps {
    steps: string[];
    currentStep: number; // 0-indexed
}

export function CheckInStepper({ steps, currentStep }: CheckInStepperProps) {
    return (
        <div className="w-full py-6">
            <div className="flex items-center justify-center">
                {steps.map((step, index) => {
                    const isCompleted = index < currentStep;
                    const isCurrent = index === currentStep;
                    const isLast = index === steps.length - 1;

                    return (
                        <React.Fragment key={index}>
                            {/* Step Circle & Label Container */}
                            <div className="flex items-center gap-3">

                                {/* Circle Indicator */}
                                <div
                                    className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors duration-300
                    ${isCompleted ? "bg-indigo-600 text-white" : ""}
                    ${isCurrent ? "bg-indigo-600 text-white ring-4 ring-indigo-50" : ""}
                    ${!isCompleted && !isCurrent ? "bg-slate-100 text-slate-500" : ""}
                  `}
                                >
                                    {isCompleted ? <Check className="h-5 w-5" /> : index + 1}
                                </div>

                                {/* Text Label */}
                                <span
                                    className={`text-sm font-medium transition-colors duration-300
                    ${isCurrent ? "text-slate-900" : "text-slate-500"}
                  `}
                                >
                                    {step}
                                </span>
                            </div>

                            {/* Connector Line (if not last) */}
                            {!isLast && (
                                <div className="mx-4 h-[2px] w-12 bg-slate-100 sm:w-24 md:w-32">
                                    <div
                                        className={`h-full transition-all duration-500 ease-out ${index < currentStep ? "bg-indigo-600 w-full" : "w-0"
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
