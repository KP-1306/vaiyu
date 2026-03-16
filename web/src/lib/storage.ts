// web/src/lib/storage.ts
import { supabase } from "./supabase";

/**
 * Uploads a file to the 'identity_proofs' bucket via a secure Edge Function.
 * This bypasses RLS for guest-facing kiosks while keeping the bucket private.
 */
export async function uploadFile(file: File, path: string, signal?: AbortSignal) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("path", path);

    // Call the Edge Function instead of direct storage client
    const { data, error } = await supabase.functions.invoke("upload-guest-id", {
        body: formData,
        // @ts-ignore
        signal
    });
    
    if (error) throw error;
    if (!data?.path) throw new Error("Upload failed: No path returned from Edge Function");
    
    return data.path;
}

/**
 * Uploads a file with a retry mechanism and exponential backoff for network resilience.
 */
async function uploadWithRetry(file: File, path: string, retries = 2, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) {
        throw new Error("Upload aborted");
    }

    try {
        return await uploadFile(file, path, signal);
    } catch (err) {
        if (retries === 0 || (err as any)?.name === 'AbortError' || signal?.aborted) throw err;
        
        // Exponential backoff: retry 1 (500ms), retry 2 (1000ms), retry 3 (2000ms)
        const delay = Math.pow(2, 3 - retries) * 250;
        console.warn(`[Storage] Upload failed, retrying in ${delay}ms... (${retries} left)`, err);
        await new Promise(r => setTimeout(r, delay));
        
        return uploadWithRetry(file, path, retries - 1, signal);
    }
}

/**
 * Wraps upload with a strict timeout and AbortController to stop background usage.
 */
