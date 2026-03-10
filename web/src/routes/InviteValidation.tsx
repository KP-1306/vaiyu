import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function InviteValidation() {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [inviteData, setInviteData] = useState<{
        hotel_name: string;
        role_name: string;
        email: string;
    } | null>(null);

    useEffect(() => {
        async function validate() {
            if (!token) {
                setError("No invitation token provided.");
                setLoading(false);
                return;
            }

            try {
                const { data, error: rpcError } = await supabase.rpc('validate_hotel_invite', {
                    p_token: token
                });

                if (rpcError) throw rpcError;

                if (!data.valid) {
                    setError(data.error || "This invitation is invalid or has expired.");
                } else {
                    setInviteData({
                        hotel_name: data.hotel_name,
                        role_name: data.role_name,
                        email: data.email
                    });
                }
            } catch (err: any) {
                console.error("Validation error:", err);
                setError("Failed to validate invitation. Please try again.");
            } finally {
                setLoading(false);
            }
        }

        validate();
    }, [token]);

    const handleAccept = () => {
        // Redirect to signin with intent=signup and redirect back here or to a success page
        // But the user's flow says: signup/login -> accept_hotel_invite()
        // We can pass the token to the signin page so it knows where to redirect
        const redirectUrl = `/auth/callback?next=/invite/accept/${token}`;
        navigate(`/signin?intent=signup&email=${encodeURIComponent(inviteData?.email || '')}&redirect=${encodeURIComponent(redirectUrl)}`);
    };

    if (loading) {
        return (
            <div className="min-h-screen grid place-items-center bg-gray-50">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-gray-600 font-medium">Validating invitation...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen grid place-items-center bg-gray-50 px-4">
                <div className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm text-center">
                    <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </div>
                    <h1 className="text-xl font-bold text-gray-900">Invitation Error</h1>
                    <p className="text-gray-600 mt-2">{error}</p>
                    <div className="mt-8">
                        <Link
                            to="/"
                            className="inline-block w-full py-3 bg-gray-900 text-white rounded-xl font-semibold hover:bg-gray-800 transition-colors"
                        >
                            Back to Home
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen grid place-items-center bg-gray-50 px-4">
            <div className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-50 text-blue-600 rounded-full mb-4">
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-10V4m0 10V4m-4 10h4" />
                        </svg>
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900">You're Invited!</h1>
                    <p className="text-gray-600 mt-2">
                        Join the team at <span className="font-semibold text-gray-900">{inviteData?.hotel_name}</span>
                    </p>
                </div>

                <div className="space-y-6">
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                        <div className="flex flex-col gap-3">
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-500">Email</span>
                                <span className="font-medium text-gray-900">{inviteData?.email}</span>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-500">Role</span>
                                <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-md text-xs font-bold uppercase tracking-wider">
                                    {inviteData?.role_name}
                                </span>
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={handleAccept}
                        className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-bold text-lg shadow-lg shadow-blue-200 hover:shadow-blue-300 hover:scale-[1.02] active:scale-[0.98] transition-all"
                    >
                        Accept & Continue
                    </button>

                    <p className="text-center text-xs text-gray-500 px-4">
                        By clicking "Accept & Continue", you'll be guided to create your Vaiyu account using the email address above.
                    </p>
                </div>
            </div>
        </div>
    );
}
