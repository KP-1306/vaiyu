import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import {
    UploadCloud,
    FileSpreadsheet,
    CheckCircle,
    AlertTriangle,
    X,
    ChevronRight,
    Loader2,
    Download,
    RefreshCw,
    Save,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { parseBookingCSV, BookingCSVRow, normalizePhone } from "../utils/csvParser";
import { generateErrorExcel } from "../utils/excelGenerator";
import "./ImportBookings.css";

/* --- Types --- */
type ImportStep = "UPLOAD_AND_MAP" | "PREVIEW" | "PROCESSING" | "COMPLETED";

interface RoomType {
    id: string;
    name: string;
}

interface Room {
    id: string;
    number: string;
    room_type_id: string;
}

interface ValidationResult {
    row: BookingCSVRow;
    originalIndex: number;
    isValid: boolean;
    errors: string[];
    fieldErrors: Record<string, boolean>;
    parsed: {
        room_id?: string;
        room_type_id?: string;
        checkin_date?: string;
        checkout_date?: string;
        [key: string]: any;
    };
}

export default function ImportBookings() {
    const { slug } = useParams<{ slug: string }>();

    // State
    const [step, setStep] = useState<ImportStep>("UPLOAD_AND_MAP");
    const [file, setFile] = useState<File | null>(null);
    const [csvData, setCsvData] = useState<BookingCSVRow[]>([]);
    const [mappings, setMappings] = useState<Record<string, string>>({});
    const [savedMappings, setSavedMappings] = useState<Record<string, string>>({});
    const [mappingSaved, setMappingSaved] = useState(false);
    const [savingMapping, setSavingMapping] = useState(false);
    const [validationResults, setValidationResults] = useState<ValidationResult[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);

    // Server-side State
    const [batchId, setBatchId] = useState<string | null>(null);
    const [batchStats, setBatchStats] = useState({ total: 0, imported: 0, errors: 0 });

    // Data Loading
    const [hotelId, setHotelId] = useState<string | null>(null);
    const [hotelName, setHotelName] = useState<string>("");
    const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
    const [rooms, setRooms] = useState<Room[]>([]);

    // DB Fields definition
    const DB_FIELDS = [
        { label: "Hotel Slug", value: "hotel_slug", required: false },
        { label: "Booking Reference", value: "booking_reference", required: true },
        { label: "Booking Status", value: "booking_status", required: false },
        { label: "Guest Name", value: "guest_name", required: true },
        { label: "Phone Number", value: "guest_phone", required: false },
        { label: "Email", value: "guest_email", required: false },
        { label: "Check-In Date", value: "checkin_date", required: true },
        { label: "Check-Out Date", value: "checkout_date", required: true },
        { label: "Room Number", value: "room_number", required: false },
        { label: "Room Type", value: "room_type_name", required: false },
        { label: "Adults", value: "adults", required: false },
        { label: "Children", value: "children", required: false },
        { label: "Special Requests", value: "special_requests", required: false },
        { label: "Room Sequence", value: "room_seq", required: false },
        { label: "Guest Sequence", value: "guest_seq", required: false },
        { label: "Primary Guest Flag", value: "primary_guest_flag", required: false },
        { label: "Rate Plan", value: "rate_plan", required: false },
        { label: "Total Amount", value: "total_amount", required: false },
    ];

    // Fetch hotel and lookup data
    useEffect(() => {
        if (!slug) return;
        supabase.from("hotels").select("id, name").eq("slug", slug).single()
            .then(({ data, error }) => {
                if (data) {
                    setHotelId(data.id);
                    setHotelName(data.name);
                    fetchLookups(data.id);
                    loadSavedMapping(data.id);
                } else {
                    console.error("Hotel not found", error);
                }
            });
    }, [slug]);

    const fetchLookups = async (hId: string) => {
        const { data: rt } = await supabase.from("room_types").select("id, name").eq("hotel_id", hId);
        if (rt) setRoomTypes(rt);
        const { data: r } = await supabase.from("rooms").select("id, number, room_type_id").eq("hotel_id", hId);
        if (r) setRooms(r);
    };

    // Polling Effect
    useEffect(() => {
        let interval: any;
        if (step === "PROCESSING" && batchId) {
            interval = setInterval(async () => {
                const { data: batch } = await supabase
                    .from("import_batches")
                    .select("status, total_rows, imported_rows, error_rows")
                    .eq("id", batchId)
                    .single();

                if (batch) {
                    setBatchStats({
                        total: batch.total_rows || 0,
                        imported: batch.imported_rows || 0,
                        errors: batch.error_rows || 0
                    });

                    if (batch.status === "completed" || batch.status === "failed") {
                        setIsProcessing(false);
                        setStep("COMPLETED");
                        clearInterval(interval);
                    }
                }
            }, 2000);
        }
        return () => { if (interval) clearInterval(interval); };
    }, [step, batchId]);

    /* --- Handlers --- */
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const droppedFile = e.dataTransfer.files?.[0];
        if (droppedFile && droppedFile.name.endsWith(".csv")) {
            handleFileUpload(droppedFile);
        } else if (droppedFile) {
            alert("Please upload a valid CSV file.");
        }
    };

    // Helper: Generate mappings from headers
    const generateMappings = (headers: string[]) => {
        const suggested: Record<string, string> = {};
        headers.forEach(h => {
            const lower = h.toLowerCase().trim();
            const clean = lower.replace(/[\s_]+/g, "");

            // 1. Exact matches (priority)
            if (lower === "hotel_slug" || lower === "hotelslug") suggested[h] = "hotel_slug";
            else if (lower === "booking_reference" || lower === "bookingref" || lower === "bookingid") suggested[h] = "booking_reference";
            else if (lower === "booking_status" || lower === "status") suggested[h] = "booking_status";
            else if (lower === "room_type_name" || lower === "roomtype" || lower === "roomtypename") suggested[h] = "room_type_name";
            else if (lower === "room_number" || lower === "roomno" || lower === "room") suggested[h] = "room_number";
            else if (lower === "room_seq" || lower === "roomseq") suggested[h] = "room_seq";
            else if (lower === "guest_seq" || lower === "guestseq") suggested[h] = "guest_seq";
            else if (lower === "primary_guest_flag" || lower === "primaryguest" || lower === "isprimary") suggested[h] = "primary_guest_flag";
            else if (lower === "rate_plan" || lower === "rate") suggested[h] = "rate_plan";
            else if (lower === "total_amount" || lower === "amount" || lower === "total") suggested[h] = "total_amount";

            // 2. Fuzzy/Heuristic matches (fallback)
            else if (clean.includes("guest") && clean.includes("name")) suggested[h] = "guest_name";
            else if (clean.includes("phone") || clean.includes("mobile")) suggested[h] = "guest_phone";
            else if (clean.includes("email")) suggested[h] = "guest_email";
            else if (clean.includes("checkin") || clean.includes("arrival")) suggested[h] = "checkin_date";
            else if (clean.includes("checkout") || clean.includes("departure")) suggested[h] = "checkout_date";
            else if (clean.includes("adult")) suggested[h] = "adults";
            else if (clean.includes("child")) suggested[h] = "children";
            else if (clean.includes("special") || clean.includes("request")) suggested[h] = "special_requests";
        });
        return suggested;
    };

    // --- Save/Load Mapping ---
    const loadSavedMapping = async (hId: string) => {
        const { data } = await supabase
            .from("hotel_import_mappings")
            .select("csv_column, vaiyu_field")
            .eq("hotel_id", hId)
            .eq("mapping_name", "default");

        if (data && data.length > 0) {
            const saved: Record<string, string> = {};
            data.forEach((row: any) => { saved[row.csv_column] = row.vaiyu_field; });
            setSavedMappings(saved);
        }
    };

    const saveMapping = async () => {
        if (!hotelId || savingMapping) return;
        const entries = Object.entries(mappings).filter(([, v]) => v);
        if (entries.length === 0) return;

        setSavingMapping(true);

        // Delete old mapping for this hotel, then insert new
        await supabase
            .from("hotel_import_mappings")
            .delete()
            .eq("hotel_id", hotelId)
            .eq("mapping_name", "default");

        const rows = entries.map(([csvCol, vaiyuField]) => ({
            hotel_id: hotelId,
            mapping_name: "default",
            csv_column: csvCol,
            vaiyu_field: vaiyuField,
        }));

        const { error } = await supabase.from("hotel_import_mappings").insert(rows);
        setSavingMapping(false);
        if (error) {
            console.error("Save mapping error:", error);
        } else {
            setSavedMappings({ ...mappings });
            setMappingSaved(true);
            setTimeout(() => setMappingSaved(false), 2000);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement> | File) => {
        const uploadedFile = e instanceof File ? e : e.target.files?.[0];
        if (!uploadedFile) return;
        setFile(uploadedFile);

        try {
            const result = await parseBookingCSV(uploadedFile);
            setCsvData(result.data);
            const headers = result.meta.fields || [];

            // Priority: apply saved mapping if columns match, else auto-suggest
            if (Object.keys(savedMappings).length > 0) {
                const applied: Record<string, string> = {};
                headers.forEach(h => {
                    if (savedMappings[h]) applied[h] = savedMappings[h];
                });
                // If at least half the columns matched saved mapping, use it
                if (Object.keys(applied).length >= Math.min(headers.length, Object.keys(savedMappings).length) * 0.5) {
                    setMappings(applied);
                } else {
                    setMappings(generateMappings(headers));
                }
            } else if (Object.keys(mappings).length === 0) {
                setMappings(generateMappings(headers));
            }
        } catch (err) {
            alert("Error parsing CSV: " + err);
        }
    };

    const autoSuggestMapping = () => {
        if (!csvData.length) return;
        const headers = Object.keys(csvData[0]);
        const suggested = generateMappings(headers);
        setMappings(suggested);
    };

    const handleMappingChange = (csvHeader: string, dbField: string) => {
        setMappings(prev => ({ ...prev, [csvHeader]: dbField }));
    };

    const runValidation = () => {
        const results: ValidationResult[] = csvData.map((row, idx) => {
            const errors: string[] = [];
            const fieldErrors: Record<string, boolean> = {};
            const parsed: any = {};

            const getVal = (field: string) => {
                const header = Object.keys(mappings).find(key => mappings[key] === field);
                return header && row[header] ? row[header].trim() : undefined;
            };

            // Extract Fields via Mapping
            parsed.booking_reference = getVal("booking_reference");
            parsed.booking_status = getVal("booking_status");
            parsed.guest_name = getVal("guest_name");
            parsed.guest_email = getVal("guest_email");
            parsed.guest_phone = getVal("guest_phone");
            parsed.checkin_date = getVal("checkin_date");
            parsed.checkout_date = getVal("checkout_date");
            parsed.room_type_name = getVal("room_type_name");
            parsed.room_number = getVal("room_number");
            parsed.adults = getVal("adults");
            parsed.children = getVal("children");
            parsed.special_requests = getVal("special_requests");
            parsed.room_seq = getVal("room_seq");
            parsed.guest_seq = getVal("guest_seq");
            parsed.primary_guest_flag = getVal("primary_guest_flag");
            parsed.rate_plan = getVal("rate_plan");
            parsed.total_amount = getVal("total_amount");
            parsed.hotel_slug = getVal("hotel_slug");

            // --- Validators ---

            // 1. Required Fields
            if (!parsed.booking_reference) { errors.push("Missing Booking Ref"); fieldErrors["booking_reference"] = true; }
            if (!parsed.guest_name) { errors.push("Missing Guest Name"); fieldErrors["guest_name"] = true; }

            // 2. Dates
            if (!parsed.checkin_date) {
                errors.push("Missing Check-in"); fieldErrors["checkin_date"] = true;
            } else if (isNaN(Date.parse(parsed.checkin_date))) {
                errors.push("Invalid Check-in Date"); fieldErrors["checkin_date"] = true;
            }

            if (!parsed.checkout_date) {
                errors.push("Missing Check-out"); fieldErrors["checkout_date"] = true;
            } else if (isNaN(Date.parse(parsed.checkout_date))) {
                errors.push("Invalid Check-out Date"); fieldErrors["checkout_date"] = true;
            }

            if (parsed.checkin_date && parsed.checkout_date && !fieldErrors["checkin_date"] && !fieldErrors["checkout_date"]) {
                if (new Date(parsed.checkin_date) >= new Date(parsed.checkout_date)) {
                    errors.push("Check-out must be after Check-in");
                    fieldErrors["checkout_date"] = true;
                }
            }

            // 3. Contact Info (Phone OR Email)
            // Note: For multi-room bookings, only primary guest needs contact info usually.
            // But we validate row-level here. 
            // IMPROVEMENT: If primary_guest_flag is set, enforce contact.

            const rawPhone = parsed.guest_phone;
            const rawEmail = parsed.guest_email;
            const isPrimary = parsed.primary_guest_flag === "true" || parsed.primary_guest_flag === "1" || parsed.primary_guest_flag === "yes";

            if (!rawPhone && !rawEmail) {
                // If primary_guest_flag is mapped, only enforce contact for primary guests.
                // If NOT mapped (legacy), enforce for everyone to be safe.
                const hasPrimaryFlagMapped = Object.values(mappings).includes("primary_guest_flag");

                if (hasPrimaryFlagMapped) {
                    if (isPrimary) {
                        errors.push("Missing Contact (Phone or Email)");
                        fieldErrors["guest_phone"] = true; // Mark phone as missing
                        // fieldErrors["guest_email"] = true; // Mark email as missing (optional if phone exists)
                    }
                } else {
                    // Legacy: Require contact for everyone
                    errors.push("Missing Contact (Phone or Email)");
                    fieldErrors["guest_phone"] = true;
                    fieldErrors["guest_email"] = true;
                }
            }

            if (rawPhone) {
                parsed.phone = normalizePhone(rawPhone);
                if (parsed.phone.length < 5) { errors.push("Invalid Phone"); fieldErrors["guest_phone"] = true; }
            }

            if (rawEmail) {
                // Basic email regex
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(rawEmail)) {
                    errors.push("Invalid Email"); fieldErrors["guest_email"] = true;
                }
            }

            // 4. Numeric Fields (Adults/Children)
            if (parsed.adults) {
                const num = parseInt(parsed.adults, 10);
                if (isNaN(num) || num < 1) {
                    errors.push("Invalid Adults"); fieldErrors["adults"] = true;
                }
            }
            if (parsed.children) {
                const num = parseInt(parsed.children, 10);
                if (isNaN(num) || num < 0) {
                    errors.push("Invalid Children"); fieldErrors["children"] = true;
                }
            }

            return { row, originalIndex: idx, isValid: errors.length === 0, errors, fieldErrors, parsed };
        });

        // 5. Group Validation (Booking Level)
        const bookingGroups: Record<string, boolean> = {};
        results.forEach(r => {
            if (r.parsed.booking_reference) {
                if (r.parsed.primary_guest_flag === "true" || r.parsed.primary_guest_flag === "1" || r.parsed.primary_guest_flag === "yes") {
                    bookingGroups[r.parsed.booking_reference] = true;
                }
            }
        });

        // If 'primary_guest_flag' column exists map-wise, ensure at least one primary per booking
        const hasPrimaryFlagMapped = Object.values(mappings).includes("primary_guest_flag");
        if (hasPrimaryFlagMapped) {
            results.forEach(r => {
                if (r.parsed.booking_reference && !bookingGroups[r.parsed.booking_reference]) {
                    // No primary guest found for this booking ref
                    // r.errors.push("No Primary Guest for this Booking");
                    // r.isValid = false; 
                    // Actually, let's just warn or assume first row is primary if none set?
                    // User requirement: "Validate that for each booking_reference, there is at least one row with primary_guest_flag=true"
                    // We will mark it invalid for now to enforce data quality
                    // But we only do this if this specific row is the first one for the booking? 
                    // Or just mark all rows invalid? Marking all is safer.
                    r.isValid = false;
                    r.errors.push("Booking missing Primary Guest flag");
                }
            });
        }

        setValidationResults(results);
        setStep("PREVIEW");
    };

    const executeImport = async () => {
        if (!hotelId || !file) return;
        setIsProcessing(true);

        // Build CSV from only valid rows
        const validRows = validationResults.filter(r => r.isValid);
        if (validRows.length === 0) {
            setIsProcessing(false);
            return;
        }

        const headers = Object.keys(validRows[0].row);
        const csvLines = [
            headers.join(","),
            ...validRows.map(r => headers.map(h => {
                const val = String((r.row as any)[h] ?? "");
                // Escape values containing commas, quotes, or newlines
                return val.includes(",") || val.includes('"') || val.includes("\n")
                    ? `"${val.replace(/"/g, '""')}"`
                    : val;
            }).join(","))
        ];
        const csvBlob = new Blob([csvLines.join("\n")], { type: "text/csv" });
        const filteredFile = new File([csvBlob], file.name, { type: "text/csv" });

        const formData = new FormData();
        formData.append("file", filteredFile);
        formData.append("hotel_id", hotelId);
        formData.append("mappings", JSON.stringify(mappings));

        try {
            const { data, error } = await supabase.functions.invoke("upload-import-csv", { body: formData });
            console.log("Upload Response Data:", data);
            console.log("Upload Response Error:", error);

            if (error) throw error;
            if (!data || !data.batchId) {
                console.error("Missing batchId in data:", data);
                throw new Error("No batch ID returned");
            }

            setBatchId(data.batchId);
            setStep("PROCESSING");

            // Kickstart Worker Loop
            const triggerWorker = async () => {
                try {
                    console.log("Triggering worker...");
                    const { data: res, error: workerErr } = await supabase.functions.invoke("process-import-rows", {
                        body: {}
                    });

                    if (workerErr) {
                        console.warn("Worker Invocation Warning:", workerErr);
                        // Don't throw, let DB polling handle status. Recursion stops here.
                        return;
                    }

                    console.log("Worker Response Payload:", res);

                    // Normalize count (handle both old and new keys for safety)
                    const count = (res?.processed !== undefined) ? res.processed : (res?.processed_groups || 0);

                    // If rows were processed (success or error), trigger again immediately (Recursive Loop)
                    // NOTE: UI progress is driven by DB polling (batchStats), not this response.
                    if (count > 0) {
                        console.log(`Worker processed ${count} items. Continuing recursion...`);
                        await triggerWorker();
                    } else {
                        console.log("Worker finished batch or no pending rows.");
                    }
                } catch (e) {
                    console.error("Worker Trigger Failed (Recursion Stopped):", e);
                }
            };

            // Start the loop without awaiting it (letting UI poll for status)
            triggerWorker();

        } catch (err: any) {
            alert(err.message);
            setIsProcessing(false);
        }
    };

    const downloadTemplate = () => {
        const headers = "hotel_slug,booking_reference,booking_status,checkin_date,checkout_date,room_seq,room_type_name,room_number,adults,children,guest_seq,guest_name,guest_phone,guest_email,primary_guest_flag";
        const rows = [
            "TENANT1,BKG10021,CONFIRMED,2026-03-10,2026-03-12,1,Deluxe,401,2,0,1,Ajit Kumar Singh,,ajitkumarpes@email.com,true",
            "TENANT1,BKG10021,CONFIRMED,2026-03-10,2026-03-12,1,Deluxe,401,2,0,2,Rahul Singh,,,",
            "TENANT1,BKG10021,CONFIRMED,2026-03-10,2026-03-12,2,Suite,601,2,1,1,Priya Singh,,,",
            "TENANT1,BKG10045,CONFIRMED,2026-03-15,2026-03-17,1,Deluxe,405,1,0,1,Ramesh Patel,,ajitsan@email.com,true",
            "TENANT1,BKG10046,CANCELLED,2026-03-20,2026-03-21,1,Standard,305,1,0,1,Sneha Sharma,,singhajit.br@email.com,true"
        ];

        const csvContent = [headers, ...rows].join("\n");
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", "bookings_sample.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const downloadErrorFile = async () => {
        const errorRows = validationResults
            .filter(r => !r.isValid)
            .map(r => ({
                row: r.row,
                isValid: r.isValid,
                errors: r.errors,
                fieldErrors: r.fieldErrors,
                mappings: mappings
            }));

        if (errorRows.length === 0) {
            alert("No error rows to download.");
            return;
        }

        try {
            const blob = await generateErrorExcel(errorRows);
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "import_errors.xlsx";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (err) {
            console.error("Error generating Excel:", err);
            alert("Failed to generate Excel file.");
        }
    };

    /* --- Render Helper: Preview --- */
    const renderPreview = () => {
        const validCount = validationResults.filter(r => r.isValid).length;
        const errorCount = validationResults.length - validCount;

        // Masking helper
        const maskPhone = (p?: string) => {
            if (!p || p.length < 5) return p;
            if (p.length <= 7) return p;
            const start = p.slice(0, 7);
            const end = p.slice(-2);
            return `${start}****${end}`;
        };

        return (
            <div className="ib-card flex flex-col h-[70vh] animate-in fade-in zoom-in-95 duration-300">
                {/* Header */}
                <div className="ib-card-header border-b border-white/10 px-8 py-5 justify-between">
                    <div className="flex items-center gap-2">
                        <h3 className="ib-card-title text-lg">Previewing {validationResults.length} of {validationResults.length} Rows</h3>
                        <span className="w-2 h-2 rounded-full bg-indigo-500 shadow-custom shadow-indigo-500/50"></span>
                    </div>
                    <button onClick={() => setStep("UPLOAD_AND_MAP")} className="p-2 hover:bg-white/5 rounded-full text-slate-400 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                {/* Table */}
                <div className="flex-1 overflow-auto">
                    <table className="ib-table whitespace-nowrap">
                        <thead className="ib-thead sticky top-0 z-10">
                            <tr>
                                <th className="ib-th">Guest Name</th>
                                <th className="ib-th">Phone Number</th>
                                <th className="ib-th">Check-In Date</th>
                                <th className="ib-th">Check-Out Date</th>
                                <th className="ib-th">Room Type</th>
                                <th className="ib-th">Adults</th>
                                <th className="ib-th">Children</th>
                                <th className="ib-th">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {validationResults.map((res, i) => (
                                <tr key={i} className="ib-tr">
                                    {/* Guest Name */}
                                    <td className={`ib-td font-semibold text-white ${res.fieldErrors["guest_name"] ? "bg-red-500/10 text-red-400 italic" : ""}`}>
                                        {res.fieldErrors["guest_name"] ? "Missing" : (res.parsed.guest_name || "-")}
                                    </td>

                                    {/* Phone */}
                                    <td className={`ib-td font-medium ${res.fieldErrors["guest_phone"] ? "bg-red-500/10 text-red-400 italic" : "text-slate-400"}`}>
                                        {res.fieldErrors["guest_phone"] ? "Missing" : (maskPhone(res.parsed.phone) || "-")}
                                    </td>

                                    {/* Check-In */}
                                    <td className={`ib-td ${res.fieldErrors["checkin_date"] ? "bg-red-500/10 text-red-400 italic" : "text-slate-300"}`}>
                                        {res.fieldErrors["checkin_date"] ? "Missing" : (res.parsed.checkin_date || "-")}
                                    </td>

                                    {/* Check-Out */}
                                    <td className={`ib-td ${res.fieldErrors["checkout_date"] ? "bg-red-500/10 text-red-400 italic" : "text-slate-300"}`}>
                                        {res.fieldErrors["checkout_date"] ? "Missing" : (res.parsed.checkout_date || "-")}
                                    </td>

                                    {/* Room Type */}
                                    <td className="ib-td text-slate-400">
                                        {res.parsed.room_type_name || res.parsed.room_number || "Standard"}
                                    </td>

                                    {/* Adults */}
                                    <td className={`ib-td ${res.fieldErrors["adults"] ? "bg-red-500/10 text-red-400 font-bold" : "text-slate-400"}`}>
                                        {res.parsed.adults}
                                    </td>

                                    {/* Children */}
                                    <td className="ib-td text-slate-400">
                                        {res.parsed.children}
                                    </td>

                                    {/* Status */}
                                    <td className="ib-td font-bold">
                                        {res.isValid ? (
                                            <span className="ib-badge-valid">
                                                <CheckCircle size={14} /> Valid
                                            </span>
                                        ) : (
                                            <span className="ib-badge-error">
                                                <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span> Error
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Footer */}
                <div className="border-t border-white/10 px-8 py-5 bg-slate-800 flex items-center justify-between rounded-b-xl">
                    <div className="flex items-center gap-6 text-sm font-medium">
                        <div className="ib-badge-valid">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-custom shadow-emerald-500/50"></span>
                            {validCount} Valid
                        </div>
                        <div className="ib-badge-error">
                            <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-custom shadow-red-500/50"></span>
                            {errorCount} With Errors
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button onClick={() => setStep("UPLOAD_AND_MAP")} className="ib-btn-secondary">
                            Back
                        </button>
                        <button onClick={downloadErrorFile} disabled={errorCount === 0} className="ib-btn-error">
                            <Download size={16} /> Download Error File
                        </button>
                        <button
                            onClick={executeImport}
                            disabled={isProcessing || validCount === 0}
                            className="ib-btn-primary"
                        >
                            {isProcessing ? <Loader2 className="animate-spin" size={18} /> : "Import Valid Rows"}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="ib-container">
            <div className="mx-auto max-w-6xl">
                {/* --- Header --- */}
                <div className="ib-header">
                    <div>
                        <h1 className="ib-title">Import Arrivals / Reservations</h1>
                        <p className="ib-subtitle text-sm">Select Hotel: <span className="ib-hotel-badge">{hotelName || "Loading..."}</span></p>
                    </div>
                    {step === "UPLOAD_AND_MAP" && (
                        <button onClick={downloadTemplate} className="text-sm text-indigo-400 font-medium hover:text-indigo-300 transition-colors hover:underline flex items-center gap-1">
                            <Download size={16} /> Download Template
                        </button>
                    )}
                </div>

                {/* --- Step: Processing / Completed --- */}
                {(step === "PROCESSING" || step === "COMPLETED") && (
                    <div className="ib-card max-w-xl mx-auto text-center animate-in fade-in zoom-in-95 duration-500">
                        {step === "PROCESSING" ? (
                            <div className="flex flex-col items-center">
                                <div className="relative mb-6">
                                    <div className="w-16 h-16 bg-indigo-500/20 rounded-full flex items-center justify-center animate-pulse">
                                        <Loader2 className="animate-spin text-indigo-400" size={32} />
                                    </div>
                                </div>
                                <h2 className="ib-card-title text-2xl mb-2">Processing Import...</h2>
                                <p className="text-slate-400 mb-8 max-w-xs mx-auto text-sm">Synchronizing your guest data with the secure database.</p>

                                <div className="w-full bg-slate-700/50 rounded-full h-3 mb-6 overflow-hidden relative border border-white/5">
                                    <div
                                        className="bg-indigo-500 h-full transition-all duration-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]"
                                        style={{ width: `${batchStats.total > 0 ? ((batchStats.imported + batchStats.errors) / batchStats.total) * 100 : 5}%` }}
                                    />
                                </div>
                                <div className="flex justify-center gap-8 text-sm font-medium">
                                    <div className="text-slate-300">Total: <b className="text-white ml-1">{batchStats.total}</b></div>
                                    <div className="text-emerald-400">Imported: <b className="ml-1">{batchStats.imported}</b></div>
                                    <div className="text-red-400">Errors: <b className="ml-1">{batchStats.errors}</b></div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center">
                                <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-6 shadow-xl ring-4 ring-white/5
                                     ${batchStats.errors > 0 ? "bg-amber-500/20 text-amber-500" : "bg-emerald-500/20 text-emerald-500"}`}>
                                    {batchStats.errors > 0 ? <AlertTriangle size={36} /> : <CheckCircle size={36} />}
                                </div>
                                <h2 className="text-2xl font-bold text-white mb-2">Import Completed</h2>
                                <p className="text-slate-400 mb-8 max-w-sm mx-auto">
                                    {batchStats.errors > 0
                                        ? "Some rows failed to import. Download the report to view details."
                                        : "All rows were successfully imported."}
                                </p>

                                <div className="flex gap-4 mb-8 text-sm bg-white/5 p-3 rounded-lg border border-white/5">
                                    <span className="px-2 text-slate-300">Total: <b className="text-white ml-1">{batchStats.total}</b></span>
                                    <span className="w-px h-4 bg-white/10 my-auto"></span>
                                    <span className="px-2 text-emerald-400">Success: <b className="ml-1">{batchStats.imported}</b></span>
                                    <span className="w-px h-4 bg-white/10 my-auto"></span>
                                    <span className="px-2 text-red-400">Errors: <b className="ml-1">{batchStats.errors}</b></span>
                                </div>

                                <div className="flex gap-3">
                                    <button onClick={() => window.location.reload()} className="ib-btn-secondary">
                                        Import Another File
                                    </button>
                                    {batchStats.errors > 0 && (
                                        <button
                                            onClick={async () => {
                                                if (!batchId) return;
                                                const { data: errRows } = await supabase
                                                    .from("import_rows")
                                                    .select("row_data, error_message, status")
                                                    .eq("batch_id", batchId)
                                                    .eq("status", "error");

                                                if (errRows && errRows.length > 0) {
                                                    const exportData = errRows.map(r => ({
                                                        row: r.row_data,
                                                        isValid: false,
                                                        errors: [r.error_message || "Unknown Error"],
                                                        fieldErrors: {},
                                                        mappings: {}
                                                    }));
                                                    try {
                                                        const blob = await generateErrorExcel(exportData);
                                                        const url = URL.createObjectURL(blob);
                                                        const link = document.createElement("a");
                                                        link.href = url;
                                                        link.download = `import_report_${batchId}.xlsx`;
                                                        document.body.appendChild(link);
                                                        link.click();
                                                        document.body.removeChild(link);
                                                    } catch (e) {
                                                        alert("Failed to generate report");
                                                    }
                                                }
                                            }}
                                            className="ib-btn-primary bg-amber-500 hover:bg-amber-400 shadow-amber-500/20"
                                        >
                                            <Download size={18} /> Download Report
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* --- Step: Preview --- */}
                {step === "PREVIEW" && renderPreview()}

                {/* --- Step: Upload & Map (Stacked Layout) --- */}
                {step === "UPLOAD_AND_MAP" && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

                        {/* Section 1: Upload */}
                        <div className="ib-card group">
                            <label
                                onDragOver={handleDragOver}
                                onDrop={handleDrop}
                                className={`ib-upload-label ${file ? 'ib-upload-label-active' : 'ib-upload-label-inactive'}`}
                            >
                                <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500/0 via-indigo-500/0 to-indigo-500/0 opacity-0 group-hover:opacity-10 transition-opacity duration-500 pointer-events-none" />

                                <div className="ib-upload-content">
                                    {file ? (
                                        <>
                                            <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-emerald-500/10 scale-100 transition-transform duration-300">
                                                <FileSpreadsheet size={32} />
                                            </div>
                                            <p className="text-lg font-bold text-white mb-1">{file.name}</p>
                                            <p className="text-sm text-emerald-400 font-medium mb-4 flex items-center gap-1.5"><CheckCircle size={14} /> Ready to parse ({(file.size / 1024).toFixed(1)} KB)</p>
                                            <span className="text-xs text-slate-400 hover:text-white transition-colors border-b border-dashed border-slate-500 hover:border-white cursor-pointer">Click to change file</span>
                                        </>
                                    ) : (
                                        <>
                                            <div className="w-16 h-16 bg-slate-700/50 text-slate-400 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:text-indigo-400 group-hover:bg-slate-700 transition-all duration-300 shadow-lg">
                                                <UploadCloud size={32} />
                                            </div>
                                            <p className="mb-2 text-lg text-slate-200 font-semibold">Drag & Drop your PMS Export File</p>
                                            <p className="text-sm text-slate-500 mb-6">Supports .CSV or .XLSX</p>
                                            <div className="ib-btn-primary">
                                                Upload File
                                            </div>
                                        </>
                                    )}
                                </div>
                                <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
                            </label>

                            <div className="flex items-center justify-between mt-6">
                                <button onClick={downloadTemplate} className="text-sm text-slate-400 font-medium hover:text-white transition-colors flex items-center gap-2 group/link">
                                    <div className="p-1.5 rounded-md bg-slate-700/50 group-hover/link:bg-slate-700 text-slate-400 group-hover/link:text-white transition-colors"><Download size={14} /></div>
                                    Download Template
                                </button>
                                {file && (
                                    <span className="text-sm text-indigo-400 font-bold flex items-center gap-1 animate-pulse">
                                        Next: Map Columns <ChevronRight size={16} />
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Section 2: Map Columns */}
                        {file && (
                            <div className="ib-card text-left">
                                <div className="mb-6 border-b border-white/5 pb-4">
                                    <h2 className="ib-card-title">Map Columns to Vaiyu Fields</h2>
                                    <p className="text-slate-400 mt-1 text-sm">Match the columns from your file to the system fields.</p>
                                </div>

                                <div className="flex gap-3 mb-6">
                                    <button
                                        onClick={autoSuggestMapping}
                                        className="ib-btn-refresh"
                                    >
                                        <RefreshCw size={14} /> Auto-Suggest Mapping
                                    </button>
                                    {(() => {
                                        const hasMappings = Object.values(mappings).filter(Boolean).length > 0;
                                        const mappingsChanged = hasMappings && JSON.stringify(
                                            Object.fromEntries(Object.entries(mappings).filter(([, v]) => v).sort())
                                        ) !== JSON.stringify(
                                            Object.fromEntries(Object.entries(savedMappings).filter(([, v]) => v).sort())
                                        );
                                        return (
                                            <button
                                                onClick={saveMapping}
                                                disabled={savingMapping || mappingSaved || !mappingsChanged}
                                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${mappingSaved
                                                    ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-400"
                                                    : "bg-white/10 border border-white/20 text-slate-300 hover:bg-white/20 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                                    }`}
                                            >
                                                {savingMapping ? <Loader2 size={14} className="animate-spin" /> : mappingSaved ? <CheckCircle size={14} /> : <Save size={14} />}
                                                {savingMapping ? "Saving..." : mappingSaved ? "Saved!" : !mappingsChanged && hasMappings ? "Mapping Saved" : "Save Mapping"}
                                            </button>
                                        );
                                    })()}
                                </div>

                                <div className="ib-table-container">
                                    <table className="ib-table">
                                        <thead className="ib-thead">
                                            <tr>
                                                <th className="ib-th w-1/3">Your CSV Column</th>
                                                <th className="ib-th w-1/3">Vaiyu Field <span className="text-indigo-400 font-normal ml-1">(Select)</span></th>
                                                <th className="ib-th w-1/3">Sample Data</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5 bg-slate-800/20">
                                            {csvData.length > 0 ? (
                                                Object.keys(csvData[0]).map((header) => (
                                                    <tr key={header} className="ib-tr group">
                                                        <td className="ib-td font-medium text-slate-300 group-hover:text-white transition-colors">{header}</td>
                                                        <td className="ib-td">
                                                            <div className="relative">
                                                                <select
                                                                    className={`ib-select ${mappings[header] ? 'ib-select-active' : ''}`}
                                                                    value={mappings[header] || ""}
                                                                    onChange={(e) => handleMappingChange(header, e.target.value)}
                                                                >
                                                                    <option value="" className="text-slate-500 bg-slate-800">-- Ignore --</option>
                                                                    {DB_FIELDS.map(f => (
                                                                        <option key={f.value} value={f.value} className="text-slate-200 bg-slate-800">{f.label} {f.required ? "*" : ""}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                        </td>
                                                        <td className="ib-td text-slate-500 truncate max-w-xs font-mono text-xs group-hover:text-slate-400 transition-colors">
                                                            {csvData[0][header]}
                                                        </td>
                                                    </tr>
                                                ))
                                            ) : (
                                                <tr><td colSpan={3} className="p-8 text-center text-slate-400">Processing...</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="flex justify-end gap-3 pt-6 border-t border-white/10">
                                    <button
                                        onClick={() => setFile(null)}
                                        className="ib-btn-secondary"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={runValidation}
                                        className="ib-btn-primary"
                                    >
                                        Confirm & Preview <ChevronRight size={16} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