async function uploadWithTimeout(file: File, path: string, timeout = 20000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
        return await uploadWithRetry(file, path, 2, controller.signal);
    } catch (err: any) {
        if (err?.name === "AbortError" || controller.signal.aborted) {
            throw new Error("Upload aborted due to timeout");
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Generates a SHA-256 hash (fingerprint) of a file for bank-level integrity.
 * Yields control to the main thread microtask queue to keep UI responsive.
 */
async function sha256(file: File): Promise<string> {
    // Yield to the microtask queue to allow other UI work to process
    await Promise.resolve();
    
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

interface UploadParams {
    frontImage?: File | null;
    backImage?: File | null;
    existingFront?: string | null;
    existingBack?: string | null;
    storageKey?: string | null;
}

/**
 * Compresses an image file before upload.
 * Reduces dimensions to maxWidth and uses JPEG quality compression.
 * Returns both the compressed File and its normalized extension.
 */
async function compressImage(file: File, maxWidth = 1600, quality = 0.8): Promise<{ file: File, ext: string }> {
    const rawExt = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || 'png';
    const isImage = file.type.startsWith("image/") || ["jpg", "jpeg", "png", "webp"].includes(rawExt);
    
    // Safety: Protect against path injection by enforcing extension length
    if (rawExt.length > 5) {
        throw new Error("Invalid file extension: length exceeds 5 characters.");
    }

    // CPU Optimization: Skip compression for small files or non-images
    if (!isImage || file.size < 800_000) {
        return { file, ext: rawExt };
    }

    const imageBitmap = await createImageBitmap(file);

    try {
        let width = imageBitmap.width;
        let height = imageBitmap.height;

        // Resolution Guard: Prevent browser crashes on ultra-high-res images (>25MP)
        if (width * height > 25_000_000) {
            throw new Error("Image resolution too large for safe processing.");
        }

        // Quality Optimization: Skip re-compression if already optimized JPEG
        if (rawExt === "jpg" && file.size < 1_000_000 && width <= maxWidth) {
            return { file, ext: rawExt };
        }

        // Resize if too large
        if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            throw new Error("Image compression failed: Canvas 2D context not available");
        }
        ctx.drawImage(imageBitmap, 0, 0, width, height);

        const blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(b => {
                if (!b) reject(new Error("Image compression failed: Canvas toBlob returned null"));
                else resolve(b);
            }, "image/jpeg", quality)
        );

        // Memory Hardening: Release canvas resources immediately after toBlob
        canvas.width = 0;
        canvas.height = 0;

        const compressed = new File([blob], "compressed.jpg", { type: "image/jpeg" });
        return { file: compressed, ext: "jpg" }; // Normalize extension to jpg after compression
    } finally {
        imageBitmap.close(); // Ensure memory is released
    }
}

/**
 * Bank-Level Secure Identity Document Upload Helper
 * Handles folder reuse, unguessable paths, extension validation, size limits, and retries.
 * Now includes client-side SHA-256 hashing and aborted-timeout guards.
 */
export async function uploadIdentityDocuments({
    frontImage,
    backImage,
    existingFront,
    existingBack,
    storageKey,
}: UploadParams) {
    const ALLOWED_EXT = ["jpg", "jpeg", "png", "webp", "pdf"];
    const MAX_SIZE = 5 * 1024 * 1024; // 5MB limit
    
    // Bank-Level Security: Only generate a new UUID if we don't already have a secure folder
    if (!storageKey && (existingFront || existingBack)) {
        console.warn("[Storage] Warning: existing document detected without storageKey. Generating new key but migration is recommended.");
    }
    const secureFolderId = storageKey || crypto.randomUUID();

    const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    
    // 1. Guard — Early return if no new images are provided
    if (!frontImage && !backImage) {
        return {
            storageKey: secureFolderId,
            frontPath: existingFront || null,
            backPath: existingBack || null,
            frontHash: null,
            backHash: null
        };
    }

    // Initialize paths with existing relative paths
    let frontPath = existingFront || null;
    let backPath = existingBack || null;
    let frontHash = null;
    let backHash = null;
    
    const startTime = Date.now();
    const timestamp = startTime;
    const GLOBAL_TIMEOUT = 30000; // 30s total for all uploads

    // Unique suffix to prevent rare collision when upsert: true
    const suffix = crypto.randomUUID().slice(0, 8);

    if (frontImage) {
        if (Date.now() - startTime > GLOBAL_TIMEOUT) {
            throw new Error("Upload session timed out.");
        }

        if (frontImage.size === 0) {
            throw new Error("File appears to be empty.");
        }

        const MAX_FRONT_SIZE = frontImage.type === "application/pdf" ? 10 * 1024 * 1024 : MAX_SIZE;
        if (frontImage.size > MAX_FRONT_SIZE) {
            throw new Error(frontImage.type === "application/pdf" ? "PDF must be under 10MB." : "Document must be under 5MB.");
        }

        // 1. Raw Extension Validation (before processing)
        const rawExt = frontImage.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
        if (!rawExt) {
            throw new Error("File must have a valid extension.");
        }
        if (!ALLOWED_EXT.includes(rawExt)) {
            throw new Error(`Unsupported document format: ${rawExt}`);
        }

        // 2. MIME Validation (Relaxed for mobile browsers that send empty strings)
        const isImageExt = ["jpg", "jpeg", "png", "webp"].includes(rawExt);
        const isValidMime = ALLOWED_MIME.includes(frontImage.type) || 
            (frontImage.type === "" && (isImageExt || rawExt === "pdf"));
        
        if (!isValidMime) {
            throw new Error("Unsupported file type. Please upload a valid image (JPG, PNG, WEBP) or PDF.");
        }

        // Compress and normalize extension
        const { file: processedFile, ext: finalExt } = await compressImage(frontImage);

        // Integrity: Generate fingerprint on the FINAL processed file
        // (skip for PDFs to optimize speed)
        if (finalExt !== "pdf") {
            frontHash = await sha256(processedFile);
        }

        const path = `${secureFolderId}/front_${timestamp}_${suffix}.${finalExt}`;
        frontPath = await uploadWithTimeout(processedFile, path);
    }

    if (backImage) {
        if (Date.now() - startTime > GLOBAL_TIMEOUT) {
            throw new Error("Upload session timed out.");
        }

        if (backImage.size === 0) {
            throw new Error("File appears to be empty.");
        }

        const MAX_BACK_SIZE = backImage.type === "application/pdf" ? 10 * 1024 * 1024 : MAX_SIZE;
        if (backImage.size > MAX_BACK_SIZE) {
            throw new Error(backImage.type === "application/pdf" ? "PDF must be under 10MB." : "Document must be under 5MB.");
        }

        // 1. Raw Extension Validation
        const rawExt = backImage.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
        if (!rawExt) {
            throw new Error("File must have a valid extension.");
        }
        if (!ALLOWED_EXT.includes(rawExt)) {
            throw new Error(`Unsupported document format: ${rawExt}`);
        }

        // 2. MIME Validation (Relaxed for mobile browsers)
        const isImageExt = ["jpg", "jpeg", "png", "webp"].includes(rawExt);
        const isValidMime = ALLOWED_MIME.includes(backImage.type) || 
            (backImage.type === "" && (isImageExt || rawExt === "pdf"));
            
        if (!isValidMime) {
            throw new Error("Unsupported file type. Please upload a valid image (JPG, PNG, WEBP) or PDF.");
        }

        // Compress and normalize extension
        const { file: processedFile, ext: finalExt } = await compressImage(backImage);

        // Integrity: Generate fingerprint on the FINAL processed file
        if (finalExt !== "pdf") {
            backHash = await sha256(processedFile);
        }

        const path = `${secureFolderId}/back_${timestamp}_${suffix}.${finalExt}`;
        backPath = await uploadWithTimeout(processedFile, path);
    }

    return {
        storageKey: secureFolderId,
        frontPath,
        backPath,
        frontHash,
        backHash
    };
}
