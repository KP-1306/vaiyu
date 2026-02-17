import { useRef, ChangeEvent } from "react";
import { Camera, Check, ChevronDown, Lock, Shield, Upload, AlertTriangle, Loader2 } from "lucide-react";
import "./Step2IdentityVerification.css";

const ID_TYPES = [
    { value: "aadhaar", label: "Aadhaar Card", placeholder: "XXXX-XXXX-XXXX" },
    { value: "passport", label: "Passport", placeholder: "A1234567" },
    { value: "driving_license", label: "Driving License", placeholder: "DL-1234567890123" },
    { value: "voter_id", label: "Voter ID", placeholder: "ABC1234567" },
];

interface Step2Props {
    idForm: any;
    setIdForm: (form: any) => void;
    handleSubmit: () => void;
    submitting: boolean;
    submitError: string | null;
    setStep: (step: number) => void;
}

export function Step2IdentityVerification({ idForm, setIdForm, handleSubmit, submitting, submitError, setStep }: Step2Props) {
    const selectedIdType = ID_TYPES.find((t) => t.value === idForm.id_type) || ID_TYPES[0];
    const frontInputRef = useRef<HTMLInputElement>(null);
    const backInputRef = useRef<HTMLInputElement>(null);

    const handleFrontClick = () => {
        frontInputRef.current?.click();
    };

    const handleBackClick = () => {
        backInputRef.current?.click();
    };

    const handleFileChange = (e: ChangeEvent<HTMLInputElement>, field: 'front_captured' | 'back_uploaded') => {
        const file = e.target.files?.[0];
        if (file) {
            setIdForm({
                ...idForm,
                [field]: true,
                [field === 'front_captured' ? 'front_file' : 'back_file']: file
            });
        }
    };

    return (
        <div className="step2-page">
            <div className="step2-page-glow" />

            <div className="step2-container">

                {/* Step Header */}
                <p className="step2-header-text">Step 2 of 3 — Identity Proof</p>

                {/* Progress Bar */}
                <div className="step2-progress-track">
                    <div className="step2-progress-fill" />
                </div>

                {/* Title Row */}
                <div className="step2-title-row">
                    <div className="step2-shield-wrapper">
                        <div className="step2-shield-glow" />
                        <div className="step2-shield-box">
                            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" fill="rgba(212,175,55,0.15)" />
                                <path d="M12 8v8M12 8l-3 3M12 8l3 3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </div>
                    </div>
                    <h2 className="step2-title">Identity Verification</h2>
                </div>

                {/* Dropdown */}
                <div className="step2-select-wrapper">
                    <select
                        value={idForm.id_type}
                        onChange={(e) => setIdForm({ ...idForm, id_type: e.target.value })}
                        className="step2-select"
                    >
                        {ID_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                    </select>
                    <ChevronDown className="step2-select-arrow" />
                </div>

                {/* ID Number */}
                <div className="step2-input-group">
                    <label className="step2-input-label">{selectedIdType.label} Number</label>
                    <input
                        type="text"
                        value={idForm.id_number}
                        onChange={(e) => {
                            let val = e.target.value;
                            if (idForm.id_type === "aadhaar") {
                                val = val.replace(/\D/g, "").slice(0, 12);
                            }
                            setIdForm({ ...idForm, id_number: val });
                        }}
                        className="step2-input"
                        placeholder={selectedIdType.placeholder}
                    />
                </div>

                {/* Capture Buttons */}
                <div className="step2-capture-group">
                    {/* Front */}
                    <input
                        type="file"
                        ref={frontInputRef}
                        className="hidden"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => handleFileChange(e, 'front_captured')}
                        style={{ display: 'none' }}
                    />
                    <button
                        onClick={handleFrontClick}
                        className={`step2-capture-btn ${idForm.front_captured ? "captured" : ""}`}
                        style={{
                            backgroundImage: idForm.front_file ? `url(${URL.createObjectURL(idForm.front_file)})` : 'none',
                            backgroundSize: 'cover',
                            backgroundPosition: 'center'
                        }}
                    >
                        <div className={`step2-icon-box ${idForm.front_file ? "has-preview" : ""}`}>
                            {idForm.front_captured ? <Check /> : (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                                    <circle cx="12" cy="13" r="3" />
                                </svg>
                            )}
                        </div>
                        <div className={`${idForm.front_file ? "bg-black/60 backdrop-blur-sm p-2 rounded-lg" : ""}`}>
                            <div className="step2-capture-title">
                                {idForm.front_file
                                    ? "Front Side Captured"
                                    : idForm.front_captured
                                        ? "Front Side Saved"
                                        : "Capture Front Side"}
                            </div>
                            <div className="step2-capture-subtitle">
                                {idForm.front_file
                                    ? "Tap to retake"
                                    : idForm.front_captured
                                        ? "Document on file • Tap to replace"
                                        : "(Required)"}
                            </div>
                        </div>
                    </button>

                    {/* Back */}
                    <input
                        type="file"
                        ref={backInputRef}
                        className="hidden"
                        accept="image/*"
                        onChange={(e) => handleFileChange(e, 'back_uploaded')}
                        style={{ display: 'none' }}
                    />
                    <button
                        onClick={handleBackClick}
                        className={`step2-capture-btn ${idForm.back_uploaded ? "captured" : ""}`}
                        style={{
                            backgroundImage: idForm.back_file ? `url(${URL.createObjectURL(idForm.back_file)})` : 'none',
                            backgroundSize: 'cover',
                            backgroundPosition: 'center'
                        }}
                    >
                        <div className={`step2-icon-box ${idForm.back_file ? "has-preview" : ""}`}>
                            {idForm.back_uploaded ? <Check /> : (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="17 8 12 3 7 8" />
                                    <line x1="12" y1="3" x2="12" y2="15" />
                                </svg>
                            )}
                        </div>
                        <div className={`${idForm.back_file ? "bg-black/60 backdrop-blur-sm p-2 rounded-lg" : ""}`}>
                            <div className="step2-capture-title">
                                {idForm.back_file
                                    ? "Back Side Uploaded"
                                    : idForm.back_uploaded
                                        ? "Back Side Saved"
                                        : "Upload Back Side"}
                            </div>
                            <div className="step2-capture-subtitle">
                                {idForm.back_file
                                    ? "Tap to change"
                                    : idForm.back_uploaded
                                        ? "Document on file • Tap to replace"
                                        : "(Optional)"}
                            </div>
                        </div>
                    </button>
                </div>

                {/* Encryption Notice */}
                <div className="step2-encrypt-notice">
                    <Lock />
                    <span>Documents encrypted and stored securely</span>
                </div>

                {/* Submit */}
                <button
                    disabled={submitting || !idForm.id_number || !idForm.front_captured}
                    onClick={() => {
                        if (idForm.id_type === "aadhaar" && idForm.id_number.length !== 12) {
                            alert("Please enter a valid 12-digit Aadhaar number");
                            return;
                        }
                        handleSubmit();
                    }}
                    className="step2-submit-btn"
                >
                    {submitting ? (
                        <>
                            <Loader2 className="animate-spin" />
                            Processing...
                        </>
                    ) : (
                        "Submit and Complete"
                    )}
                </button>
            </div>

            {/* Error Toast */}
            {submitError && (
                <div className="step2-error-toast">
                    <div className="step2-error-icon">
                        <AlertTriangle />
                    </div>
                    <p className="step2-error-text">{submitError}</p>
                </div>
            )}
        </div>
    );
}
