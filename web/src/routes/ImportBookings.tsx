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
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { parseBookingCSV, BookingCSVRow, normalizePhone } from "../utils/csvParser";
import { generateErrorExcel } from "../utils/excelGenerator";

// ... lines 15-278 ...

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
        { label: "Booking Reference", value: "booking_reference", required: true },
        { label: "Guest Name", value: "guest_name", required: true },
        { label: "Phone Number", value: "phone", required: false },
        { label: "Email", value: "email", required: false },
        { label: "Check-In Date", value: "checkin_date", required: true },
        { label: "Check-Out Date", value: "checkout_date", required: true },
        { label: "Room Number", value: "room_number", required: false },
        { label: "Room Type", value: "room_type", required: false },
        { label: "Adults", value: "adults", required: false },
        { label: "Children", value: "children", required: false },
        { label: "Special Requests", value: "special_requests", required: false },
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

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement> | File) => {
        const uploadedFile = e instanceof File ? e : e.target.files?.[0];
        if (!uploadedFile) return;
        setFile(uploadedFile);

        try {
            const result = await parseBookingCSV(uploadedFile);
            setCsvData(result.data);
            if (Object.keys(mappings).length === 0) {
                // Auto-suggest
                const suggested: Record<string, string> = {};
                const headers = result.meta.fields || [];
                headers.forEach(h => {
                    const lower = h.toLowerCase().replace(/_/g, "");
                    // Simple heuristic mapping
                    if (lower.includes("guest") || lower.includes("name")) suggested[h] = "guest_name";
                    else if (lower.includes("phone") || lower.includes("mobile")) suggested[h] = "phone";
                    else if (lower.includes("email")) suggested[h] = "email";
                    else if (lower.includes("checkin") || lower.includes("arrival")) suggested[h] = "checkin_date";
                    else if (lower.includes("checkout") || lower.includes("departure")) suggested[h] = "checkout_date";
                    else if (lower.includes("room") && lower.includes("type")) suggested[h] = "room_type";
                    else if (lower.includes("room")) suggested[h] = "room_number";
                    else if (lower.includes("ref") || lower.includes("id")) suggested[h] = "booking_reference";
                    else if (lower.includes("adult")) suggested[h] = "adults";
                    else if (lower.includes("child")) suggested[h] = "children";
                    else if (lower.includes("special") || lower.includes("request")) suggested[h] = "special_requests";
                });
                setMappings(suggested);
            }
        } catch (err) {
            alert("Error parsing CSV: " + err);
        }
    };

    const autoSuggestMapping = () => {
        if (!csvData.length) return;
        const suggested: Record<string, string> = {};
        const headers = Object.keys(csvData[0]);
        headers.forEach(h => {
            const lower = h.toLowerCase().replace(/_/g, "");
            if (lower.includes("guest") || lower.includes("name")) suggested[h] = "guest_name";
            else if (lower.includes("phone") || lower.includes("mobile")) suggested[h] = "phone";
            else if (lower.includes("email")) suggested[h] = "email";
            else if (lower.includes("checkin") || lower.includes("arrival")) suggested[h] = "checkin_date";
            else if (lower.includes("checkout") || lower.includes("departure")) suggested[h] = "checkout_date";
            else if (lower.includes("room") && lower.includes("type")) suggested[h] = "room_type";
            else if (lower.includes("room")) suggested[h] = "room_number";
            else if (lower.includes("ref") || lower.includes("id")) suggested[h] = "booking_reference";
            else if (lower.includes("adult")) suggested[h] = "adults";
            else if (lower.includes("child")) suggested[h] = "children";
            else if (lower.includes("special") || lower.includes("request")) suggested[h] = "special_requests";
        });
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
            parsed.guest_name = getVal("guest_name");
            parsed.email = getVal("email");
            parsed.checkin_date = getVal("checkin_date");
            parsed.checkout_date = getVal("checkout_date");
            parsed.room_type = getVal("room_type");
            parsed.room_number = getVal("room_number");
            parsed.adults = getVal("adults");
            parsed.children = getVal("children");
            parsed.special_requests = getVal("special_requests");

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
            const rawPhone = getVal("phone");
            const rawEmail = getVal("email");

            if (!rawPhone && !rawEmail) {
                errors.push("Missing Contact (Phone or Email)");
                fieldErrors["phone"] = true;
                fieldErrors["email"] = true;
            }

            if (rawPhone) {
                parsed.phone = normalizePhone(rawPhone);
                if (parsed.phone.length < 5) { errors.push("Invalid Phone"); fieldErrors["phone"] = true; }
            }

            if (rawEmail) {
                // Basic email regex
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(rawEmail)) {
                    errors.push("Invalid Email"); fieldErrors["email"] = true;
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
        setValidationResults(results);
        setStep("PREVIEW");
    };

    const executeImport = async () => {
        if (!hotelId || !file) return;
        setIsProcessing(true);
        const formData = new FormData();
        formData.append("file", file);
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

                    if (workerErr) console.error("Worker Error:", workerErr);

                    // If rows were processed, trigger again immediately (Recursive Loop)
                    if (res && res.processed > 0) {
                        console.log(`Processed ${res.processed} rows. Continuing...`);
                        await triggerWorker();
                    } else {
                        console.log("Worker finished batch or no pending rows.");
                    }
                } catch (e) {
                    console.error("Worker Trigger Failed:", e);
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
        const link = document.createElement("a");
        link.href = "/bookings_sample.csv";
        link.download = "bookings_sample.csv";
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
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col h-[70vh] animate-in fade-in zoom-in-95 duration-300">
                {/* Header */}
                <div className="border-b border-slate-100 px-8 py-5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-slate-800">Previewing {validationResults.length} of {validationResults.length} Rows</h3>
                        <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                    </div>
                    <button onClick={() => setStep("UPLOAD_AND_MAP")} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors">
                        <X size={24} />
                    </button>
                </div>

                {/* Table */}
                <div className="flex-1 overflow-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="bg-white text-slate-500 sticky top-0 z-10 font-bold border-b border-slate-200 shadow-sm">
                            <tr>
                                <th className="px-6 py-4">Guest Name</th>
                                <th className="px-6 py-4">Phone Number</th>
                                <th className="px-6 py-4">Check-In Date</th>
                                <th className="px-6 py-4">Check-Out Date</th>
                                <th className="px-6 py-4">Room Type</th>
                                <th className="px-6 py-4">Adults</th>
                                <th className="px-6 py-4">Children</th>
                                <th className="px-6 py-4">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {validationResults.map((res, i) => (
                                <tr key={i} className="hover:bg-slate-50 transition-colors">
                                    {/* Guest Name */}
                                    <td className={`px-6 py-4 font-semibold text-slate-700 ${res.fieldErrors["guest_name"] ? "bg-red-50/70 text-red-500 italic" : ""}`}>
                                        {res.fieldErrors["guest_name"] ? "Missing" : (res.parsed.guest_name || "-")}
                                    </td>

                                    {/* Phone */}
                                    <td className={`px-6 py-4 font-medium ${res.fieldErrors["phone"] ? "bg-red-50/70 text-red-500 italic" : "text-slate-600"}`}>
                                        {res.fieldErrors["phone"] ? "Missing" : (maskPhone(res.parsed.phone) || "-")}
                                    </td>

                                    {/* Check-In */}
                                    <td className={`px-6 py-4 ${res.fieldErrors["checkin_date"] ? "bg-red-50/70 text-red-500 italic" : "text-slate-600"}`}>
                                        {res.fieldErrors["checkin_date"] ? "Missing" : (res.parsed.checkin_date || "-")}
                                    </td>

                                    {/* Check-Out */}
                                    <td className={`px-6 py-4 ${res.fieldErrors["checkout_date"] ? "bg-red-50/70 text-red-500 italic" : "text-slate-600"}`}>
                                        {res.fieldErrors["checkout_date"] ? "Missing" : (res.parsed.checkout_date || "-")}
                                    </td>

                                    {/* Room Type */}
                                    <td className="px-6 py-4 text-slate-600">
                                        {/* Fallback to room number if room type not mapped/parsed, strictly logic based on mappings would be better but this works for display */}
                                        {res.parsed.room_type || res.parsed.room_number || "Standard"}
                                    </td>

                                    {/* Adults */}
                                    <td className={`px-6 py-4 ${res.fieldErrors["adults"] ? "bg-red-50/70 text-red-500 font-bold" : "text-slate-600"}`}>
                                        {res.parsed.adults}
                                    </td>

                                    {/* Children */}
                                    <td className="px-6 py-4 text-slate-600">
                                        {res.parsed.children}
                                    </td>

                                    {/* Status */}
                                    <td className="px-6 py-4 font-bold">
                                        {res.isValid ? (
                                            <span className="text-green-500">Valid</span>
                                        ) : (
                                            <span className="text-red-500 flex items-center gap-1">
                                                <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span> Error
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Footer */}
                <div className="border-t border-slate-100 px-8 py-5 bg-white flex items-center justify-between">
                    <div className="flex items-center gap-6 text-sm font-semibold">
                        <div className="flex items-center gap-2 text-green-600">
                            <span className="w-2.5 h-2.5 rounded-full bg-green-500"></span>
                            {validCount} Valid
                        </div>
                        <div className="flex items-center gap-2 text-red-500">
                            <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
                            {errorCount} Errors
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button onClick={() => setStep("UPLOAD_AND_MAP")} className="px-5 py-2.5 border border-slate-300 rounded-lg text-slate-600 font-semibold hover:bg-slate-50 transition-colors">
                            Back
                        </button>
                        <button onClick={downloadErrorFile} disabled={errorCount === 0} className="px-5 py-2.5 border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg font-semibold disabled:opacity-50 transition-colors">
                            Download Error File
                        </button>
                        <button
                            onClick={executeImport}
                            disabled={isProcessing || validCount === 0}
                            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold shadow-sm shadow-blue-200 disabled:opacity-50 disabled:shadow-none transition-all flex items-center gap-2"
                        >
                            {isProcessing ? <Loader2 className="animate-spin" size={18} /> : "Import Valid Rows"}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-6xl px-4 py-8">
            {/* --- Header --- */}
            <div className="mb-8 flex items-end justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Import Arrivals / Reservations</h1>
                    <p className="text-slate-500 mt-1">Select Hotel: <span className="font-medium text-slate-700 ml-2 bg-white px-3 py-1 rounded border border-slate-200">{hotelName || "Loading..."}</span></p>
                </div>
                {step === "UPLOAD_AND_MAP" && (
                    <button onClick={downloadTemplate} className="text-sm text-blue-600 font-medium hover:underline flex items-center gap-1">
                        <Download size={16} /> Download Template
                    </button>
                )}
            </div>

            {/* --- Step: Processing / Completed --- */}
            {(step === "PROCESSING" || step === "COMPLETED") && (
                <div className="max-w-xl mx-auto bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center">
                    {step === "PROCESSING" ? (
                        <div className="flex flex-col items-center">
                            <Loader2 className="animate-spin text-blue-600 mb-4" size={48} />
                            <h2 className="text-xl font-semibold mb-2">Processing Import...</h2>
                            <p className="text-slate-500 mb-6">Your file is being processed in the background.</p>

                            <div className="w-full bg-slate-100 rounded-full h-4 mb-4 overflow-hidden relative">
                                {/* Indeterminate or Progress */}
                                <div
                                    className="bg-blue-600 h-full transition-all duration-500"
                                    style={{ width: `${batchStats.total > 0 ? ((batchStats.imported + batchStats.errors) / batchStats.total) * 100 : 5}%` }}
                                />
                            </div>
                            <div className="flex gap-8 text-sm text-slate-600">
                                <span>Total: <b>{batchStats.total}</b></span>
                                <span className="text-green-600">Imported: <b>{batchStats.imported}</b></span>
                                <span className="text-red-600">Errors: <b>{batchStats.errors}</b></span>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center">
                            <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${batchStats.errors > 0 ? "bg-orange-100 text-orange-600" : "bg-green-100 text-green-600"}`}>
                                {batchStats.errors > 0 ? <AlertTriangle size={32} /> : <CheckCircle size={32} />}
                            </div>
                            <h2 className="text-xl font-semibold mb-2">Import Completed</h2>
                            <p className="text-slate-500 mb-6">
                                {batchStats.errors > 0
                                    ? "Some rows failed to import. Download the report to view details."
                                    : "All rows were successfully imported."}
                            </p>

                            <div className="flex gap-4 mb-6 text-sm">
                                <span className="px-3 py-1 bg-slate-100 rounded-full">Total: {batchStats.total}</span>
                                <span className="px-3 py-1 bg-green-50 text-green-700 rounded-full">Success: {batchStats.imported}</span>
                                <span className="px-3 py-1 bg-red-50 text-red-700 rounded-full font-bold">Errors: {batchStats.errors}</span>
                            </div>

                            <div className="flex gap-3">
                                <button onClick={() => window.location.reload()} className="px-6 py-2 border border-slate-300 text-slate-700 rounded-lg font-medium hover:bg-slate-50 transition-colors">
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
                                                    mappings: {} // No mapping context needed for backend errors, just show the message
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
                                        className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 shadow-sm flex items-center gap-2"
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
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8">
                        <label
                            onDragOver={handleDragOver}
                            onDrop={handleDrop}
                            className={`flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200 group
                                ${file ? 'border-blue-300 bg-blue-50/30' : 'border-slate-300 bg-slate-50 hover:bg-slate-100 hover:border-slate-400'}`}
                        >
                            <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center">
                                {file ? (
                                    <>
                                        <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-4 shadow-sm">
                                            <FileSpreadsheet size={32} />
                                        </div>
                                        <p className="text-lg font-medium text-slate-900">{file.name}</p>
                                        <p className="text-sm text-slate-500 mb-4">{(file.size / 1024).toFixed(1)} KB</p>
                                        <span className="text-xs text-blue-600 font-semibold hover:underline">Click to change file</span>
                                    </>
                                ) : (
                                    <>
                                        <UploadCloud className="w-16 h-16 mb-4 text-slate-300 group-hover:text-slate-400 transition-colors" />
                                        <p className="mb-2 text-lg text-slate-600 font-medium">Drag & Drop your PMS Export File (.CSV or .XLSX)</p>
                                        <p className="text-sm text-slate-400 mb-6">- or -</p>
                                        <div className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-semibold shadow-sm hover:bg-blue-700 transition-colors">
                                            Upload File
                                        </div>
                                    </>
                                )}
                            </div>
                            <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
                        </label>

                        <div className="flex items-center justify-between mt-4">
                            <button onClick={downloadTemplate} className="text-sm text-blue-600 font-medium hover:underline flex items-center gap-1">
                                <Download size={16} /> Download Template
                            </button>
                            {file && (
                                <span className="text-sm text-blue-600 font-medium flex items-center gap-1 animate-pulse">
                                    Next: Map Columns <ChevronRight size={16} />
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Section 2: Map Columns */}
                    {file && (
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 animation-fade-in text-left">
                            <div className="mb-6">
                                <h2 className="text-xl font-bold text-slate-900">Map Columns to Vaiyu Fields</h2>
                                <p className="text-slate-500 mt-1">Match the columns from your file to the system fields.</p>
                            </div>

                            <div className="flex gap-3 mb-6">
                                <button
                                    onClick={autoSuggestMapping}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 shadow-sm transition-colors"
                                >
                                    Auto-Suggest Mapping
                                </button>
                                <button className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">
                                    Save Mapping
                                </button>
                            </div>

                            <div className="overflow-hidden rounded-lg border border-slate-200 mb-8">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-slate-50 border-b border-slate-200">
                                        <tr>
                                            <th className="px-6 py-4 font-semibold text-slate-600 w-1/3">Your CSV Column</th>
                                            <th className="px-6 py-4 font-semibold text-slate-600 w-1/3">Vaiyu Field <span className="text-blue-600 font-normal">(Select Field)</span></th>
                                            <th className="px-6 py-4 font-semibold text-slate-600 w-1/3">Sample Data</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 bg-white">
                                        {csvData.length > 0 ? (
                                            Object.keys(csvData[0]).map((header) => (
                                                <tr key={header} className="hover:bg-slate-50 transition-colors">
                                                    <td className="px-6 py-4 font-medium text-slate-700">{header}</td>
                                                    <td className="px-6 py-4">
                                                        <select
                                                            className="w-full rounded-lg border-slate-300 text-sm focus:border-blue-500 focus:ring-blue-500 shadow-sm py-2"
                                                            value={mappings[header] || ""}
                                                            onChange={(e) => handleMappingChange(header, e.target.value)}
                                                        >
                                                            <option value="">-- Ignore --</option>
                                                            {DB_FIELDS.map(f => (
                                                                <option key={f.value} value={f.value}>{f.label} {f.required ? "*" : ""}</option>
                                                            ))}
                                                        </select>
                                                    </td>
                                                    <td className="px-6 py-4 text-slate-500 truncate max-w-xs">
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

                            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                                <button className="px-6 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 shadow-sm transition-colors">
                                    Back
                                </button>
                                <button
                                    onClick={runValidation}
                                    className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 shadow-sm flex items-center gap-2 transition-colors"
                                >
                                    Confirm & Preview <ChevronRight size={16} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
