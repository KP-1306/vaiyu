import Papa from "papaparse";

export interface BookingCSVRow {
    booking_reference: string;
    hotel_id?: string;
    guest_name: string;
    phone: string;
    email?: string;
    checkin_date: string;
    checkout_date: string;
    room_number?: string;
    room_type?: string; // Text from CSV
    adults?: string;
    children?: string;
    booking_source?: string;
    special_requests?: string;
    [key: string]: string | undefined;
}

export interface ParseResult {
    data: BookingCSVRow[];
    errors: string[];
    meta: Papa.ParseMeta;
}

const REQUIRED_COLUMNS = [
    "booking_reference",
    "guest_name",
    "phone",
    "checkin_date",
    "checkout_date",
];

export const parseBookingCSV = (file: File): Promise<ParseResult> => {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            comments: "#",
            transformHeader: (header) => {
                // Normalize headers: remove spaces, lowercase
                return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
            },
            complete: (results) => {
                const data = results.data as BookingCSVRow[];
                const errors: string[] = [];

                // 1. Check for missing columns
                const headers = results.meta.fields || [];
                const missing = REQUIRED_COLUMNS.filter(
                    (col) => !headers.includes(col)
                );

                if (missing.length > 0) {
                    errors.push(`Missing required columns: ${missing.join(", ")}`);
                }

                // 2. Validate data rows (basic)
                // More complex validation happens in the UI component logic
                // where we have access to database lookups.
                if (data.length === 0) {
                    errors.push("The CSV file is empty.");
                }

                resolve({
                    data,
                    errors,
                    meta: results.meta,
                });
            },
            error: (error) => {
                reject(error);
            },
        });
    });
};

/**
 * Normalizes phone numbers to E.164 format if possible
 */
export const normalizePhone = (phone: string): string => {
    if (!phone) return "";
    // Basic cleanup
    return phone.replace(/[^+\d]/g, "");
}

/**
 * Generates a CSV string from an array of objects
 */
export const generateCSV = (data: any[]): string => {
    return Papa.unparse(data);
};
