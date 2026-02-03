import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

interface MenuCategory {
    id: string;
    name: string;
}

export interface FoodItemData {
    name: string;
    key: string;
    category_id: string;
    price: number;
    is_veg: boolean;
    active: boolean;
    metadata: {
        veg: boolean;
        jain: boolean;
        vegan: boolean;
        spice_level: 'Mild' | 'Medium' | 'Hot' | null;
        allergens: string[];
    };
    internal_notes: string;
    availability: {
        days: number[]; // 1-7
        start_time: string;
        end_time: string;
        hide_outside: boolean;
    };
}

interface AddFoodItemModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: FoodItemData) => void;
    hotelId: string;
    initialData?: FoodItemData;
}

export default function AddFoodItemModal({ isOpen, onClose, onSave, hotelId, initialData }: AddFoodItemModalProps) {
    const [categories, setCategories] = useState<MenuCategory[]>([]);
    const [loadingCats, setLoadingCats] = useState(false);

    // Form State
    const [name, setName] = useState("");
    const [itemKey, setItemKey] = useState("");
    const [categoryId, setCategoryId] = useState("");
    const [price, setPrice] = useState<string>("");

    // Dietary
    const [isVeg, setIsVeg] = useState(true); // Maps to high level is_veg
    const [isJain, setIsJain] = useState(false);
    const [isVegan, setIsVegan] = useState(false);

    // Spice
    const [spiceLevel, setSpiceLevel] = useState<'Mild' | 'Medium' | 'Hot' | null>(null);

    // Allergens
    const [allergens, setAllergens] = useState<string[]>([]);

    // Availability
    const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
    const [startTime, setStartTime] = useState("06:00");
    const [endTime, setEndTime] = useState("23:00");
    const [hideOutside, setHideOutside] = useState(true);

    // Notes
    const [internalNotes, setInternalNotes] = useState("");

    // Image
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [uploadingImage, setUploadingImage] = useState(false);

    const isEdit = !!initialData;

    useEffect(() => {
        if (isOpen && hotelId) {
            loadCategories();
        }
    }, [isOpen, hotelId]);

    // Populate form on open if initialData provided
    useEffect(() => {
        if (isOpen && initialData) {
            setName(initialData.name);
            setItemKey(initialData.key);
            setCategoryId(initialData.category_id);
            setPrice(initialData.price.toString());
            setIsVeg(initialData.is_veg);

            // Metadata
            if (initialData.metadata) {
                setIsJain(!!initialData.metadata.jain);
                setIsVegan(!!initialData.metadata.vegan);
                setSpiceLevel(initialData.metadata.spice_level || null);
                setAllergens(initialData.metadata.allergens || []);
                setImageUrl(initialData.metadata.image_url || null);
            }

            setInternalNotes(initialData.internal_notes || "");

            // Availability
            if (initialData.availability) {
                setSelectedDays(initialData.availability.days || [1, 2, 3, 4, 5, 6, 7]);
                setStartTime(initialData.availability.start_time || "06:00");
                setEndTime(initialData.availability.end_time || "23:00");
                setHideOutside(initialData.availability.hide_outside ?? true);
            }
        } else if (isOpen && !initialData) {
            // Reset for fresh add
            setName("");
            setItemKey("");
            // Keep category if set, or let loadCategories set default
            setPrice("");
            setIsVeg(true);
            setIsJain(false);
            setIsVegan(false);
            setSpiceLevel(null);
            setAllergens([]);
            setSelectedDays([1, 2, 3, 4, 5, 6, 7]);
            setStartTime("06:00");
            setEndTime("23:00");
            setHideOutside(true);
            setInternalNotes("");
            setImageFile(null);
            setImageUrl(null);
        }
    }, [isOpen, initialData]);

    // Auto-generate key from name ONLY if adding new item
    useEffect(() => {
        if (!isEdit && name) {
            const generated = name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
            setItemKey(generated);
        }
    }, [name, isEdit]);

    const loadCategories = async () => {
        setLoadingCats(true);
        const { data } = await supabase
            .from('menu_categories')
            .select('id, name')
            .eq('hotel_id', hotelId)
            .eq('active', true)
            .order('display_order');

        if (data) {
            setCategories(data);
            if (data.length > 0 && !categoryId && !initialData) {
                setCategoryId(data[0].id);
            }
        }
        setLoadingCats(false);
    };

    const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;

        const file = e.target.files[0];
        setImageFile(file);

        // Create local preview
        const objectUrl = URL.createObjectURL(file);
        setImageUrl(objectUrl);
    };

    const uploadImage = async (file: File): Promise<string | null> => {
        try {
            setUploadingImage(true);
            const fileExt = file.name.split('.').pop();
            // Path structure: hotels/{hotelId}/menu/{timestamp}.{ext}
            const fileName = `hotels/${hotelId}/menu/${Date.now()}.${fileExt}`;
            const filePath = `${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('menu-images')
                .upload(filePath, file);

            if (uploadError) {
                throw uploadError;
            }

            const { data } = supabase.storage
                .from('menu-images')
                .getPublicUrl(filePath);

            return data.publicUrl;
        } catch (error) {
            console.error('Error uploading image:', error);
            alert('Failed to upload image');
            return null;
        } finally {
            setUploadingImage(false);
        }
    };

    const handleSave = async () => {
        if (!name || !price || !categoryId) {
            alert("Please fill in Name, Price and Category");
            return;
        }

        let finalImageUrl = imageUrl;

        // Upload new image if selected
        if (imageFile) {
            const uploadedUrl = await uploadImage(imageFile);
            if (uploadedUrl) {
                finalImageUrl = uploadedUrl;
            } else {
                return; // Stop if upload failed
            }
        }

        const data: FoodItemData = {
            name,
            key: itemKey,
            category_id: categoryId,
            price: parseFloat(price),
            is_veg: isVeg, // Primary flag
            active: true, // Default active on create
            metadata: {
                veg: isVeg,
                jain: isJain,
                vegan: isVegan,
                spice_level: spiceLevel,
                allergens,
                image_url: finalImageUrl
            },
            internal_notes: internalNotes,
            availability: {
                days: selectedDays,
                start_time: startTime,
                end_time: endTime,
                hide_outside: hideOutside
            }
        };
        onSave(data);
        onClose();
    };

    const toggleDay = (day: number) => {
        setSelectedDays(prev =>
            prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
        );
    };

    const toggleAllergen = (allergen: string) => {
        setAllergens(prev =>
            prev.includes(allergen) ? prev.filter(a => a !== allergen) : [...prev, allergen]
        );
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-[#121726] border border-white/10 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col animate-scaleIn">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#1A2040]">
                    <h2 className="text-lg font-semibold text-white">Add Food Item</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Scrollable Body - Two Columns */}
                <div className="flex-1 overflow-y-auto p-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                        {/* Left Column */}
                        <div className="space-y-6">
                            {/* Basic Info */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Basic Info</h3>

                                {/* Image Upload */}
                                <div className="flex items-center gap-4">
                                    <div className="relative w-20 h-20 rounded-lg bg-[#0B0F1A] border border-white/10 flex items-center justify-center overflow-hidden group">
                                        {imageUrl ? (
                                            <img src={imageUrl} alt="Preview" className="w-full h-full object-cover" />
                                        ) : (
                                            <svg className="w-8 h-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                            </svg>
                                        )}
                                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity cursor-pointer">
                                            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                            </svg>
                                        </div>
                                        <input
                                            type="file"
                                            accept="image/*"
                                            onChange={handleImageChange}
                                            className="absolute inset-0 opacity-0 cursor-pointer"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-400 mb-1">Item Image</label>
                                        <div className="text-xs text-slate-500">Tap to upload</div>
                                        {uploadingImage && <div className="text-xs text-blue-400 mt-1">Uploading...</div>}
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-xs font-medium text-slate-400 mb-1">Item Name</label>
                                        <input
                                            type="text"
                                            value={name}
                                            onChange={e => setName(e.target.value)}
                                            className="w-full bg-[#0B0F1A] border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                                            placeholder="e.g. Pasta Alfredo"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-medium text-slate-400 mb-1">Item Key</label>
                                        <input
                                            type="text"
                                            value={itemKey}
                                            readOnly
                                            className="w-full bg-[#0B0F1A] border border-white/10 rounded-lg px-3 py-2 text-slate-500 text-xs font-mono focus:outline-none cursor-not-allowed opacity-75"
                                            placeholder="PASTA_ALFREDO"
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-medium text-slate-400 mb-1">Category</label>
                                            <select
                                                value={categoryId}
                                                onChange={e => setCategoryId(e.target.value)}
                                                className="w-full bg-[#0B0F1A] border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                                            >
                                                <option value="" disabled>Select Category</option>
                                                {categories.map(c => (
                                                    <option key={c.id} value={c.id}>{c.name}</option>
                                                ))}
                                                {categories.length === 0 && !loadingCats && <option value="" disabled>No categories found</option>}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-slate-400 mb-1">Price</label>
                                            <div className="relative">
                                                <span className="absolute left-3 top-2 text-slate-500">₹</span>
                                                <input
                                                    type="number"
                                                    value={price}
                                                    onChange={e => setPrice(e.target.value)}
                                                    className="w-full bg-[#0B0F1A] border border-white/10 rounded-lg pl-7 pr-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                                                    placeholder="0.00"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Availability */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Availability</h3>

                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-2">Days Active</label>
                                    <div className="flex flex-wrap gap-2">
                                        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((dayLabel, idx) => {
                                            const dayNum = idx + 1;
                                            const isSelected = selectedDays.includes(dayNum);
                                            return (
                                                <button
                                                    key={dayNum}
                                                    onClick={() => toggleDay(dayNum)}
                                                    className={`w-8 h-8 rounded-full text-xs font-bold transition-all ${isSelected
                                                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                                                        : 'bg-[#0B0F1A] text-slate-500 border border-white/10 hover:border-white/30'
                                                        }`}
                                                >
                                                    {dayLabel}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-slate-400 mb-1">Start Time</label>
                                        <input
                                            type="time"
                                            value={startTime}
                                            onChange={e => setStartTime(e.target.value)}
                                            className="w-full bg-[#0B0F1A] border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-400 mb-1">End Time</label>
                                        <input
                                            type="time"
                                            value={endTime}
                                            onChange={e => setEndTime(e.target.value)}
                                            className="w-full bg-[#0B0F1A] border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                                        />
                                    </div>
                                </div>

                                <label className="flex items-center gap-2 cursor-pointer group">
                                    <input
                                        type="checkbox"
                                        checked={hideOutside}
                                        onChange={e => setHideOutside(e.target.checked)}
                                        className="w-4 h-4 rounded border-slate-600 bg-[#0B0F1A] text-blue-600 focus:ring-blue-500 transition-all"
                                    />
                                    <span className="text-sm text-slate-300 group-hover:text-white transition-colors">Hide outside availability window</span>
                                </label>
                            </div>
                        </div>

                        {/* Right Column */}
                        <div className="space-y-6">
                            {/* Dietary Info */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Dietary Info</h3>

                                <div className="flex gap-4">
                                    <label className="flex items-center gap-2 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={isVeg}
                                            onChange={e => setIsVeg(e.target.checked)}
                                            className="w-4 h-4 rounded border-slate-600 bg-[#0B0F1A] text-green-500 focus:ring-green-500 transition-all"
                                        />
                                        <span className="text-sm text-slate-300 group-hover:text-white transition-colors">Vegetarian</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={isJain}
                                            onChange={e => setIsJain(e.target.checked)}
                                            className="w-4 h-4 rounded border-slate-600 bg-[#0B0F1A] text-amber-500 focus:ring-amber-500 transition-all"
                                        />
                                        <span className="text-sm text-slate-300 group-hover:text-white transition-colors">Jain</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={isVegan}
                                            onChange={e => setIsVegan(e.target.checked)}
                                            className="w-4 h-4 rounded border-slate-600 bg-[#0B0F1A] text-emerald-500 focus:ring-emerald-500 transition-all"
                                        />
                                        <span className="text-sm text-slate-300 group-hover:text-white transition-colors">Vegan</span>
                                    </label>
                                </div>
                            </div>

                            {/* Spice Level */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Spice Level</h3>
                                <div className="flex gap-3">
                                    {['Mild', 'Medium', 'Hot'].map(level => (
                                        <button
                                            key={level}
                                            onClick={() => setSpiceLevel(level as any === spiceLevel ? null : level as any)}
                                            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${spiceLevel === level
                                                ? 'bg-red-500/10 border-red-500 text-red-500'
                                                : 'bg-[#0B0F1A] border-white/10 text-slate-400 hover:border-white/30'
                                                }`}
                                        >
                                            {level}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Allergens */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Allergens</h3>
                                <div className="grid grid-cols-2 gap-3">
                                    {['Nuts', 'Dairy', 'Gluten', 'Soy', 'Eggs', 'Shellfish'].map(allergen => (
                                        <label key={allergen} className="flex items-center gap-2 cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                checked={allergens.includes(allergen)}
                                                onChange={() => toggleAllergen(allergen)}
                                                className="w-4 h-4 rounded border-slate-600 bg-[#0B0F1A] text-rose-500 focus:ring-rose-500 transition-all"
                                            />
                                            <span className="text-sm text-slate-300 group-hover:text-white transition-colors">{allergen}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Internal Notes */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Internal Notes</h3>
                                <textarea
                                    value={internalNotes}
                                    onChange={e => setInternalNotes(e.target.value)}
                                    placeholder="Add any notes for the kitchen staff..."
                                    className="w-full bg-[#0B0F1A] border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors min-h-[100px] resize-none"
                                />
                            </div>

                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-white/10 bg-[#1A2040] flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-transparent border border-white/10 text-slate-300 rounded-lg hover:bg-white/5 transition-colors font-medium"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={uploadingImage}
                        className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors font-medium shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-wait"
                    >
                        {uploadingImage ? 'Uploading...' : 'Save'}
                    </button>
                </div>

            </div>
        </div>
    );
}
