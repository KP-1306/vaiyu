import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

interface SimpleTooltipProps {
    content: string;
    children: React.ReactNode;
}

export function SimpleTooltip({ content, children }: SimpleTooltipProps) {
    const [isVisible, setIsVisible] = useState(false);
    const triggerRef = useRef<HTMLDivElement>(null);
    const [rect, setRect] = useState<DOMRect | null>(null);

    const handleMouseEnter = () => {
        if (triggerRef.current) {
            setRect(triggerRef.current.getBoundingClientRect());
            setIsVisible(true);
        }
    };

    const handleMouseLeave = () => {
        setIsVisible(false);
    };

    useEffect(() => {
        if (!isVisible) return;

        const update = () => {
            if (triggerRef.current) {
                setRect(triggerRef.current.getBoundingClientRect());
            }
        };

        window.addEventListener('scroll', update, true);
        window.addEventListener('resize', update);
        return () => {
            window.removeEventListener('scroll', update, true);
            window.removeEventListener('resize', update);
        };
    }, [isVisible]);

    return (
        <>
            <div
                ref={triggerRef}
                className="inline-flex items-center cursor-help"
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                {children}
            </div>
            {isVisible && rect && createPortal(
                <div
                    className="fixed z-[9999] w-64 max-w-xs bg-slate-900 text-slate-200 text-xs p-2 rounded-lg border border-slate-700 shadow-xl whitespace-pre-wrap text-center leading-relaxed animate-in fade-in zoom-in-95 duration-200"
                    style={{
                        left: rect.left + rect.width / 2,
                        top: rect.top - 8,
                        transform: 'translate(-50%, -100%)',
                        pointerEvents: 'none'
                    }}
                >
                    {content}
                    {/* Arrow */}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-[1px] border-4 border-transparent border-t-slate-900"></div>
                </div>,
                document.body
            )}
        </>
    );
}
