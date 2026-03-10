import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Spinner from "../components/Spinner";

export default function InviteAcceptance() {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        async function accept() {
            if (!token) {
                setError("No token provided.");
                setLoading(false);
                return;
            }

            try {
                // Ensure user is logged in
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) {
                    // Redirect to validation if not logged in
                    navigate(`/invite/${token}`);
                    return;
                }

                // 1) Claim the invite (Anti-Race & Anti-Forwarding)
                const { error: claimError } = await supabase.rpc('claim_hotel_invite', {
                    p_token: token
                });
                if (claimError) {
                    // It could be already claimed by this exact user or another user.
                    // accept_hotel_invite will strictly validate if it's safe to proceed.
                    console.warn("Invite claim issue or already claimed:", claimError);
                }

                // 2) Accept the invite
                const { data, error: rpcError } = await supabase.rpc('accept_hotel_invite', {
                    p_token: token
                });

                if (rpcError) throw rpcError;

                if (data.success) {
                    setSuccess(true);
                    // Redirect to the property dashboard after a short delay
                    setTimeout(() => {
                        navigate(`/owner/${data.hotel_id}/dashboard`);
                    }, 2000);
                } else {
                    setError(data.message || "Failed to accept invitation.");
                }
            } catch (err: any) {
                console.error("Acceptance error:", err);
                setError(err.message || "An unexpected error occurred.");
            } finally {
                setLoading(false);
            }
        }

        accept();
    }, [token, navigate]);

    if (loading) {
        return (
            <div className="min-h-screen grid place-items-center bg-gray-50">
                <Spinner label="Accepting your invitation..." />
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen grid place-items-center bg-gray-50 px-4">
                <div className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm text-center">
                    <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <h1 className="text-xl font-bold text-gray-900">Acceptance Failed</h1>
                    <p className="text-gray-600 mt-2">{error}</p>
                    <div className="mt-8">
                        <button
                            onClick={() => navigate("/")}
                            className="inline-block w-full py-3 bg-gray-900 text-white rounded-xl font-semibold hover:bg-gray-800 transition-colors"
                        >
                            Back to Home
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (success) {
        return (
            <div className="min-h-screen grid place-items-center bg-gray-50 px-4">
                <div className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm text-center">
                    <div className="w-16 h-16 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900">Welcome Aboard!</h1>
                    <p className="text-gray-600 mt-2">
                        You have successfully joined the team. Redirecting you to the dashboard...
                    </p>
                </div>
            </div>
        );
    }

    return null;
}
