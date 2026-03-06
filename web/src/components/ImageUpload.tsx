import React, { useState, useRef } from 'react';
import { Upload, X, Image as ImageIcon, Loader2, RefreshCw, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface ImageUploadProps {
    value?: string;
    onChange: (url: string) => void;
    label: string;
    aspectRatio?: '1:1' | '16:9';
    helperText?: string;
    className?: string;
    pathPrefix?: string | null;
    fileName?: string;
}

export const ImageUpload: React.FC<ImageUploadProps> = ({
    value,
    onChange,
    label,
    aspectRatio = '1:1',
    helperText,
    className = "",
    pathPrefix,
    fileName
}) => {
    const [uploading, setUploading] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFile = async (file: File) => {
        if (!file.type.startsWith('image/')) return;
        if (!pathPrefix) return;

        setUploading(true);

        try {
            const fileExt = file.name.split('.').pop() || 'png';
            const finalName = fileName
                ? `${fileName}`
                : `${Math.random().toString(36).substring(2, 15)}_${Date.now()}.${fileExt}`;

            const filePath = `${pathPrefix}/${finalName}`;

            const { error: uploadError } = await supabase.storage
                .from('hotel-assets')
                .upload(filePath, file, { upsert: true });

            if (uploadError) {
                throw uploadError;
            }

            const { data } = supabase.storage
                .from('hotel-assets')
                .getPublicUrl(filePath);

            // Add cache buster since we use upsert with fixed names
            const cacheBustedUrl = `${data.publicUrl}?t=${Date.now()}`;
            onChange(cacheBustedUrl);
        } catch (error) {
            console.error('Error uploading image:', error);
            alert('Error uploading image. Please try again.');
        } finally {
            setUploading(false);
        }
    };

    const onDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFile(e.dataTransfer.files[0]);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
    };

    const removeImage = (e: React.MouseEvent) => {
        e.stopPropagation();
        onChange("");
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const aspectClass = aspectRatio === '1:1' ? 'aspect-square max-w-[220px]' : 'aspect-video w-full';

    return (
        <div className={`space-y-3 ${className}`}>
            <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.1em] block">
                    {label}
                </label>
                {value && (
                    <span className="text-[10px] font-bold text-emerald-500 uppercase flex items-center gap-1 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                        <Check size={10} strokeWidth={3} /> Ready
                    </span>
                )}
            </div>

            <div
                className={`
                    relative group cursor-pointer overflow-hidden rounded-[24px] transition-all duration-500 ease-out
                    ${aspectClass}
                    ${value
                        ? 'bg-slate-900 border border-indigo-500/20 shadow-xl shadow-indigo-500/10'
                        : 'bg-[#0f111a] border border-slate-700/50 hover:border-indigo-500/40 hover:bg-[#131622] shadow-inner shadow-black/20'
                    }
                    }
                    ${dragActive && pathPrefix ? 'scale-[0.98] ring-4 ring-indigo-500/20 border-indigo-500 !bg-indigo-500/5' : ''}
                    ${!pathPrefix ? 'opacity-50 cursor-not-allowed grayscale' : ''}
                `}
                onDragEnter={pathPrefix ? onDrag : undefined}
                onDragLeave={pathPrefix ? onDrag : undefined}
                onDragOver={pathPrefix ? onDrag : undefined}
                onDrop={pathPrefix ? onDrop : undefined}
                onClick={() => pathPrefix && fileInputRef.current?.click()}
            >
                {/* Background Pattern for Empty State */}
                {!value && !uploading && (
                    <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: `radial-gradient(#6366f1 0.5px, transparent 0.5px)`, backgroundSize: '12px 12px' }}></div>
                )}

                {!pathPrefix && !value && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/60 backdrop-blur-sm z-10 px-4 text-center">
                        <span className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-1">Upload Locked</span>
                        <span className="text-[10px] text-slate-500 font-medium">Please Save & Continue first</span>
                    </div>
                )}

                <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept="image/*"
                    onChange={handleChange}
                />

                {uploading ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-md z-10 transition-all duration-500">
                        <div className="relative">
                            <div className="w-12 h-12 rounded-full border-2 border-indigo-500/20 border-t-indigo-500 animate-spin"></div>
                            <Upload className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-indigo-400" size={18} />
                        </div>
                        <span className="mt-4 text-[10px] font-bold text-indigo-300 uppercase tracking-[0.2em] animate-pulse">Processing</span>
                    </div>
                ) : value ? (
                    <>
                        <img
                            src={value}
                            alt={label}
                            className="w-full h-full object-cover transition-all duration-700 group-hover:scale-110 group-hover:blur-[2px]"
                        />
                        {/* Premium Overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-900/20 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-500 flex flex-col items-center justify-center gap-4 backdrop-blur-[4px]">
                            <div className="flex gap-3 scale-90 group-hover:scale-100 transition-transform duration-500">
                                <div className="p-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-2xl text-white shadow-2xl backdrop-blur-xl transition-all">
                                    <RefreshCw size={18} strokeWidth={2.5} />
                                </div>
                                <button
                                    onClick={removeImage}
                                    className="p-3 bg-rose-500/20 hover:bg-rose-500/40 border border-rose-500/40 rounded-2xl text-rose-400 shadow-2xl backdrop-blur-xl transition-all"
                                >
                                    <X size={18} strokeWidth={2.5} />
                                </button>
                            </div>
                            <span className="text-[10px] font-bold text-white/60 uppercase tracking-widest">Update {label}</span>
                        </div>
                    </>
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center select-none">
                        {/* Icon Container */}
                        <div className="relative mb-4 group-hover:scale-110 transition-transform duration-500">
                            <div className="w-14 h-14 rounded-[20px] bg-slate-800/40 flex items-center justify-center text-slate-400 group-hover:bg-indigo-500/10 group-hover:text-indigo-400 border border-slate-700/50 group-hover:border-indigo-500/30 transition-all duration-500 shadow-lg">
                                <Upload size={24} strokeWidth={1.5} />
                            </div>
                            {/* Decorative Blur */}
                            <div className="absolute -inset-2 bg-indigo-500/20 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
                        </div>

                        <div className="space-y-1.5">
                            <p className="text-[13px] font-semibold text-slate-200 group-hover:text-white transition-colors">
                                Click or drag to upload
                            </p>
                            <p className="text-[10px] text-slate-500 font-medium group-hover:text-slate-400 transition-colors uppercase tracking-wider">
                                {helperText || 'PNG, JPG or WebP'}
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
