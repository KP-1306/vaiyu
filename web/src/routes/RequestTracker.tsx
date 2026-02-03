
import { useEffect, useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  ChevronRight,
  Loader2,
  XCircle,
  Camera,
  Edit2,
  FileText,
  Hash,
  MessageSquare,
  Send,
  RefreshCcw
} from "lucide-react";
import { getTicketComments, reopenTicket } from "../lib/api";

type TrackerData = {
  id: string;
  stay_id: string;
  booking_code?: string;
  display_id: string;
  status: string;
  current_assignee_id?: string;
  created_at: string;
  completed_at?: string;
  description: string;
  sla_started_at?: string;
  service: {
    label: string;
    sla_minutes: number;
    description_en?: string;
  };
  room?: {
    number: string;
  };
  zone?: {
    id: string;
    name: string;
  };
  attachments: {
    file_path: string;
    created_at: string;
  }[];
};

export default function RequestTracker() {
  const { displayId } = useParams();
  const [data, setData] = useState<TrackerData | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchTicket = async () => {
    if (!displayId) return;
    try {
      const { data: ticket, error } = await supabase
        .rpc('get_ticket_details', { p_display_id: displayId });

      if (error) throw error;
      if (!ticket) throw new Error("Ticket not found");

      setData(ticket as any);

      // Fetch comments too
      if (ticket) {
        const msgs = await getTicketComments((ticket as any).id);
        setComments(msgs);
      }
    } catch (err: any) {
      console.error("Error fetching ticket:", err);
      setError("Could not load request details.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTicket();
    const interval = setInterval(fetchTicket, 10000);
    return () => clearInterval(interval);
  }, [displayId]);

  const handlePhotoUpload = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file || !data) return;

    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${data.display_id}/${Date.now()}.${fileExt}`;
      const filePath = `tickets/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('ticket-attachments')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { error: rpcError } = await supabase
        .rpc('guest_update_ticket', {
          p_display_id: data.display_id,
          p_media_urls: [filePath]
        });

      if (rpcError) throw rpcError;

      await fetchTicket();
    } catch (error: any) {
      console.error("Upload failed", error);
      alert("Failed to upload photo.");
    } finally {
      setUploading(false);
    }
  };

  const handleSendComment = async () => {
    if (!data || !commentText.trim()) return;
    setSubmittingComment(true);
    try {
      const { error } = await supabase
        .rpc('guest_update_ticket', {
          p_display_id: data.display_id,
          p_details: commentText.trim()
        });

      if (error) throw error;
      setCommentText("");
      await fetchTicket();
    } catch (err) {
      console.error("Comment failed", err);
      alert("Failed to send message.");
    } finally {
      setSubmittingComment(false);
    }
  };



  const handleReopen = () => {
    setReopenReason("");
    setShowReopenModal(true);
  };

  const submitReopen = async () => {
    if (!data) return;

    setLoading(true);
    try {
      await reopenTicket(data.id, data.stay_id, reopenReason);
      await fetchTicket();
      setShowReopenModal(false);
    } catch (err: any) {
      console.error("Reopen failed", err);
      alert(err.message || "Failed to reopen ticket");
    } finally {
      setLoading(false);
    }
  };

  const submitDetails = async (details: string) => {
    if (!data) return;
    setIsUpdating(true);
    try {
      const { error } = await supabase
        .rpc('guest_update_ticket', {
          p_display_id: data.display_id,
          p_details: details
        });

      if (error) throw error;
      await fetchTicket();
      setShowDetailsModal(false);
    } catch (err) {
      console.error("Update failed", err);
      alert("Failed to update details.");
    } finally {
      setIsUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#020202] flex items-center justify-center text-zinc-500">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#020202] flex flex-col items-center justify-center p-6 text-center">
        <XCircle className="w-12 h-12 text-red-500 mb-4" />
        <h2 className="text-white text-lg font-bold">Request not found</h2>
        <p className="text-zinc-500 mt-2">{error || "We couldn't locate this request."}</p>
        <Link to="/guest" className="mt-8 px-6 py-3 bg-white text-black font-bold rounded-full">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  // Calculate ETA & Timer Logic
  const createdTime = new Date(data.created_at);
  const slaMinutes = data.service?.sla_minutes || 30;
  const targetMs = slaMinutes * 60000;

  let expectedTime: Date;
  let diffMs = targetMs;
  let percentLeft = 100;

  if (data.sla_started_at) {
    // Started: Fixed Deadline
    const startTime = new Date(data.sla_started_at);
    expectedTime = new Date(startTime.getTime() + targetMs);
    diffMs = expectedTime.getTime() - now.getTime();

    // Circular Progress
    percentLeft = Math.max(0, (diffMs / targetMs) * 100);
    if (diffMs < 0) percentLeft = 100; // Breached (Full Red)
  } else {
    // Not Started: Sliding Deadline (Now + SLA)
    expectedTime = new Date(now.getTime() + targetMs);
    // diffMs remains full duration (static)
    // percentLeft remains 100 (static)
  }

  const diffMins = Math.ceil(diffMs / 60000);
  const isBreached = diffMs < 0;

  // Ring Style
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (percentLeft / 100) * circumference;

  // Status Logic
  // Ticket workflow: NEW (unassigned) -> NEW (assigned) -> IN_PROGRESS -> COMPLETED
  // current_assignee_id determines if assigned
  const isAssigned = !!data.current_assignee_id;
  const isInProgress = ["IN_PROGRESS", "BLOCKED"].includes(data.status);
  const isCompleted = data.status === "COMPLETED";

  const steps = [
    { label: "Submitted", time: createdTime, active: true, completed: true },
    {
      label: "Assigning to Team",
      active: true,
      completed: isAssigned || isInProgress || isCompleted
    },
    {
      label: "Staff on the way",
      active: isInProgress || isCompleted,
      completed: isCompleted
    },
    {
      label: "Completed",
      active: isCompleted,
      completed: isCompleted
    }
  ];

  return (
    <main className="min-h-screen bg-[#0b1120] font-sans pb-24 text-slate-200 selection:bg-blue-500/30">
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900/40 via-[#0b1120] to-[#0b1120] z-0" />

      <div className="relative z-10 max-w-lg mx-auto p-4 sm:p-6">
        {/* Header */}
        <header className="flex items-center gap-4 mb-8">
          <Link to={`/stay/${sessionStorage.getItem('vaiyu:stay_code') || data.booking_code || data.stay_id}/requests`} className="w-10 h-10 rounded-full bg-slate-800/50 flex items-center justify-center border border-slate-700/50 hover:bg-slate-700 transition-colors">
            <ArrowLeft size={18} className="text-white" />
          </Link>
          <h1 className="text-lg font-bold text-white">Your Request</h1>
        </header>

        {/* Status Hero */}
        <div className="text-center mb-8 animate-fade-in-up">
          <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center border-4 mb-4 shadow-2xl relative overflow-hidden ${['COMPLETED', 'RESOLVED', 'CLOSED'].includes(data.status)
            ? 'bg-emerald-500/10 border-emerald-500 text-emerald-500'
            : isBreached
              ? 'bg-amber-500/10 border-transparent text-amber-500'
              : 'bg-blue-500/10 border-transparent text-blue-500'
            }`}>
            {['COMPLETED', 'RESOLVED', 'CLOSED'].includes(data.status)
              ? <CheckCircle2 size={32} />
              : isBreached
                ? (
                  <>
                    {/* Spinning Ring Amber */}
                    <div className="absolute inset-0 rounded-full border-4 border-amber-500/30" />
                    <div className="absolute inset-0 rounded-full border-4 border-t-amber-500 animate-spin" />
                    {/* Static Text */}
                    <span className="relative z-10 text-[10px] font-black uppercase tracking-widest">Delayed</span>
                  </>
                )
                : (
                  <>
                    {/* Spinning Ring Blue */}
                    <div className="absolute inset-0 rounded-full border-4 border-blue-500/30" />
                    <div className="absolute inset-0 rounded-full border-4 border-t-blue-500 animate-spin" />
                    {/* Static Text */}
                    <span className="relative z-10 text-[10px] font-black uppercase tracking-widest">On Time</span>
                  </>
                )
            }
          </div>
          <h2 className="text-2xl font-bold text-white mb-1">
            {['COMPLETED', 'RESOLVED', 'CLOSED'].includes(data.status)
              ? "Request Completed"
              : "Your request is in progress"
            }
          </h2>
          <p className="text-slate-500 text-sm">
            {['COMPLETED', 'RESOLVED', 'CLOSED'].includes(data.status)
              ? <span>Your request has been completed by our team.<br />Wishing you a wonderful stay. ✨</span>
              : isBreached
                ? <span className="text-amber-500/80">Sorry for the delay.<br />We are working to resolve this as quickly as possible.</span>
                : "Our team is preparing to assist you."
            }
          </p>
        </div>

        {/* ETA Card */}
        {data.status !== 'CANCELLED' && (
          <div className="bg-slate-900/40 border border-slate-800/60 backdrop-blur-md rounded-3xl p-6 mb-6 animate-fade-in-up animation-delay-100 flex items-center justify-between relative overflow-hidden shadow-xl">
            {/* Text Left */}
            <div className="z-10">
              <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
                <Clock size={16} />
                <span>{data.completed_at ? "SERVICE DELIVERED IN" : "ESTIMATED RESPONSE TIME"}</span>
              </div>

              {data.completed_at ? (
                <div className="text-3xl font-bold text-white font-mono mb-1">
                  {Math.max(1, Math.ceil((new Date(data.completed_at).getTime() - new Date(data.created_at).getTime()) / 60000))} min
                </div>
              ) : (
                <div className="text-3xl font-bold text-white font-mono mb-1">
                  {expectedTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
                </div>
              )}

              {/* Status Label */}
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {data.completed_at
                  ? "Completed"
                  : data.sla_started_at
                    ? (isBreached ? "SLA Breached" : "On Schedule")
                    : "Not Started (Assigning...)"}
              </div>
            </div>

            {/* Circular Timer Right */}
            <div className="relative w-24 h-24 flex-shrink-0 z-10">
              <svg className="transform -rotate-90 w-24 h-24">
                <circle cx="48" cy="48" r="45" stroke="rgba(255,255,255,0.05)" strokeWidth="6" fill="none" />
                <circle
                  cx="48"
                  cy="48"
                  r="45"
                  stroke={data.completed_at ? "#10b981" : isBreached ? "#ef4444" : "#3b82f6"}
                  strokeWidth="6"
                  fill="none"
                  strokeDasharray={circumference}
                  strokeDashoffset={data.completed_at ? 0 : strokeDashoffset}
                  strokeLinecap="round"
                  className={data.completed_at ? '' : isBreached ? 'animate-pulse' : 'transition-all duration-1000 ease-linear'}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                {data.completed_at ? (
                  <div className="text-emerald-500">
                    <CheckCircle2 size={24} />
                  </div>
                ) : data.sla_started_at ? (
                  <>
                    <div className={`text-lg font-bold font-mono ${isBreached ? 'text-red-500' : 'text-blue-500'}`}>
                      {isBreached ? `+${Math.abs(diffMins)}` : `${diffMins}`}
                    </div>
                    <div className={`text-[10px] uppercase font-bold ${isBreached ? 'text-red-500' : 'text-blue-500'}`}>
                      {isBreached ? 'Min Late' : 'Min Left'}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-lg font-bold font-mono text-zinc-500">
                      {slaMinutes}
                    </div>
                    <div className="text-[10px] uppercase font-bold text-zinc-500">
                      Min
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Decor */}
            <div className={`absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl -z-10 ${data.completed_at ? 'bg-emerald-500/5' : 'bg-blue-500/5'}`}></div>
          </div>
        )}

        {/* Summary Details */}
        <div className="bg-slate-900/40 border border-slate-800/60 rounded-3xl overflow-hidden mb-6 animate-fade-in-up animation-delay-200">
          <div className="p-4 border-b border-slate-800/60 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Request Summary</span>
          </div>

          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-xl shadow-inner">✨</div>
                <div>
                  <div className="text-white font-bold">{data.service?.label}</div>
                  <div className="text-xs text-slate-500">{data.zone?.name || (data.room ? `Room ${data.room.number}` : "Public Area")}</div>
                </div>
              </div>
              <ChevronRight size={16} className="text-slate-600" />
            </div>

            <div className="h-px bg-white/5" />

            <div className="flex items-center gap-3 text-sm text-zinc-400">
              <Hash size={14} className="text-zinc-600" />
              <span>Request ID: <span className="text-zinc-300 font-mono">#{data.display_id}</span></span>
            </div>

            {data.description && (
              <div className="flex items-center gap-3 text-sm text-zinc-400">
                <FileText size={14} className="text-zinc-600" />
                <span>Notes: <span className="text-zinc-300 italic">"{data.description}"</span></span>
              </div>
            )}
          </div>
        </div>

        {/* Timeline */}
        <div className="bg-slate-900/40 border border-slate-800/60 rounded-3xl p-6 mb-8 animate-fade-in-up animation-delay-300">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-6">Status Updates</div>
          <div className="relative pl-2 space-y-8">
            {/* Vertical Line */}
            <div className="absolute left-[15px] top-2 bottom-2 w-0.5 bg-zinc-800 rounded-full" />

            {steps.map((step, i) => (
              <div key={i} className={`relative flex items-start gap-4 ${step.active ? 'opacity-100' : 'opacity-40'}`}>
                <div className={`relative z-10 w-8 h-8 rounded-full border-4 flex items-center justify-center shrink-0 transition-all duration-500 ${step.completed ? 'bg-blue-500 border-blue-500 text-white' : step.active ? 'bg-[#0b1120] border-blue-500 animate-pulse' : 'bg-[#0b1120] border-slate-700'}`}>
                  {step.completed && <CheckCircle2 size={14} />}
                  {!step.completed && step.active && <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />}
                </div>
                <div className="pt-1">
                  <div className={`text-sm font-bold ${step.active ? 'text-white' : 'text-zinc-500'}`}>{step.label}</div>
                  {step.time && <div className="text-xs text-zinc-500 mt-0.5">Today • {step.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Conversation / Comments */}
        {comments.length > 0 && (
          <div className="bg-slate-900/40 border border-slate-800/60 rounded-3xl p-6 mb-8 animate-fade-in-up animation-delay-300">
            <div className="flex items-center gap-2 mb-6">
              <MessageSquare size={14} className="text-slate-500" />
              <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Conversation</span>
            </div>

            <div className="space-y-4">
              {comments.filter(c => c.event_type === 'COMMENT_ADDED').map((c, index, arr) => {
                const date = new Date(c.created_at);
                const prevDate = index > 0 ? new Date(arr[index - 1].created_at) : null;
                const showDate = !prevDate || date.toDateString() !== prevDate.toDateString();

                const isGuest = c.actor_type === 'GUEST';

                // Helper for grouping labels
                const getDayLabel = (d: Date) => {
                  const now = new Date();
                  if (d.toDateString() === now.toDateString()) return 'Today';
                  const yesterday = new Date(now);
                  yesterday.setDate(now.getDate() - 1);
                  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
                  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
                };

                return (
                  <div key={c.id}>
                    {showDate && (
                      <div className="flex justify-center my-4">
                        <span className="text-[10px] bg-slate-800/50 text-slate-500 px-3 py-1 rounded-full border border-slate-700/50">
                          {getDayLabel(date)}
                        </span>
                      </div>
                    )}
                    <div className={`flex ${isGuest ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed relative ${isGuest
                        ? 'bg-blue-600/20 text-blue-100 rounded-tr-sm border border-blue-500/20'
                        : 'bg-slate-800/80 text-slate-300 rounded-tl-sm border border-slate-700'
                        }`}>
                        {c.comment}
                        <div className={`text-[10px] mt-1 text-right opacity-60 ${isGuest ? 'text-blue-200' : 'text-slate-400'}`}>
                          {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Input Area */}
            {data && !['COMPLETED', 'RESOLVED', 'CLOSED', 'CANCELLED'].includes(data.status) && (
              <div className="mt-6 pt-4 border-t border-slate-800/60 flex items-center gap-2">
                <input
                  type="text"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 transition-all"
                  onKeyDown={(e) => e.key === 'Enter' && handleSendComment()}
                />
                <button
                  onClick={handleSendComment}
                  disabled={!commentText.trim() || submittingComment}
                  className="p-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {submittingComment ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        {['COMPLETED', 'RESOLVED', 'CLOSED', 'CANCELLED'].includes(data.status) ? (
          <button
            onClick={handleReopen}
            className="w-full bg-slate-800 border border-slate-700 hover:bg-slate-700 text-white py-4 rounded-xl text-sm font-bold transition-all shadow-lg flex items-center justify-center gap-2"
          >
            <RefreshCcw size={18} /> Reopen Request
          </button>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <button
                onClick={() => setShowDetailsModal(true)}
                className="flex items-center justify-center gap-2 bg-slate-800 border border-slate-700 hover:bg-slate-700 text-white py-3.5 rounded-xl text-sm font-bold transition-all shadow-lg"
              >
                <Edit2 size={16} /> Add More Details
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center justify-center gap-2 bg-slate-800 border border-slate-700 hover:bg-slate-700 text-white py-3.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50 shadow-lg"
              >
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                {uploading ? "Uploading..." : "Add Photo"}
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handlePhotoUpload}
                hidden
                accept="image/*"
              />
            </div>

            <button
              onClick={() => setShowCancelModal(true)}
              className="w-full bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20 py-3.5 rounded-xl text-sm font-bold transition-all"
            >
              Cancel Request
            </button>
          </>
        )}

        {/* Attachments List */}
        {data.attachments && data.attachments.length > 0 && (
          <div className="bg-zinc-900/50 border border-white/5 rounded-3xl p-4 mb-6">
            <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Posted Photos</div>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {data.attachments.map((file, idx) => (
                <a key={idx} href={supabase.storage.from('ticket-attachments').getPublicUrl(file.file_path).data.publicUrl} target="_blank" rel="noreferrer" className="block shrink-0">
                  <img src={supabase.storage.from('ticket-attachments').getPublicUrl(file.file_path).data.publicUrl} alt="attachment" className="w-20 h-20 rounded-lg object-cover border border-white/10" />
                </a>
              ))}
            </div>
          </div>
        )}

      </div>
      {/* Add Details Modal */}
      {showDetailsModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-lg bg-[#1a1a1a] rounded-t-3xl sm:rounded-3xl border border-white/10 p-6 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-bold text-white">Add Details</h3>
              <button onClick={() => setShowDetailsModal(false)} className="p-2 bg-zinc-800 rounded-full text-zinc-400 hover:text-white">
                <XCircle size={20} />
              </button>
            </div>

            <textarea
              className="w-full h-32 bg-zinc-900/50 border border-white/10 rounded-xl p-4 text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition-colors resize-none"
              placeholder="Add more context or details..."
              id="details-input"
            />

            <button
              onClick={() => {
                const val = (document.getElementById('details-input') as HTMLTextAreaElement).value;
                submitDetails(val);
              }}
              disabled={isUpdating}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isUpdating ? <Loader2 size={18} className="animate-spin" /> : "Submit Update"}
            </button>
          </div>
        </div>
      )}


      {/* Reopen Modal */}
      {
        showReopenModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
            <div className="w-full max-w-md bg-[#1a1a1a] rounded-3xl border border-white/10 p-6 space-y-4 shadow-2xl">
              <div>
                <h3 className="text-xl font-bold text-white mb-1">Reopen Request</h3>
                <p className="text-zinc-400 text-sm">This will reopen the request for the staff.</p>
              </div>

              <textarea
                className="w-full h-24 bg-zinc-900/50 border border-white/10 rounded-xl p-4 text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 transition-colors resize-none"
                placeholder="Reason (optional)..."
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
              />

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => setShowReopenModal(false)}
                  className="flex-1 py-3.5 rounded-xl text-zinc-400 font-bold hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={submitReopen}
                  disabled={loading}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-emerald-900/20 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 size={18} className="animate-spin" /> : "Confirm"}
                </button>
              </div>
            </div>
          </div>
        )
      }
    </main >
  );
}
