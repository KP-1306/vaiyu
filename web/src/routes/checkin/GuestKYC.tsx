import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
    ArrowRight,
    Camera,
    UploadCloud,
    Loader2,
    CheckCircle2,
    AlertCircle
} from "lucide-react";
import { supabase } from "../../lib/supabase";

export default function GuestKYC() {
    const navigate = useNavigate();
    const location = useLocation();
    const booking = location.state?.booking;

    // Form State
    const [formData, setFormData] = useState({
        full_name: booking?.guest_name || "",
        mobile: booking?.phone || "",
        email: booking?.email || "",
        nationality: "Indian",
        address: "",
        id_type: "aadhaar",
        id_number: "",
    });

    const [frontImage, setFrontImage] = useState<File | null>(null);
    const [backImage, setBackImage] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);

    // Validation State
    const [errors, setErrors] = useState<Record<string, string>>({});

    if (!booking) {
        return (
            <div className="text-center pt-20">
                <h2 className="text-xl font-semibold text-slate-800">Session expired</h2>
                <button onClick={() => navigate("../booking")} className="mt-4 text-indigo-600 underline font-medium">Restart Check-in</button>
            </div>
        );
    }

    const validate = () => {
        const newErrors: Record<string, string> = {};

        // Name
        if (!formData.full_name.trim()) newErrors.full_name = "Full Name is required";
        else if (formData.full_name.trim().length < 3) newErrors.full_name = "Name must be at least 3 characters";

        // Mobile
        if (!formData.mobile.trim()) newErrors.mobile = "Mobile Number is required";
        else if (!/^\d{10}$/.test(formData.mobile.replace(/\D/g, ''))) newErrors.mobile = "Enter a valid 10-digit mobile number";

        // Email (Optional but valid if entered)
        if (formData.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
            newErrors.email = "Enter a valid email address";
        }

        // Address
        if (!formData.address.trim()) newErrors.address = "Address is required";
        else if (formData.address.trim().length < 5) newErrors.address = "Address is too short";

        // ID Number
        if (!formData.id_number.trim()) {
            newErrors.id_number = "ID Number is required";
        } else {
            // Basic regex checks based on ID type (Optional refinement)
            if (formData.id_type === 'aadhaar' && !/^\d{12}$/.test(formData.id_number.replace(/\s/g, ''))) {
                newErrors.id_number = "Enter valid 12-digit Aadhaar number";
            } else if (formData.id_type === 'pan' && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(formData.id_number)) {
                newErrors.id_number = "Enter valid PAN format (e.g. ABCDE1234F)";
            }
        }

        // Front Image
        if (!frontImage) newErrors.frontImage = "Front side ID photo is required";

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, side: 'front' | 'back') => {
        if (e.target.files && e.target.files[0]) {
            if (side === 'front') {
                setFrontImage(e.target.files[0]);
                setErrors(prev => ({ ...prev, frontImage: '' })); // Clear error
            }
            else setBackImage(e.target.files[0]);
        }
    };

    async function uploadFile(file: File, path: string) {
        const { data, error } = await supabase.storage
            .from('guest-documents')
            .upload(path, file);
        if (error) throw error;
        return data.path;
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        if (!validate()) {
            // Scroll to top or first error could be implemented here
            return;
        }

        setUploading(true);

        try {
            // 1. Upload Images
            let frontPath = null;
            let backPath = null;
            const timestamp = Date.now();

            if (frontImage) {
                const folderId = booking.guest_id || booking.id;
                // Path: {hotel_id}/kiosk/{guest_id}/filename
                const path = `${booking.hotel_id}/kiosk/${folderId}/front_${timestamp}_${frontImage.name}`;
                frontPath = await uploadFile(frontImage, path);
            }
            if (backImage) {
                const folderId = booking.guest_id || booking.id;
                const path = `${booking.hotel_id}/kiosk/${folderId}/back_${timestamp}_${backImage.name}`;
                backPath = await uploadFile(backImage, path);
            }

            // 2. Prepare Guest Details Object for next step
            const guestDetails = {
                ...formData,
                front_image_path: frontPath,
                back_image_path: backPath,
            };

            navigate("../room-assignment", {
                state: {
                    booking,
                    guestDetails
                }
            });

        } catch (err: any) {
            console.error(err);
            alert("Error uploading documents: " + err.message);
        } finally {
            setUploading(false);
        }
    }

    return (
        <div className="mx-auto max-w-3xl space-y-8 pb-12">
            <div className="text-center space-y-2">
                <h2 className="text-3xl font-light text-slate-900">Guest Details & KYC</h2>
                <p className="text-slate-500">Please provide your identification details.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-8">
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    {/* Personal Info */}
                    <div className="space-y-4 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
                        <h3 className="text-lg font-semibold text-slate-900 mb-4">Personal Information</h3>

                        <div>
                            <label className="block text-sm font-medium text-slate-700">Full Name <span className="text-red-500">*</span></label>
                            <input
                                className={`mt-1 block w-full rounded-xl border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 ${errors.full_name ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}`}
                                value={formData.full_name}
                                onChange={e => {
                                    setFormData({ ...formData, full_name: e.target.value });
                                    if (errors.full_name) setErrors(prev => ({ ...prev, full_name: '' }));
                                }}
                            />
                            {errors.full_name && <p className="mt-1 text-sm text-red-600 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {errors.full_name}</p>}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700">Mobile Number <span className="text-red-500">*</span></label>
                            <input
                                type="tel"
                                maxLength={10}
                                className={`mt-1 block w-full rounded-xl border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 ${errors.mobile ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}`}
                                value={formData.mobile}
                                onChange={e => {
                                    setFormData({ ...formData, mobile: e.target.value.replace(/\D/g, '') });
                                    if (errors.mobile) setErrors(prev => ({ ...prev, mobile: '' }));
                                }}
                            />
                            {errors.mobile && <p className="mt-1 text-sm text-red-600 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {errors.mobile}</p>}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700">Email</label>
                            <input
                                type="email"
                                className={`mt-1 block w-full rounded-xl border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 ${errors.email ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}`}
                                value={formData.email}
                                onChange={e => {
                                    setFormData({ ...formData, email: e.target.value });
                                    if (errors.email) setErrors(prev => ({ ...prev, email: '' }));
                                }}
                            />
                            {errors.email && <p className="mt-1 text-sm text-red-600 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {errors.email}</p>}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700">Nationality <span className="text-red-500">*</span></label>
                            <select
                                className="mt-1 block w-full rounded-xl border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                                value={formData.nationality}
                                onChange={e => setFormData({ ...formData, nationality: e.target.value })}
                            >
                                <option value="Indian">Indian</option>
                                <option value="Other">Other (International)</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700">Address <span className="text-red-500">*</span></label>
                            <textarea
                                rows={2}
                                className={`mt-1 block w-full rounded-xl border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 ${errors.address ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}`}
                                value={formData.address}
                                onChange={e => {
                                    setFormData({ ...formData, address: e.target.value });
                                    if (errors.address) setErrors(prev => ({ ...prev, address: '' }));
                                }}
                            />
                            {errors.address && <p className="mt-1 text-sm text-red-600 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {errors.address}</p>}
                        </div>
                    </div>

                    {/* ID Proof */}
                    <div className="space-y-4 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
                        <h3 className="text-lg font-semibold text-slate-900 mb-4">Identity Proof</h3>

                        <div>
                            <label className="block text-sm font-medium text-slate-700">ID Type <span className="text-red-500">*</span></label>
                            <select
                                className="mt-1 block w-full rounded-xl border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                                value={formData.id_type}
                                onChange={e => setFormData({ ...formData, id_type: e.target.value })}
                            >
                                <option value="aadhaar">Aadhaar Card</option>
                                <option value="pan">PAN Card</option>
                                <option value="passport">Passport</option>
                                <option value="driving_license">Driving License</option>
                                <option value="other">Other</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700">ID Number <span className="text-red-500">*</span></label>
                            <input
                                className={`mt-1 block w-full rounded-xl border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 ${errors.id_number ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}`}
                                value={formData.id_number}
                                onChange={e => {
                                    setFormData({ ...formData, id_number: e.target.value.toUpperCase() });
                                    if (errors.id_number) setErrors(prev => ({ ...prev, id_number: '' }));
                                }}
                                placeholder="XXXX-XXXX-XXXX"
                            />
                            {errors.id_number && <p className="mt-1 text-sm text-red-600 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {errors.id_number}</p>}
                        </div>

                        <div className="pt-4 space-y-4">
                            {/* Front Image */}
                            <div>
                                <div className={`relative block w-full rounded-xl border-2 border-dashed p-4 text-center hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${errors.frontImage ? 'border-red-300 bg-red-50' : 'border-slate-300'}`}>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                        onChange={(e) => handleFileChange(e, 'front')}
                                    />
                                    {frontImage ? (
                                        <div className="flex items-center justify-center gap-2 text-green-600">
                                            <CheckCircle2 className="h-5 w-5" />
                                            <span className="text-sm font-medium truncate">{frontImage.name}</span>
                                        </div>
                                    ) : (
                                        <div className="text-slate-500">
                                            <Camera className={`mx-auto h-8 w-8 ${errors.frontImage ? 'text-red-400' : 'text-slate-400'}`} />
                                            <span className={`mt-2 block text-sm font-medium ${errors.frontImage ? 'text-red-600' : ''}`}>Capture Front Side <span className="text-red-500">*</span></span>
                                        </div>
                                    )}
                                </div>
                                {errors.frontImage && <p className="mt-1 text-sm text-red-600 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {errors.frontImage}</p>}
                            </div>

                            {/* Back Image */}
                            <div className="relative block w-full rounded-xl border-2 border-dashed border-slate-300 p-4 text-center hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">
                                <input
                                    type="file"
                                    accept="image/*"
                                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                    onChange={(e) => handleFileChange(e, 'back')}
                                />
                                {backImage ? (
                                    <div className="flex items-center justify-center gap-2 text-green-600">
                                        <CheckCircle2 className="h-5 w-5" />
                                        <span className="text-sm font-medium truncate">{backImage.name}</span>
                                    </div>
                                ) : (
                                    <div className="text-slate-500">
                                        <UploadCloud className="mx-auto h-8 w-8 text-slate-400" />
                                        <span className="mt-2 block text-sm font-medium">Upload Back Side (Optional)</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="pt-4">
                    <div className="flex gap-4">
                        <button
                            type="button"
                            onClick={() => navigate("../details", { state: { booking } })}
                            className="flex-1 rounded-2xl bg-white px-8 py-4 text-lg font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 transition-all active:scale-[0.99]"
                        >
                            Back
                        </button>
                        <button
                            type="submit"
                            disabled={uploading}
                            className="flex-[2] flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-8 py-4 text-lg font-semibold text-white shadow-md hover:bg-indigo-500 disabled:opacity-50 transition-all active:scale-[0.99]"
                        >
                            {uploading ? (
                                <Loader2 className="h-6 w-6 animate-spin" />
                            ) : (
                                <>
                                    Continue to Room Selection <ArrowRight className="h-5 w-5" />
                                </>
                            )}
                        </button>
                    </div>
                    {Object.keys(errors).length > 0 && (
                        <p className="mt-3 text-center text-sm text-red-600">Please fix the errors above to continue.</p>
                    )}
                </div>
            </form>
        </div>
    );
}
