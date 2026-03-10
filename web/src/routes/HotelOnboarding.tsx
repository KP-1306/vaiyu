import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
    Building2, Settings2, BedDouble, Users, Zap,
    ArrowRight, ArrowLeft, Check, Loader2,
    Plus, Trash2, Sparkles, X,
    Search, ChevronDown, BoxSelect, Grid3X3,
    Pencil, MoreVertical, AlertTriangle, Filter, GripVertical,
    Shield, FileText, UserPlus, Key, Eye,
    Copy, Upload, Download, History, RotateCcw, ShieldAlert, Info, MoreHorizontal, Save, Clock,
    ArrowUpCircle, Bell, HelpCircle, MapPin, Mail, Phone,
    Star, UserCircle, Map, Paintbrush, Coffee
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { ImageUpload } from "../components/ImageUpload";

/* ─────────────────────────────────────────────────────── */
/*  TYPES                                                  */
/* ─────────────────────────────────────────────────────── */
interface HotelForm {
    name: string; slug: string; description: string; phone: string; email: string;
    address: string; city: string; state: string; country: string; postal_code: string;
    latitude: string; longitude: string;
    legal_name: string; gst_number: string; logo_url: string; cover_image_url: string;
    default_checkin_time: string; default_checkout_time: string;
    early_checkin_allowed: boolean; late_checkout_allowed: boolean;
    timezone: string; currency_code: string;
    tax_percentage: string; service_charge_percentage: string;
    invoice_prefix: string; invoice_counter: string; starting_invoice: string;
    brand_color: string; upi_id: string; booking_url: string;
    amenities: string[];
    // Guest Info
    wifi_ssid?: string;
    wifi_password?: string;
    breakfast_start?: string;
    breakfast_end?: string;
    guest_notes?: string;
}

interface RoomType {
    id: string; // Local ID for UI mapping
    name: string;
    base_occupancy: string;
    max_occupancy: string;
    active: boolean;
    // Keeping rate/count for backend structure but hiding in UI if needed
    rate?: string;
    count?: string;
}

interface RoomInventory {
    id: string; // Local ID
    room_type_id: string;
    number: string;
    floor: string;
    wing: string;
    status: 'Vacant' | 'Occupied' | 'Dirty' | 'Out of Order';
    active: boolean;
}

interface StaffMember {
    id: string;
    name: string;
    email: string;
    phone: string;
    role: string;
    status: 'Active' | 'Suspended' | 'Terminated';
    assignedZones: string;
    employmentStatus: 'Active' | 'On Leave' | 'Contract' | 'Terminated';
    accountStatus: 'Invite Sent' | 'Active' | 'Locked' | 'Suspended';
    lastLogin: string;
    ipAddress: string;
    selected: boolean;
}
interface FeatureToggle { key: string; label: string; desc: string; enabled: boolean; }

/* ─────────────────────────────────────────────────────── */
/*  CONSTANTS                                              */
/* ─────────────────────────────────────────────────────── */
const STEPS = [
    { key: "hotel", label: "Hotel Details", icon: Building2, desc: "Basic info, contact & address" },
    { key: "ops", label: "Operational Settings", icon: Settings2, desc: "GST, timings, tax & invoicing" },
    { key: "rooms", label: "Room Setup", icon: BedDouble, desc: "Define room types and manage your inventory efficiently" },
    { key: "staff", label: "Staff Setup", icon: Users, desc: "Add your staff & assign roles" },
    { key: "features", label: "Enable Features", icon: Zap, desc: "Select the features you want" },
];

const AMENITY_LIST = [
    "Wi-Fi", "Pool", "Spa", "Gym", "Restaurant", "Bar", "Room Service",
    "Parking", "Airport Shuttle", "Laundry", "AC", "Pet Friendly",
    "Business Center", "Concierge", "EV Charging", "Kids Club",
];

const ROLE_OPTIONS = ["Admin", "Manager", "Front Desk", "Receptionist", "Housekeeper", "Maintenance", "Security", "Concierge"];

const PERM_MODULES = [
    { key: 'housekeeping', label: 'Housekeeping', subs: ['View Board', 'Start Cleaning', 'Complete Cleaning', 'Bulk Assign Tasks'] },
    { key: 'sla', label: 'SLA Management', subs: ['View SLA', 'Request Exception', 'Approve SLA Exception', 'Override SLA'] },
    { key: 'financials', label: 'Financials', subs: ['View Folios', 'Modify Tickets', 'Approve SLA Override'] },
    { key: 'tickets', label: 'Ticket Lifecycle', subs: ['Modify Charges', 'Issue Refunds', 'Reopen Ticket', 'Request Supervisor'] },
    { key: 'room_service', label: 'Room Service', subs: ['View Orders', 'Modify Order', 'Issue Refunds'] },
    { key: 'maintenance', label: 'Maintenance', subs: ['View Requests', 'Handle Requests', 'Mark Out of Order', 'Complete Task'] },
    { key: 'security', label: 'Security', subs: ['Access Reports', 'Manage Access', 'View Logs'] },
] as const;

const CRITICAL_PERMS = new Set([
    'sla.Override SLA', 'sla.Approve SLA Exception',
    'financials.Approve SLA Override', 'financials.Modify Tickets',
    'tickets.Issue Refunds', 'tickets.Reopen Ticket', 'tickets.Request Supervisor',
    'room_service.Issue Refunds',
    'maintenance.Mark Out of Order',
]);

type PermKey = string; // module.sub key
interface RolePermRow {
    roleLabel: string;
    contact: string;
    scopes: Record<string, string>; // moduleKey → 'Global' | 'Assigned Zones Only'
    perms: Record<PermKey, boolean>;
}

const DEFAULT_FEATURES: FeatureToggle[] = [
    { key: "qr_checkin", label: "QR Code Check-in", desc: "Let guests check in by scanning QR codes for a touchless experience.", enabled: true },
    { key: "whatsapp", label: "WhatsApp Automation", desc: "Send booking confirmations & updates to guests via WhatsApp.", enabled: true },
    { key: "guest_portal", label: "Private Guest Portal", desc: "Branded portal for guests to manage bookings, raise requests & check out.", enabled: true },
    { key: "housekeeping", label: "Housekeeping Optimization", desc: "Smart cleaning queues, task assignment, and inspection workflows.", enabled: true },
    { key: "ops_board", label: "Ops & Service Board", desc: "Centralised dashboard for guest requests with real-time SLA tracking.", enabled: false },
    { key: "food_ordering", label: "In-Room Food Ordering", desc: "Digital menu with live kitchen integration and order tracking.", enabled: false },
];

const TZ_OPTIONS = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Tokyo"];
const CUR_OPTIONS = [
    { code: "INR", label: "₹ INR" }, { code: "USD", label: "$ USD" }, { code: "EUR", label: "€ EUR" },
    { code: "GBP", label: "£ GBP" }, { code: "AED", label: "AED" }, { code: "SGD", label: "S$ SGD" },
];

/* ─────────────────────────────────────────────────────── */
/*  HELPERS                                                */
/* ─────────────────────────────────────────────────────── */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_CLEAN = (v: string) => {
    const first = v.charAt(0) === "+" ? "+" : "";
    return first + v.replace(/[^0-9]/g, "");
};
const generateId = () => Math.random().toString(36).substring(2, 9);

/* ── Permission helpers (outside component to avoid recreation) ── */
const makePerms = (allTrue: boolean, overrides?: Record<string, boolean>): Record<string, boolean> => {
    const p: Record<string, boolean> = {};
    PERM_MODULES.forEach(m => m.subs.forEach(s => { p[`${m.key}.${s}`] = allTrue; }));
    if (overrides) Object.assign(p, overrides);
    return p;
};
const makeScopes = (v: string): Record<string, string> => {
    const s: Record<string, string> = {};
    PERM_MODULES.forEach(m => { s[m.key] = v; });
    return s;
};

function useStickyState<T>(defaultValue: T | (() => T), key: string) {
    const [value, setValue] = useState<T>(() => {
        const stickyValue = window.localStorage.getItem(key);
        if (stickyValue !== null) {
            try { return JSON.parse(stickyValue); } catch (e) { }
        }
        if (typeof defaultValue === 'function') {
            return (defaultValue as () => T)();
        }
        return defaultValue;
    });
    useEffect(() => {
        window.localStorage.setItem(key, JSON.stringify(value));
    }, [key, value]);
    return [value, setValue] as const;
}

/* ─────────────────────────────────────────────────────── */
/*  COMPONENT                                              */
/* ─────────────────────────────────────────────────────── */
/*  ROOM TEMPLATES                                         */
/* ─────────────────────────────────────────────────────── */
const SYSTEM_ROOM_TEMPLATES = [
    { code: 'STANDARD', name: 'Standard', description: 'Basic standard category', base_occupancy: '2', max_occupancy: '2' },
    { code: 'DELUXE', name: 'Deluxe', description: 'Larger upgraded category', base_occupancy: '2', max_occupancy: '3' },
    { code: 'EXECUTIVE', name: 'Executive', description: 'Premium business category', base_occupancy: '2', max_occupancy: '3' },
    { code: 'SUPERIOR', name: 'Superior', description: 'Enhanced comfort category', base_occupancy: '2', max_occupancy: '3' },
    { code: 'PREMIUM', name: 'Premium', description: 'High-end premium category', base_occupancy: '2', max_occupancy: '3' },
    { code: 'FAMILY', name: 'Family', description: 'Family stay category', base_occupancy: '3', max_occupancy: '5' },
    { code: 'TWIN', name: 'Twin', description: 'Two separate beds', base_occupancy: '2', max_occupancy: '2' },
    { code: 'DOUBLE', name: 'Double', description: 'Single double bed', base_occupancy: '2', max_occupancy: '2' },
    { code: 'STUDIO', name: 'Studio', description: 'Studio layout category', base_occupancy: '2', max_occupancy: '3' },
    { code: 'JUNIOR_SUITE', name: 'Junior Suite', description: 'Entry-level suite', base_occupancy: '2', max_occupancy: '3' },
    { code: 'SUITE', name: 'Suite', description: 'Luxury suite', base_occupancy: '2', max_occupancy: '4' },
    { code: 'EXECUTIVE_SUITE', name: 'Executive Suite', description: 'Premium executive suite', base_occupancy: '2', max_occupancy: '4' },
    { code: 'PRESIDENTIAL_SUITE', name: 'Presidential Suite', description: 'Top-tier luxury suite', base_occupancy: '2', max_occupancy: '6' },
    { code: 'ACCESSIBLE', name: 'Accessible', description: 'Accessibility enabled category', base_occupancy: '2', max_occupancy: '2' },
    { code: 'CONNECTING', name: 'Connecting', description: 'Interconnected rooms', base_occupancy: '2', max_occupancy: '4' },
    { code: 'DORMITORY', name: 'Dormitory', description: 'Shared dormitory category', base_occupancy: '4', max_occupancy: '10' }
];

const RECOMMENDED_ROOM_TYPES = ['FAMILY', 'EXECUTIVE', 'JUNIOR_SUITE', 'PRESIDENTIAL_SUITE', 'TWIN', 'DOUBLE', 'ACCESSIBLE'];

/* ─────────────────────────────────────────────────────── */
export default function HotelOnboarding() {
    const navigate = useNavigate();
    const [step, setStep] = useStickyState(0, "vaiyu_ob_step");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [success, setSuccess] = useState(false);
    const [transitioning, setTransitioning] = useState(false);

    /* ── User State ── */
    const [userEmail, setUserEmail] = useState<string>("Loading...");
    const [userInitials, setUserInitials] = useState<string>("");
    const [userId, setUserId] = useState<string | null>(null);

    useEffect(() => {
        const fetchUser = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user?.email) {
                const email = session.user.email;
                setUserEmail(email);
                setUserInitials(email.substring(0, 2).toUpperCase());
                setUserId(session.user.id);
            } else {
                setUserEmail("Unknown User");
                setUserInitials("??");
            }
        };
        fetchUser();
    }, []);

    /* ── Form State ── */
    const [form, setForm] = useStickyState<HotelForm>({
        name: "", slug: "", description: "", phone: "", email: "",
        address: "", city: "", state: "", country: "India", postal_code: "",
        latitude: "", longitude: "",
        legal_name: "", gst_number: "", logo_url: "", cover_image_url: "",
        default_checkin_time: "14:00", default_checkout_time: "11:00",
        early_checkin_allowed: false, late_checkout_allowed: false,
        timezone: "Asia/Kolkata", currency_code: "INR",
        tax_percentage: "12", service_charge_percentage: "0",
        invoice_prefix: "", invoice_counter: "1", starting_invoice: "",
        brand_color: "#6366F1", upi_id: "", booking_url: "",
        amenities: [],
        wifi_ssid: "", wifi_password: "", breakfast_start: "07:00", breakfast_end: "10:30", guest_notes: ""
    }, "vaiyu_ob_form");

    /* ── Room Setup State (Redesign) ── */
    const [roomTypes, setRoomTypes] = useStickyState<RoomType[]>(() => [
        { id: generateId(), name: "Standard", base_occupancy: "2", max_occupancy: "2", active: true },
        { id: generateId(), name: "Deluxe", base_occupancy: "2", max_occupancy: "3", active: true },
        { id: generateId(), name: "Suite", base_occupancy: "2", max_occupancy: "4", active: true },
    ], "vaiyu_ob_roomTypes");
    const [inventory, setInventory] = useStickyState<RoomInventory[]>([], "vaiyu_ob_inventory");
    const [editingRoomTypeIdx, setEditingRoomTypeIdx] = useState<number | null>(null);

    // Add Room Type Modal State
    const [isAddRoomModalOpen, setIsAddRoomModalOpen] = useState(false);
    const [addRoomTab, setAddRoomTab] = useState<'recommended' | 'all' | 'custom'>('recommended');
    const [customRoomForm, setCustomRoomForm] = useState({ name: '', base_occupancy: '2', max_occupancy: '2' });

    // Template Confirmation State
    const [modalSearch, setModalSearch] = useState('');
    const [selectedTemplates, setSelectedTemplates] = useState<Record<string, boolean>>({});

    // Parser State
    const [selectedRoomTypeId, setSelectedRoomTypeId] = useState<string>("");
    const [selectedWing, setSelectedWing] = useState("");
    const [parseInput, setParseInput] = useState("");
    const [parseTags, setParseTags] = useState<string[]>([]);
    const [autoDetectFloor, setAutoDetectFloor] = useState(true);
    const [overrideFloorVal, setOverrideFloorVal] = useState("1");
    const [previewRooms, setPreviewRooms] = useState<RoomInventory[]>([]);
    const [inventorySearch, setInventorySearch] = useState("");

    const [staffMembers, setStaffMembers] = useStickyState<StaffMember[]>(() => [
        { id: generateId(), name: "First Staff Account", email: "staff@example.com", phone: "", role: "Manager", status: "Active", assignedZones: "All Zones", employmentStatus: "Active", accountStatus: "Invite Sent", lastLogin: "", ipAddress: "", selected: false },
    ], "vaiyu_ob_staff");
    const [staffTab, setStaffTab] = useState<'manage' | 'roles' | 'logs'>('roles');
    const [rolesSearch, setRolesSearch] = useState("");

    const [showAddRoleModal, setShowAddRoleModal] = useState(false);
    const [availableRoles, setAvailableRoles] = useState<any[]>([]);
    const [selectedRolesToAdd, setSelectedRolesToAdd] = useState<string[]>([]);
    const [loadingRoles, setLoadingRoles] = useState(false);

    useEffect(() => {
        const fetchSystemRoles = async () => {
            if (!showAddRoleModal) return;
            setLoadingRoles(true);
            try {
                const { data, error } = await supabase
                    .from('system_role_templates')
                    .select('*')
                    .eq('is_active', true)
                    .order('code', { ascending: true });

                if (error) throw error;
                if (data) {
                    setAvailableRoles(data);
                }
            } catch (err) {
                console.error("Failed to load role templates:", err);
            } finally {
                setLoadingRoles(false);
            }
        };
        fetchSystemRoles();
    }, [showAddRoleModal]);

    const [staffSearch, setStaffSearch] = useState("");
    const [staffRoleFilter, setStaffRoleFilter] = useState("");
    const [staffStatusFilter, setStaffStatusFilter] = useState("");
    const [staffZoneFilter, setStaffZoneFilter] = useState("");
    const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);

    /* ── Roles & Permissions State ── */
    const [rolePerms, setRolePerms] = useStickyState<RolePermRow[]>(() => [
        { roleLabel: 'Manager', contact: '(555) 123-4567', scopes: makeScopes('Global'), perms: makePerms(true) },
        { roleLabel: 'Receptionist', contact: '(555) 123-4567', scopes: { ...makeScopes('Global'), sla: 'Assigned Zones Only' }, perms: makePerms(true, { 'sla.Approve SLA Exception': false, 'sla.Override SLA': false, 'tickets.Request Supervisor': false }) },
        { roleLabel: 'Housekeeper', contact: '', scopes: makeScopes('Global'), perms: makePerms(true, { 'financials.Modify Tickets': false, 'financials.Approve SLA Override': false, 'tickets.Issue Refunds': false, 'tickets.Reopen Ticket': false, 'tickets.Request Supervisor': false, 'security.Manage Access': false }) },
        { roleLabel: 'Maintenance', contact: '', scopes: makeScopes('Global'), perms: makePerms(false, { 'housekeeping.View Board': true, 'maintenance.View Requests': true, 'maintenance.Handle Requests': true, 'maintenance.Mark Out of Order': true, 'maintenance.Complete Task': true, 'room_service.View Orders': true }) },
        { roleLabel: 'Security Guard', contact: '', scopes: makeScopes('Global'), perms: makePerms(false, { 'security.Access Reports': true, 'security.View Logs': true, 'housekeeping.View Board': true }) },
    ], "vaiyu_ob_roles");

    const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
    const [staffForm, setStaffForm] = useState<Partial<StaffMember>>(() => ({
        name: "", email: "", phone: "", role: rolePerms?.[0]?.roleLabel || "", status: "Active",
        assignedZones: "", employmentStatus: "Active"
    }));

    const [selectedRoleIdx, setSelectedRoleIdx] = useState<number | null>(null);
    const [roleVersion, setRoleVersion] = useState("v1.4");
    const [roleChangeLog] = useState(() => [
        { time: 'Today, 2:04 PM', action: 'Updated permission assignments', icon: '🔧' },
        { time: 'Sat, 1:34 15:44M', action: 'Created role "Maint" from template', icon: '📋' },
    ]);
    const togglePerm = (roleIdx: number, permKey: string) => {
        setRolePerms(p => p.map((r, i) => i === roleIdx ? { ...r, perms: { ...r.perms, [permKey]: !r.perms[permKey] } } : r));
    };
    const updateScope = (roleIdx: number, modKey: string, val: string) => {
        setRolePerms(p => p.map((r, i) => i === roleIdx ? { ...r, scopes: { ...r.scopes, [modKey]: val } } : r));
    };

    /* ── Access Logs State ── */
    const [accessLogs] = useState(() => [
        { id: '33874', time: 'Today, 2:04 PM', severity: 'Sensitive' as const, actor: 'Harry Reynolds', actorRole: 'Receptionist', event: 'Folio #9721', entity: 'Folio', source: '172.18.97', sourceDetail: 'mc1084c0317', host: 'Grand Palace', origin: 'Dashboard' },
        { id: '33865', time: 'Today, 2:07 PM', severity: 'Sensitive' as const, actor: 'Harry Reynolds', actorRole: '', event: 'Ticket #1109', entity: 'Ticket', source: '117.159.12', sourceDetail: 'ch036,2084', host: 'Grand Palace', origin: 'Dashboard' },
        { id: '33864', time: 'Today, 2:05 PM', severity: 'Critical' as const, actor: 'Ashley Larson', actorRole: 'Pacom 527EL', event: 'Room 17512', entity: 'Room', source: 'Chrome 125K', sourceDetail: '13:01:47', host: 'Dashboard', origin: 'Dashboard' },
        { id: '33865b', time: 'Today, 11:22 AM', severity: 'Normal' as const, actor: 'Amanda Clark', actorRole: 'Email Official', event: 'Ticket #1109', entity: 'Ticket', source: '172.18.87', sourceDetail: 'N2.879.352', host: 'Phabex', origin: 'API' },
        { id: '33867', time: 'Today, 11:27 AM', severity: 'Critical' as const, actor: 'E59 Admin', actorRole: '', event: 'Failed login attempt', entity: 'Auth', source: '••••', sourceDetail: '', host: '', origin: 'System' },
        { id: '33866', time: 'Today, 11:27 AM', severity: 'Critical' as const, actor: 'AD Admin', actorRole: 'Admnlrred #22281', event: 'Room Cleaning', entity: 'Room', source: '', sourceDetail: '', host: 'Dashboard', origin: 'Dashboard' },
        { id: '33865c', time: 'Today, 11:12 AM', severity: 'Critical' as const, actor: 'James Morgan', actorRole: 'Samita Lasky', event: 'Room Cleaning', entity: 'Room', source: '10:58 AM', sourceDetail: '91-00.194.8', host: 'Grand Palace', origin: 'Cron' },
        { id: '33861', time: 'Today, 11:13 AM', severity: 'Normal' as const, actor: 'E59 Admin', actorRole: '', event: 'Fodel #11102 5', entity: 'Folio', source: '', sourceDetail: '', host: 'Op', origin: 'Webhook' },
    ]);
    const [logSearch, setLogSearch] = useState('');
    const [logSeverityFilter, setLogSeverityFilter] = useState('');
    const [selectedLogIdx, setSelectedLogIdx] = useState<number | null>(null);
    const [forensicMode, setForensicMode] = useState(true);
    const [logDetailTab, setLogDetailTab] = useState<'activity' | 'timeline' | 'linked' | 'financial'>('activity');
    const [features, setFeatures] = useStickyState<FeatureToggle[]>(DEFAULT_FEATURES, "vaiyu_ob_features");
    const [hotelId, setHotelId] = useStickyState<string | null>(null, "vaiyu_ob_hotel_id");
    const [hotelSuggestions, setHotelSuggestions] = useState<any[]>([]);
    const [isHotelSearching, setIsHotelSearching] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isHeaderSelectorOpen, setIsHeaderSelectorOpen] = useState(false);
    const [headerSearchQuery, setHeaderSearchQuery] = useState("");

    const set = (key: keyof HotelForm, val: any) => setForm(p => ({ ...p, [key]: val }));

    /* ── Hotel Search & Auto-Population ── */
    const searchHotels = async (query: string = "") => {
        setIsHotelSearching(true);
        try {
            let q = supabase.from('v_public_hotels').select('*').limit(10);

            if (query.length >= 1) {
                q = q.or(`name.ilike.%${query}%,slug.ilike.%${query}%`);
            } else if (query.length > 0) {
                setHotelSuggestions([]);
                return;
            }
            // If empty, just takes first 10

            const { data, error } = await q;

            if (error) throw error;
            setHotelSuggestions(data || []);
        } catch (err) {
            console.error("Search error:", err);
        } finally {
            setIsHotelSearching(false);
        }
    };

    const autoPopulateForm = async (h: any) => {
        setHotelId(h.id);
        setForm({
            name: h.name || "",
            slug: h.slug || "",
            description: h.description || "",
            phone: h.phone || "",
            email: h.email || "",
            address: h.address || "",
            city: h.city || "",
            state: h.state || "",
            country: h.country || "India",
            postal_code: h.postal_code || "",
            latitude: h.latitude ? String(h.latitude) : "",
            longitude: h.longitude ? String(h.longitude) : "",
            legal_name: h.legal_name || "",
            gst_number: h.gst_number || "",
            logo_url: h.logo_url || "",
            cover_image_url: h.cover_image_url || "",
            default_checkin_time: h.default_checkin_time || "14:00",
            default_checkout_time: h.default_checkout_time || "11:00",
            early_checkin_allowed: Boolean(h.early_checkin_allowed),
            late_checkout_allowed: Boolean(h.late_checkout_allowed),
            timezone: h.timezone || "Asia/Kolkata",
            currency_code: h.currency_code || "INR",
            tax_percentage: h.tax_percentage ? String(h.tax_percentage) : "12",
            service_charge_percentage: h.service_charge_percentage ? String(h.service_charge_percentage) : "0",
            invoice_prefix: h.invoice_prefix || "",
            invoice_counter: h.invoice_counter ? String(h.invoice_counter) : "1",
            starting_invoice: "",
            brand_color: h.brand_color || "#6366F1",
            upi_id: h.upi_id || "",
            booking_url: h.booking_url || "",
            amenities: h.amenities || [],
        });

        setTransitioning(true);
        setError("");

        try {
            // Enterprise Standard: Single Payload RPC Fetching
            const { data: stateData, error: stateError } = await supabase.rpc('get_hotel_onboarding_state', {
                p_hotel_id: h.id
            });

            // Enterprise Standard: Explicit error checking returning soft-warnings
            if (stateError || !stateData) {
                console.error("Hydration errors:", stateError);
                setError("Warning: We encountered an issue fully synchronizing your hotel's data. Some sections may be incomplete.");
            }

            const { room_types: rtData = [], rooms: rmData = [], roles: roleData = [], invites: invData = [] } = stateData || {};

            // Hydrate Room Types
            if (rtData && rtData.length > 0) {
                setRoomTypes(rtData.map((rt: any) => ({
                    id: rt.id,
                    name: rt.name,
                    base_occupancy: String(rt.base_occupancy),
                    max_occupancy: String(rt.max_occupancy),
                    active: true
                })));
            }

            // Hydrate Room Inventory
            if (rmData && rmData.length > 0) {
                setInventory(rmData.map((rm: any) => ({
                    id: rm.id,
                    room_type_id: rm.room_type_id,
                    number: rm.number,
                    floor: rm.floor || "1",
                    wing: rm.wing || "",
                    status: rm.is_out_of_order ? 'Out of Order' : (rm.status === 'occupied' ? 'Occupied' : 'Vacant'),
                    active: !rm.is_out_of_order
                })));
            }

            // Hydrate Roles
            if (roleData && roleData.length > 0) {
                setRolePerms(roleData.map((r: any) => ({
                    roleLabel: r.name,
                    contact: r.description || '',
                    scopes: makeScopes('Global'),
                    perms: makePerms(true)
                })));
            }

            // Hydrate Initial Staff Invites
            if (invData && invData.length > 0) {
                setStaffMembers(invData.map((inv: any) => ({
                    id: inv.id,
                    name: inv.email,
                    email: inv.email,
                    phone: "",
                    role: inv.role_name || "Staff",
                    status: "Active",
                    assignedZones: (inv.invite_metadata as any)?.assigned_zones || "All Zones",
                    employmentStatus: (inv.invite_metadata as any)?.employment_status || "Active",
                    accountStatus: "Invite Sent",
                    lastLogin: "",
                    ipAddress: "",
                    selected: false
                })));
            }

            // Hydrate Features from Theme JSON
            if (h.theme && Array.isArray(h.theme)) {
                setFeatures(h.theme);
            }
        } catch (e: any) {
            console.error("Error cross-hydrating DB data into onboarding:", e);
            setError("Critical Error: Unable to synchronize hotel data. Please check your connection.");
        } finally {
            setTransitioning(false);
        }

        setShowSuggestions(false);
    };

    const handleNameChange = (val: string) => {
        set("name", val);
        const slug = val.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 40);
        set("slug", slug);
        if (!form.invoice_prefix) set("invoice_prefix", val.split(" ").map(w => w[0]?.toUpperCase() || "").join("").slice(0, 4) + "-");

        // Trigger search
        searchHotels(val);
        setShowSuggestions(true);
    };

    const toggleAmenity = (a: string) =>
        setForm(p => ({ ...p, amenities: p.amenities.includes(a) ? p.amenities.filter(x => x !== a) : [...p.amenities, a] }));

    /* ── Room Setup Logic ── */
    const handleToggleTemplate = (template: typeof SYSTEM_ROOM_TEMPLATES[0]) => {
        setSelectedTemplates(p => {
            const next = { ...p };
            if (next[template.code]) {
                delete next[template.code];
            } else {
                next[template.code] = true;
            }
            return next;
        });
    };

    const handleAddSelectedTemplates = () => {
        const newTypes = Object.keys(selectedTemplates).map(code => {
            const template = SYSTEM_ROOM_TEMPLATES.find(t => t.code === code);
            return {
                id: generateId(),
                name: template?.name || 'Unknown',
                base_occupancy: template?.base_occupancy || '2',
                max_occupancy: template?.max_occupancy || '2',
                active: true
            };
        });

        if (newTypes.length > 0) {
            setRoomTypes(p => [...p, ...newTypes]);
        }
        setIsAddRoomModalOpen(false);
        setSelectedTemplates({});
        setModalSearch('');
    };

    const handleAddCustomRoomType = () => {
        if (!customRoomForm.name.trim()) return;
        setRoomTypes(p => [...p, {
            id: generateId(),
            name: customRoomForm.name,
            base_occupancy: customRoomForm.base_occupancy,
            max_occupancy: customRoomForm.max_occupancy,
            active: true
        }]);
        setIsAddRoomModalOpen(false);
        setCustomRoomForm({ name: '', base_occupancy: '2', max_occupancy: '2' });
    };

    const removeRoomType = (i: number) => setRoomTypes(p => p.filter((_, j) => j !== i));
    const updateRoomType = (i: number, key: keyof RoomType, val: any) =>
        setRoomTypes(p => p.map((rt, j) => j === i ? { ...rt, [key]: val } : rt));

    const detectFloor = (roomNum: string) => {
        const match = roomNum.match(/^(\d+)/);
        if (!match) return "1";
        const numStr = match[1];
        if (numStr.length <= 2) return "1"; // e.g., 12 -> 1, 99 -> 1
        return numStr.substring(0, numStr.length - 2); // e.g., 101 -> 1, 1205 -> 12
    };

    const addParseTag = (raw: string) => {
        const tag = raw.trim().replace(/,$/, '');
        if (!tag) return;
        setParseTags(p => p.includes(tag) ? p : [...p, tag]);
        setParseInput("");
    };

    const removeParseTag = (tag: string) => setParseTags(p => p.filter(t => t !== tag));

    const runParser = () => {
        if (!selectedRoomTypeId) {
            setFieldErrors(p => ({ ...p, parserType: "Select a Room Type first" }));
            return;
        }
        setFieldErrors(p => ({ ...p, parserType: "" }));

        // Combine parseTags + any leftover parseInput
        const allTokens = [...parseTags];
        if (parseInput.trim()) allTokens.push(parseInput.trim());

        const newRooms: RoomInventory[] = [];

        allTokens.forEach(token => {
            const rangeMatch = token.match(/^(\d+)[-to]+(\d+)$/i);
            if (rangeMatch) {
                const start = parseInt(rangeMatch[1], 10);
                const end = parseInt(rangeMatch[2], 10);
                if (!isNaN(start) && !isNaN(end) && start <= end) {
                    for (let i = start; i <= end; i++) {
                        const rnum = i.toString();
                        newRooms.push({
                            id: generateId(), room_type_id: selectedRoomTypeId,
                            number: rnum, floor: autoDetectFloor ? detectFloor(rnum) : overrideFloorVal,
                            wing: selectedWing, status: 'Vacant', active: true
                        });
                    }
                }
            } else {
                newRooms.push({
                    id: generateId(), room_type_id: selectedRoomTypeId,
                    number: token, floor: autoDetectFloor ? detectFloor(token) : overrideFloorVal,
                    wing: selectedWing, status: 'Vacant', active: true
                });
            }
        });

        // Dedup within preview
        const uniquePreview = newRooms.filter((v, i, a) => a.findIndex(t => (t.number === v.number)) === i);
        setPreviewRooms(uniquePreview);
    };

    // Detect duplicates in preview against existing inventory
    const duplicateRoomNumbers = useMemo(() => previewRooms.filter(pr => inventory.some(r => r.number === pr.number)).map(pr => pr.number), [previewRooms, inventory]);

    const commitPreview = () => {
        const existingNumbers = new Set(inventory.map(r => r.number));
        const filteredPreview = previewRooms.filter(pr => !existingNumbers.has(pr.number));

        setInventory(p => [...p, ...filteredPreview]);
        setPreviewRooms([]);
        setParseInput("");
        setParseTags([]);
    };

    const removeInventoryRoom = (id: string) => setInventory(p => p.filter(r => r.id !== id));
    const toggleInventoryStatus = (id: string) => setInventory(p => p.map(r => r.id === id ? { ...r, active: !r.active } : r));

    useEffect(() => {
        if (roomTypes.length > 0 && !selectedRoomTypeId) {
            setSelectedRoomTypeId(roomTypes[0].id);
        }
    }, [roomTypes]);

    /* ── Staff Logic ── */
    const addStaff = () => {
        setEditingStaffId(null);
        setStaffForm({ name: "", email: "", phone: "", role: rolePerms?.[0]?.roleLabel || "", status: "Active" });
        setIsStaffModalOpen(true);
    };
    const editStaff = (s: StaffMember) => {
        setEditingStaffId(s.id);
        setStaffForm({ name: s.name, email: s.email, phone: s.phone, role: s.role, status: s.status });
        setIsStaffModalOpen(true);
    };
    const handleStaffSubmit = () => {
        if (!staffForm.name?.trim() || !staffForm.email?.trim()) {
            setError("Name and Email are required");
            return;
        }
        if (editingStaffId) {
            setStaffMembers(p => p.map(s => s.id === editingStaffId ? { ...s, ...staffForm } : s));
        } else {
            setStaffMembers(p => [...p, {
                id: generateId(),
                name: staffForm.name || "",
                email: staffForm.email || "",
                phone: staffForm.phone || "",
                role: staffForm.role || rolePerms?.[0]?.roleLabel || "",
                status: (staffForm.status as any) || "Active",
                assignedZones: "",
                employmentStatus: "Active",
                accountStatus: "Invite Sent",
                lastLogin: "",
                ipAddress: "",
                selected: false
            }]);
        }
        setIsStaffModalOpen(false);
        setEditingStaffId(null);
    };
    const removeStaff = (id: string) => setStaffMembers(p => p.filter(s => s.id !== id));
    const updateStaff = (id: string, key: keyof StaffMember, val: any) =>
        setStaffMembers(p => p.map(s => s.id === id ? { ...s, [key]: val } : s));
    const toggleStaffSelect = (id: string) => setStaffMembers(p => p.map(s => s.id === id ? { ...s, selected: !s.selected } : s));
    const toggleAllStaff = (v: boolean) => setStaffMembers(p => p.map(s => ({ ...s, selected: v })));
    const deleteSelectedStaff = () => setStaffMembers(p => p.filter(s => !s.selected));
    const selectedStaffCount = useMemo(() => staffMembers.filter(s => s.selected).length, [staffMembers]);

    const toggleFeature = (key: string) =>
        setFeatures(p => p.map(f => f.key === key ? { ...f, enabled: !f.enabled } : f));

    const animateStep = (n: number) => { setTransitioning(true); setTimeout(() => { setStep(n); setTransitioning(false); }, 180); };

    /* ── Staff Helper Overrides ── */
    const updateStaffField = (id: string, field: keyof StaffMember, value: any) => {
        setStaffMembers(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
    };

    /* ── Validation ── */
    const validateStep = (): string | null => {
        const errs: Record<string, string> = {};
        if (step === 0) {
            if (!form.name.trim()) errs.name = "Hotel name is required";
            else if (form.name.trim().length < 3) errs.name = "Min 3 characters";
            if (!form.slug.trim()) errs.slug = "URL slug is required";
            const digits = form.phone.replace(/[^0-9]/g, "");
            if (!form.phone.trim()) errs.phone = "Phone is required";
            else if (digits.length < 10) errs.phone = "Min 10 digits";
            if (!form.email.trim()) errs.email = "Email is required";
            else if (!EMAIL_RE.test(form.email.trim())) errs.email = "Invalid email";
        }
        if (step === 1) {
            if (form.tax_percentage && (isNaN(+form.tax_percentage) || +form.tax_percentage < 0 || +form.tax_percentage > 100))
                errs.tax_percentage = "Must be 0–100";
            if (form.gst_number && form.gst_number.length !== 15) errs.gst_number = "Must be exactly 15 chars";
        }
        if (step === 2) {
            if (roomTypes.length === 0) errs.rooms = "Add at least one room type";
            roomTypes.forEach((r, i) => {
                if (!r.name.trim()) errs[`rt_name_${i}`] = "required";
                if (!r.base_occupancy || +r.base_occupancy <= 0) errs[`rt_base_${i}`] = "required";
                if (!r.max_occupancy || +r.max_occupancy < +r.base_occupancy) errs[`rt_max_${i}`] = "invalid";
            });
            // Optional: warn if no inventory, but allow
        }
        setFieldErrors(errs);
        return Object.values(errs)[0] || null;
    };

    const handleNext = () => { const e = validateStep(); if (e) { setError(e); return; } setError(""); setFieldErrors({}); animateStep(Math.min(step + 1, STEPS.length - 1)); };
    const handleBack = () => { setError(""); setFieldErrors({}); animateStep(Math.max(step - 1, 0)); };

    /* ── Persistent Save & Continue ── */
    const handleSaveAndContinue = async () => {
        const e = validateStep();
        if (e) { setError(e); return; }
        setError("");
        setFieldErrors({});
        setSaving(true);

        try {
            if (step === 0) {
                const payload = {
                    name: form.name.trim(), slug: form.slug.trim(), description: form.description.trim() || null,
                    phone: form.phone.trim(), email: form.email.trim(), address: form.address.trim() || null,
                    city: form.city.trim() || null, state: form.state.trim() || null, country: form.country.trim() || null,
                    postal_code: form.postal_code.trim() || null,
                    latitude: form.latitude ? +form.latitude : null, longitude: form.longitude ? +form.longitude : null,
                    legal_name: form.legal_name.trim() || null, gst_number: form.gst_number.trim() || null,
                    logo_path: form.logo_url.trim() || null, cover_image_path: form.cover_image_url.trim() || null,
                    brand_color: form.brand_color || null
                };
                let currentHotelId = hotelId;
                if (currentHotelId) {
                    const { error } = await supabase.rpc('update_hotel_settings_onboarding', {
                        p_hotel_id: currentHotelId,
                        payload,
                        p_action: 'HOTEL_DETAILS_UPDATED'
                    });
                    if (error) {
                        if (error.message?.includes('Hotel not found')) {
                            currentHotelId = null;
                            setHotelId(null);
                        } else {
                            throw error;
                        }
                    }
                }

                if (!currentHotelId) {
                    const { data, error } = await supabase.rpc('create_hotel_onboarding', {
                        payload: { ...payload, owner_user_id: userId }
                    });
                    if (error) throw error;
                    currentHotelId = data;
                    setHotelId(data);
                }
                await supabase.rpc('mark_onboarding_step_complete', { p_hotel_id: currentHotelId, p_step: 'hotel_details' });
                animateStep(1);
            }
            else if (step === 1) {
                const payload = {
                    name: form.name.trim(), slug: form.slug.trim(),
                    default_checkin_time: form.default_checkin_time || "14:00", default_checkout_time: form.default_checkout_time || "11:00",
                    timezone: form.timezone, currency_code: form.currency_code,
                    tax_percentage: form.tax_percentage ? +form.tax_percentage : null,
                    service_charge_percentage: form.service_charge_percentage ? +form.service_charge_percentage : null,
                    invoice_prefix: form.invoice_prefix || null,
                    invoice_counter: form.starting_invoice ? parseInt(form.starting_invoice) : (form.invoice_counter ? parseInt(form.invoice_counter) : 1),
                    brand_color: form.brand_color || null, upi_id: form.upi_id.trim() || null,
                    booking_url: form.booking_url.trim() || null,
                    logo_path: form.logo_url.trim() || null, cover_image_path: form.cover_image_url.trim() || null,
                    amenities: form.amenities.length > 0 ? form.amenities : null,
                    legal_name: form.legal_name.trim() || null,
                    gst_number: form.gst_number.trim() || null,
                    early_checkin_allowed: form.early_checkin_allowed,
                    late_checkout_allowed: form.late_checkout_allowed,
                    wifi_ssid: form.wifi_ssid || null,
                    wifi_password: form.wifi_password || null,
                    breakfast_start: form.breakfast_start || "07:00",
                    breakfast_end: form.breakfast_end || "10:30",
                    guest_notes: form.guest_notes || null
                };
                let currentHotelId = hotelId;
                if (currentHotelId) {
                    const { error } = await supabase.rpc('update_hotel_settings_onboarding', { p_hotel_id: currentHotelId, payload, p_action: 'HOTEL_OPERATIONAL_UPDATED' });
                    if (error) throw error;
                } else {
                    const { data, error } = await supabase.rpc('create_hotel_onboarding', { payload });
                    if (error) throw error;
                    currentHotelId = data;
                    setHotelId(data);
                }
                await supabase.rpc('mark_onboarding_step_complete', { p_hotel_id: currentHotelId, p_step: 'operational_settings' });
                animateStep(2);
            }
            else if (step === 2) {
                if (!hotelId) throw new Error("Missing Hotel ID.");
                await supabase.from("rooms").delete().eq("hotel_id", hotelId);
                await supabase.from("room_types").delete().eq("hotel_id", hotelId);
                const rtIdMap: Record<string, string> = {};
                for (const rt of roomTypes.filter(r => r.name.trim())) {
                    const { data: insRt, error: rtErr } = await supabase.from("room_types").insert({ hotel_id: hotelId, name: rt.name.trim(), base_occupancy: parseInt(rt.base_occupancy) || 2, max_occupancy: parseInt(rt.max_occupancy) || 2 }).select("id").single();
                    if (!rtErr && insRt) { rtIdMap[rt.id] = insRt.id; }
                }
                if (inventory.length > 0) {
                    const roomPayload = inventory.map(r => ({ hotel_id: hotelId, number: r.number, floor: r.floor || "1", wing: r.wing || null, room_type_id: rtIdMap[r.room_type_id] || Object.values(rtIdMap)[0], status: r.status === 'Out of Order' ? 'out_of_order' : r.status.toLowerCase(), housekeeping_status: r.status === 'Dirty' ? 'dirty' : 'clean', is_out_of_order: r.status === 'Out of Order' || !r.active }));
                    const { error: roomsErr } = await supabase.from("rooms").insert(roomPayload);
                    if (roomsErr) console.error(roomsErr);
                }
                const { error, data } = await supabase.rpc('update_hotel_settings_onboarding', { p_hotel_id: hotelId, payload: { rooms_total: inventory.length }, p_action: 'HOTEL_ROOMS_UPDATED' });
                if (error) throw error;
                await supabase.rpc('mark_onboarding_step_complete', { p_hotel_id: hotelId, p_step: 'room_setup' });
                animateStep(3);
            }
            else if (step === 3) {
                await supabase.from("hotel_roles").delete().eq("hotel_id", hotelId);
                const roleIdMap: Record<string, string> = {};
                if (rolePerms.length > 0) {
                    const hsRoles = rolePerms.map(rp => ({ hotel_id: hotelId, code: (rp.roleLabel || "ROLE").toUpperCase().replace(/\s/g, '_').substring(0, 20), name: rp.roleLabel || "Unnamed Role", description: rp.contact || '', is_active: true }));
                    const { data: insertedRoles, error: roleErr } = await supabase.from("hotel_roles").insert(hsRoles).select('id, name');
                    if (roleErr) console.error(roleErr);
                    if (insertedRoles) insertedRoles.forEach(r => { roleIdMap[r.name] = r.id; });
                }
                await supabase.from("hotel_invites").delete().eq("hotel_id", hotelId);
                const validStaff = staffMembers.filter(s => s.email.trim() && roleIdMap[s.role]);
                if (validStaff.length > 0) {
                    for (const s of validStaff) {
                        const { error: invErr } = await supabase.rpc('create_hotel_invite', {
                            p_hotel_id: hotelId,
                            p_email: s.email.trim(),
                            p_role_id: roleIdMap[s.role],
                            p_metadata: {
                                assigned_zones: s.assignedZones || null,
                                employment_status: s.employmentStatus || null
                            }
                        });
                        if (invErr) console.error(`Error creating invite for ${s.email}:`, invErr);
                    }
                }
                await supabase.rpc('mark_onboarding_step_complete', { p_hotel_id: hotelId, p_step: 'staff_setup' });
                animateStep(4);
            }
            else if (step === 4) {
                if (!hotelId) throw new Error("Missing Hotel ID.");
                await supabase.rpc('mark_onboarding_step_complete', { p_hotel_id: hotelId, p_step: 'features' });

                // Final Enterprise Activation
                const { error: activateErr } = await supabase.rpc('activate_hotel', { p_hotel_id: hotelId });
                if (activateErr) throw activateErr;

                setSuccess(true);
                ["vaiyu_ob_step", "vaiyu_ob_form", "vaiyu_ob_roomTypes", "vaiyu_ob_inventory", "vaiyu_ob_staff", "vaiyu_ob_roles", "vaiyu_ob_features", "vaiyu_ob_hotel_id"].forEach(k => window.localStorage.removeItem(k));
                setTimeout(() => navigate(`/owner/${form.slug}`), 3000);
            }
        } catch (err: any) {
            setError(err.message || "Failed to save step data");
            console.error("Save error:", err);
        } finally {
            setSaving(false);
        }
    };

    const progress = ((step + 1) / STEPS.length) * 100;

    /* ── Shared Styles ── */
    const inputCls = `
        w-full bg-slate-800/60 border border-slate-600/40 rounded-xl px-4 py-3 text-sm text-white
        placeholder-slate-500 outline-none transition-all duration-200
        focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:bg-slate-800/80
        hover:border-slate-500
    `.replace(/\s+/g, " ").trim();
    const selectCls = `${inputCls} cursor-pointer appearance-none`;
    const labelCls = "block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5";
    const errCls = "text-[11px] text-rose-400 mt-1 font-medium";
    const fI = (k: string) => `${inputCls} ${fieldErrors[k] ? "!border-rose-500 !ring-2 !ring-rose-500/20" : ""}`;

    /* ═══════════════ SUCCESS ═══════════════ */
    if (success) {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
                <div className="text-center space-y-6 animate-[fadeUp_0.6s_ease-out]">
                    <div className="relative mx-auto w-24 h-24">
                        <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping" />
                        <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-xl shadow-emerald-500/30">
                            <Check className="w-12 h-12 text-white" strokeWidth={3} />
                        </div>
                    </div>
                    <h1 className="text-4xl font-extrabold text-white tracking-tight">You're all set! 🎉</h1>
                    <p className="text-slate-400 text-lg"><span className="text-indigo-400 font-bold">{form.name}</span> is now live.</p>
                    <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
                        <Loader2 size={14} className="animate-spin" /> Redirecting…
                    </div>
                </div>
                <style>{`@keyframes fadeUp { from { opacity:0; transform:translateY(24px); } to { opacity:1; transform:translateY(0); } }`}</style>
            </div>
        );
    }

    /* ═══════════════ LAYOUT ═══════════════ */
    return (
        <div className="min-h-screen bg-slate-950 text-white">
            {/* Top glow bar */}
            <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-slate-800">
                <div className="h-full bg-gradient-to-r from-indigo-500 via-violet-500 to-emerald-400 transition-all duration-700 ease-out rounded-r-full shadow-[0_0_16px_rgba(99,102,241,0.5)]" style={{ width: `${progress}%` }} />
            </div>

            <div className="max-w-[1440px] mx-auto flex flex-col lg:flex-row min-h-screen">
                {/* ═══════════ SIDEBAR ═══════════ */}
                <aside className="lg:w-52 shrink-0 px-4 py-6 lg:py-10 lg:border-r border-slate-800/60">
                    <div className="flex items-center gap-3 mb-10 px-2">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                            <span className="text-white font-extrabold text-sm">V</span>
                        </div>
                        <span className="font-bold text-lg text-white tracking-tight">vaiyu</span>
                    </div>

                    <nav className="space-y-1">
                        {STEPS.map((s, i) => {
                            const done = i < step;
                            const active = i === step;
                            const Icon = s.icon;
                            return (
                                <button
                                    key={s.key}
                                    onClick={() => { if (done) { setError(""); setFieldErrors({}); animateStep(i); } }}
                                    disabled={i > step}
                                    className={`
                                        w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-sm font-medium transition-all duration-200
                                        ${active
                                            ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/30"
                                            : done
                                                ? "text-emerald-400 hover:bg-emerald-500/5 cursor-pointer"
                                                : "text-slate-600 cursor-default"
                                        }
                                    `}
                                >
                                    <div className={`
                                        w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all
                                        ${done ? "bg-emerald-500/20 text-emerald-400" : active ? "bg-indigo-500/20 text-indigo-400" : "bg-slate-800 text-slate-600"}
                                    `}>
                                        {done ? <Check size={13} strokeWidth={3} /> : <Icon size={13} />}
                                    </div>
                                    <span>{s.label}</span>
                                </button>
                            );
                        })}
                    </nav>

                    {/* Setup Progress */}
                    <div className="mt-auto pt-10 px-2 pb-2">
                        <div className="mb-4">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Setup Progress</h4>
                            <div className="flex items-center gap-3">
                                <div className="h-2 flex-1 bg-slate-800 rounded-full overflow-hidden">
                                    <div className="h-full bg-emerald-500 transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
                                </div>
                                <span className="text-emerald-400 text-xs font-bold">{Math.round(progress)}%</span>
                            </div>
                        </div>
                        <button
                            className="w-full flex items-center justify-between px-4 py-3 bg-emerald-500 hover:bg-emerald-400 text-white font-bold rounded-xl shadow-lg shadow-emerald-500/20 transition-all group disabled:opacity-60 disabled:cursor-not-allowed"
                            onClick={() => { if (step < STEPS.length - 1) handleSaveAndContinue(); }}
                            disabled={saving}
                        >
                            <span>{saving ? 'Saving...' : 'Save & Continue'}</span>
                            {saving ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />}
                        </button>
                        <p className="text-center text-[10px] text-slate-500 font-semibold mt-3">
                            Step {step + 1} of {STEPS.length}
                        </p>
                    </div>
                </aside>

                {/* ═══════════ MAIN W/ HEADER ═══════════ */}
                <div className="flex-1 flex flex-col min-w-0">

                    {/* GLOBAL APP SHELL HEADER */}
                    <header className="h-16 shrink-0 border-b border-slate-800/60 flex items-center justify-between px-5 sm:px-6 lg:px-8 bg-slate-950/50 backdrop-blur-md sticky top-0 z-40">
                        {/* Left Side: Context Title */}
                        <div className="flex items-center gap-3">
                            <h2 className="text-sm font-semibold text-slate-300 tracking-wide">Hotel Room Setup <span className="text-slate-500 font-normal">— Enterprise Edition</span></h2>
                        </div>

                        {/* Right Side: Global Controls */}
                        <div className="flex items-center gap-3 md:gap-4">
                            {/* Hotel Selector */}
                            <div className="relative group">
                                <button
                                    onClick={() => {
                                        const nextState = !isHeaderSelectorOpen;
                                        setIsHeaderSelectorOpen(nextState);
                                        if (nextState) {
                                            setHeaderSearchQuery("");
                                            searchHotels(""); // Show initial properties
                                        }
                                    }}
                                    className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-700/50 bg-slate-800/30 hover:bg-slate-800/60 transition text-sm group-hover:border-slate-500/50"
                                >
                                    <MapPin size={14} className="text-slate-400 group-hover:text-indigo-400 transition-colors" />
                                    <span className="text-slate-400 font-medium whitespace-nowrap">Hotel: <span className="text-white font-bold ml-1 transition-all truncate max-w-[120px] inline-block align-bottom">{form.name || "Untitled Property"}</span></span>
                                    <ChevronDown size={14} className={`text-slate-500 ml-1 transition-transform duration-200 ${isHeaderSelectorOpen ? 'rotate-180' : ''}`} />
                                </button>

                                {isHeaderSelectorOpen && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => setIsHeaderSelectorOpen(false)} />
                                        <div className="absolute top-[calc(100%+12px)] right-0 w-80 bg-slate-950 border border-slate-700/80 rounded-2xl shadow-[0_30px_60px_rgba(0,0,0,0.9)] z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300 ring-1 ring-white/10">
                                            {/* Search Input */}
                                            <div className="p-4 border-b border-slate-800/80 bg-slate-900/50">
                                                <div className="relative">
                                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                                    <input
                                                        autoFocus
                                                        className="w-full bg-slate-950/50 border border-slate-700/50 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 transition-all"
                                                        placeholder="Type to search properties..."
                                                        value={headerSearchQuery}
                                                        onChange={(e) => {
                                                            setHeaderSearchQuery(e.target.value);
                                                            searchHotels(e.target.value);
                                                        }}
                                                    />
                                                </div>
                                            </div>

                                            {/* Results */}
                                            <div className="max-h-[360px] overflow-y-auto custom-scrollbar bg-slate-950/20">
                                                {isHotelSearching ? (
                                                    <div className="p-10 flex flex-col items-center justify-center gap-3">
                                                        <Loader2 size={24} className="text-indigo-500 animate-spin" />
                                                        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Searching database...</span>
                                                    </div>
                                                ) : hotelSuggestions.length > 0 ? (
                                                    <div className="p-2 space-y-1">
                                                        <div className="px-3 py-2">
                                                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Global Properties</span>
                                                        </div>
                                                        {hotelSuggestions.map((h) => (
                                                            <button
                                                                key={h.id}
                                                                onClick={() => {
                                                                    autoPopulateForm(h);
                                                                    setIsHeaderSelectorOpen(false);
                                                                }}
                                                                className={`w-full text-left px-4 py-3 rounded-xl transition-all group flex items-start justify-between ${hotelId === h.id ? 'bg-indigo-500/10' : 'hover:bg-slate-800/60'}`}
                                                            >
                                                                <div className="min-w-0 pr-3">
                                                                    <div className={`font-bold text-sm truncate ${hotelId === h.id ? 'text-indigo-300' : 'text-slate-200 group-hover:text-white'}`}>{h.name}</div>
                                                                    <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-1 truncate">
                                                                        <MapPin size={10} />
                                                                        {h.city || 'Global'}, {h.state || ''}
                                                                    </div>
                                                                </div>
                                                                {hotelId === h.id && (
                                                                    <div className="w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/30 shrink-0">
                                                                        <Check size={12} className="text-white" />
                                                                    </div>
                                                                )}
                                                            </button>
                                                        ))}
                                                    </div>
                                                ) : headerSearchQuery.length >= 1 ? (
                                                    <div className="p-8 text-center space-y-3">
                                                        <div className="w-10 h-10 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto">
                                                            <Plus size={16} className="text-slate-600" />
                                                        </div>
                                                        <div>
                                                            <p className="text-white text-xs font-bold italic truncate px-4">"{headerSearchQuery}"</p>
                                                            <p className="text-[10px] text-slate-600 mt-1 uppercase tracking-tight">Not found in system</p>
                                                        </div>
                                                        <button
                                                            onClick={() => {
                                                                handleNameChange(headerSearchQuery);
                                                                setStep(0);
                                                                setIsHeaderSelectorOpen(false);
                                                            }}
                                                            className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 transition-colors uppercase tracking-widest"
                                                        >
                                                            Create as New Property
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="p-10 text-center space-y-2 opacity-60">
                                                        <Search size={20} className="text-slate-700 mx-auto mb-2" />
                                                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest leading-relaxed">Type to search<br />properties</p>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Footer Actions */}
                                            {hotelId && (
                                                <div className="p-3 bg-slate-950/60 border-t border-slate-800/80 flex items-center justify-center">
                                                    <button
                                                        onClick={() => {
                                                            setHotelId(null);
                                                            setForm(p => ({ ...p, name: "" }));
                                                            setIsHeaderSelectorOpen(false);
                                                            setStep(0);
                                                        }}
                                                        className="text-[10px] font-bold text-rose-400 hover:text-rose-300 transition-colors uppercase tracking-widest"
                                                    >
                                                        Clear Selection
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>

                            <div className="hidden sm:block w-px h-6 bg-slate-800 shrink-0" />

                            {/* Notifications */}
                            <button className="relative p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/50 transition">
                                <Bell size={18} />
                                <span className="absolute top-1 right-1 flex h-3.5 w-3.5 items-center justify-center bg-rose-500 border-2 border-slate-950 rounded-full text-[8px] font-bold text-white leading-none">
                                    3
                                </span>
                            </button>

                            {/* Settings */}
                            <button className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/50 transition hidden sm:block">
                                <Settings2 size={18} />
                            </button>

                            {/* Help */}
                            <button className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/50 transition hidden sm:block">
                                <HelpCircle size={18} />
                            </button>

                            {/* Profile Dropdown */}
                            <button className="flex items-center gap-2 pl-2 pr-1.5 py-1.5 sm:ml-2 rounded-full border border-slate-700/50 bg-slate-800/30 hover:bg-slate-800/60 transition max-w-[140px]">
                                <div className="w-6 h-6 rounded-full bg-slate-700 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                                    {userInitials}
                                </div>
                                <span className="text-xs font-semibold text-slate-300 truncate hidden sm:block">{userEmail}</span>
                                <ChevronDown size={14} className="text-slate-500 shrink-0" />
                            </button>
                        </div>
                    </header>

                    {/* MAIN SCROLLABLE CONTENT */}
                    <main className="flex-1 px-5 sm:px-6 lg:px-8 py-6 lg:py-10 overflow-y-auto">
                        <div className={`max-w-6xl mx-auto transition-all duration-180 ${transitioning ? "opacity-0 translate-y-2" : "opacity-100 translate-y-0"}`}>

                            {/* Step Header */}
                            <div className="flex items-end justify-between mb-8 pb-6 border-b border-slate-800/40">
                                <div className="flex items-start gap-4">
                                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-violet-500/10 flex items-center justify-center border border-indigo-500/20">
                                        {React.createElement(STEPS[step].icon, { size: 22, className: "text-indigo-400" })}
                                    </div>
                                    <div>
                                        <h1 className="text-2xl font-bold text-white">{STEPS[step].label}</h1>
                                        <p className="text-slate-500 text-sm mt-0.5">{STEPS[step].desc}</p>
                                    </div>
                                </div>
                                <span className="text-sm text-slate-600 font-mono">Step {step + 1} / {STEPS.length}</span>
                            </div>

                            {/* Error */}
                            {error && (
                                <div className="mb-6 px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2">
                                    <X size={14} /> {error}
                                </div>
                            )}

                            {/* ═══════════════════════════════════════════ */}
                            {/*  STEP 0: Hotel Details                     */}
                            {/* ═══════════════════════════════════════════ */}
                            {step === 0 && (
                                <div className="space-y-8">
                                    {/* Property Info */}
                                    <Section emoji="🏨" title="Property Info">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div className="sm:col-span-2 relative">
                                                <label className={labelCls}>Hotel Name <span className="text-rose-400">*</span></label>
                                                <div className="relative group">
                                                    <input
                                                        className={`${fI("name")} pr-10`}
                                                        value={form.name}
                                                        onChange={e => handleNameChange(e.target.value)}
                                                        onFocus={() => setShowSuggestions(true)}
                                                        placeholder="e.g. Grand Palace Hotel"
                                                        maxLength={100}
                                                    />
                                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                                                        {isHotelSearching ? (
                                                            <Loader2 size={16} className="text-indigo-400 animate-spin" />
                                                        ) : (
                                                            <div className={`w-2 h-2 rounded-full ${hotelId ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-slate-600'}`} title={hotelId ? "Existing Property Selected" : "New Property"} />
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Suggestions Dropdown */}
                                                {showSuggestions && (hotelSuggestions.length > 0 || isHotelSearching) && (
                                                    <>
                                                        <div
                                                            className="fixed inset-0 z-10"
                                                            onClick={() => setShowSuggestions(false)}
                                                        />
                                                        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-20 bg-slate-900/98 backdrop-blur-2xl border border-slate-700/60 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300 ring-1 ring-white/5">
                                                            <div className="p-3 bg-slate-900/50 border-b border-slate-800/80 flex items-center justify-between">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                                                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] px-1">Nearby Matches</span>
                                                                </div>
                                                                {hotelId && (
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); setHotelId(null); setShowSuggestions(false); }}
                                                                        className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 px-3 py-1 rounded-full bg-indigo-500/5 border border-indigo-500/10 transition-all uppercase tracking-widest"
                                                                    >
                                                                        Reset to New
                                                                    </button>
                                                                )}
                                                            </div>
                                                            <div className="max-h-[320px] overflow-y-auto custom-scrollbar">
                                                                {hotelSuggestions.map((h) => (
                                                                    <button
                                                                        key={h.id}
                                                                        onClick={() => autoPopulateForm(h)}
                                                                        className={`w-full text-left px-5 py-4 transition-all group flex items-start justify-between border-b border-slate-800/40 last:border-none ${hotelId === h.id ? 'bg-indigo-500/10' : 'hover:bg-slate-800/40'}`}
                                                                    >
                                                                        <div className="min-w-0 pr-4">
                                                                            <div className={`font-bold text-sm transition-colors truncate ${hotelId === h.id ? 'text-indigo-300' : 'text-white group-hover:text-indigo-300'}`}>{h.name}</div>
                                                                            <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-1 font-medium italic">
                                                                                <MapPin size={10} className="text-slate-600" />
                                                                                {h.city || 'Location Unknown'}, {h.state || ''}
                                                                            </div>
                                                                        </div>
                                                                        <div className="shrink-0 flex flex-col items-end gap-1.5">
                                                                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-md uppercase tracking-tight ${hotelId === h.id ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}>
                                                                                {hotelId === h.id ? 'Selected' : 'Existing'}
                                                                            </span>
                                                                            <span className="text-[9px] font-mono text-slate-600 tracking-tighter">{h.slug}</span>
                                                                        </div>
                                                                    </button>
                                                                ))}
                                                                {hotelSuggestions.length === 0 && isHotelSearching && (
                                                                    <div className="px-4 py-8 text-center text-slate-500 text-xs italic">
                                                                        Searching for properties...
                                                                    </div>
                                                                )}
                                                                {!isHotelSearching && hotelSuggestions.length === 0 && (
                                                                    <div className="px-4 py-8 text-center space-y-2">
                                                                        <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-3">
                                                                            <Plus size={14} className="text-slate-500" />
                                                                        </div>
                                                                        <p className="text-white text-xs font-bold leading-relaxed">No existing property found</p>
                                                                        <p className="text-[10px] text-slate-500 leading-relaxed px-6">
                                                                            Continue typing to create "<span className="text-indigo-400">{form.name}</span>" as a new property.
                                                                        </p>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <div className="p-3 bg-slate-950/40 border-t border-slate-800/50">
                                                                <p className="text-[10px] text-slate-500 leading-relaxed italic">
                                                                    Selecting an existing property will automatically populate its details into this form.
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </>
                                                )}
                                                {fieldErrors.name && <p className={errCls}>{fieldErrors.name}</p>}
                                            </div>
                                            <div>
                                                <label className={labelCls}>URL Slug</label>
                                                <div className="flex items-center bg-slate-800/60 border border-slate-600/40 rounded-xl overflow-hidden focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all">
                                                    <span className="px-3 text-xs text-slate-500 border-r border-slate-700 whitespace-nowrap">vaiyu.co.in/</span>
                                                    <input className="flex-1 bg-transparent px-3 py-3 text-sm text-white outline-none" value={form.slug} onChange={e => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} maxLength={40} />
                                                </div>
                                            </div>
                                            <div>
                                                <label className={labelCls}>Description</label>
                                                <input className={inputCls} value={form.description} onChange={e => set("description", e.target.value)} placeholder="Brief tagline" maxLength={200} />
                                            </div>
                                            <div>
                                                <label className={labelCls}>Hotel Email <span className="text-rose-400">*</span></label>
                                                <input type="email" className={fI("email")} value={form.email} onChange={e => set("email", e.target.value)} placeholder="info@hotel.com" />
                                                {fieldErrors.email && <p className={errCls}>{fieldErrors.email}</p>}
                                            </div>
                                            <div>
                                                <label className={labelCls}>Hotel Phone <span className="text-rose-400">*</span></label>
                                                <input type="tel" className={fI("phone")} value={form.phone} onChange={e => set("phone", PHONE_CLEAN(e.target.value))} placeholder="+91 98765 43210" maxLength={16} />
                                                {fieldErrors.phone && <p className={errCls}>{fieldErrors.phone}</p>}
                                            </div>
                                        </div>
                                    </Section>

                                    {/* Location */}
                                    <Section emoji="📍" title="Location">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div className="sm:col-span-2">
                                                <label className={labelCls}>Full Address</label>
                                                <input className={inputCls} value={form.address} onChange={e => set("address", e.target.value)} placeholder="123 Main Street, Near Landmark" />
                                            </div>
                                            <div>
                                                <label className={labelCls}>City</label>
                                                <input className={inputCls} value={form.city} onChange={e => set("city", e.target.value)} placeholder="Mumbai" />
                                            </div>
                                            <div>
                                                <label className={labelCls}>State</label>
                                                <input className={inputCls} value={form.state} onChange={e => set("state", e.target.value)} placeholder="Maharashtra" />
                                            </div>
                                            <div>
                                                <label className={labelCls}>Country</label>
                                                <input className={inputCls} value={form.country} onChange={e => set("country", e.target.value)} placeholder="India" />
                                            </div>
                                            <div>
                                                <label className={labelCls}>Postal Code</label>
                                                <input className={inputCls} value={form.postal_code} onChange={e => set("postal_code", e.target.value.replace(/[^0-9]/g, ""))} placeholder="400001" maxLength={10} />
                                            </div>
                                        </div>
                                    </Section>

                                </div>
                            )}

                            {/* ═══════════════════════════════════════════ */}
                            {/*  STEP 1: Operational Settings               */}
                            {/* ═══════════════════════════════════════════ */}
                            {step === 1 && (
                                <div className="space-y-8">
                                    {/* Legal */}
                                    <Section emoji="📜" title="Legal Details">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className={labelCls}>Legal / Registered Name</label>
                                                <input className={inputCls} value={form.legal_name} onChange={e => set("legal_name", e.target.value)} placeholder="Hotel Grand Palace Pvt Ltd" />
                                            </div>
                                            <div>
                                                <label className={labelCls}>GST Number</label>
                                                <input className={fI("gst_number")} value={form.gst_number} onChange={e => set("gst_number", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="27AADCH1234P1ZR" maxLength={15} />
                                                {fieldErrors.gst_number && <p className={errCls}>{fieldErrors.gst_number}</p>}
                                            </div>
                                        </div>
                                    </Section>

                                    {/* Operations */}
                                    <Section emoji="🕐" title="Operations">
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                            <div>
                                                <label className={labelCls}>Check-In Time</label>
                                                <input type="time" className={inputCls} value={form.default_checkin_time} onChange={e => set("default_checkin_time", e.target.value)} />
                                            </div>
                                            <div>
                                                <label className={labelCls}>Check-Out Time</label>
                                                <input type="time" className={inputCls} value={form.default_checkout_time} onChange={e => set("default_checkout_time", e.target.value)} />
                                            </div>
                                            <div>
                                                <label className={labelCls}>Early Check-in?</label>
                                                <DarkToggle active={form.early_checkin_allowed} onClick={() => set("early_checkin_allowed", !form.early_checkin_allowed)} />
                                            </div>
                                            <div>
                                                <label className={labelCls}>Late Check-out?</label>
                                                <DarkToggle active={form.late_checkout_allowed} onClick={() => set("late_checkout_allowed", !form.late_checkout_allowed)} />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4 mt-4">
                                            <div>
                                                <label className={labelCls}>Timezone</label>
                                                <select className={selectCls} value={form.timezone} onChange={e => set("timezone", e.target.value)}>
                                                    {TZ_OPTIONS.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label className={labelCls}>Currency</label>
                                                <select className={selectCls} value={form.currency_code} onChange={e => set("currency_code", e.target.value)}>
                                                    {CUR_OPTIONS.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                    </Section>

                                    {/* Tax */}
                                    <Section emoji="💰" title="Tax & Service Charge">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className={labelCls}>Tax Percentage</label>
                                                <div className="relative">
                                                    <input className={fI("tax_percentage")} value={form.tax_percentage} onChange={e => set("tax_percentage", e.target.value.replace(/[^0-9.]/g, ""))} placeholder="12" />
                                                    <span className="absolute right-4 top-3 text-sm text-slate-500">%</span>
                                                </div>
                                                {fieldErrors.tax_percentage && <p className={errCls}>{fieldErrors.tax_percentage}</p>}
                                            </div>
                                            <div>
                                                <label className={labelCls}>Service Charge</label>
                                                <div className="relative">
                                                    <input className={fI("service_charge_percentage")} value={form.service_charge_percentage} onChange={e => set("service_charge_percentage", e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" />
                                                    <span className="absolute right-4 top-3 text-sm text-slate-500">%</span>
                                                </div>
                                            </div>
                                        </div>
                                    </Section>

                                    {/* Invoice */}
                                    <Section emoji="🧾" title="Invoice Settings">
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                            <div>
                                                <label className={labelCls}>Invoice Prefix</label>
                                                <input className={inputCls + " font-mono"} value={form.invoice_prefix} onChange={e => set("invoice_prefix", e.target.value.toUpperCase())} placeholder="VYH-DEL-" />
                                            </div>
                                            <div>
                                                <label className={labelCls}>Invoice Counter</label>
                                                <input type="number" min="1" className={inputCls} value={form.invoice_counter} onChange={e => set("invoice_counter", e.target.value)} placeholder="1" />
                                            </div>
                                            <div>
                                                <label className={labelCls}>Starting Invoice #</label>
                                                <input className={inputCls + " font-mono"} value={form.starting_invoice} onChange={e => set("starting_invoice", e.target.value)} placeholder="996111" />
                                            </div>
                                        </div>
                                    </Section>

                                    {/* Guest Amenities / Information */}
                                    <Section emoji="📶" title="Guest Amenities / Information">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                            {/* Wi-Fi Settings */}
                                            <div className="space-y-4">
                                                <h4 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">Wi-Fi Access</h4>
                                                <div>
                                                    <label className={labelCls}>Wi-Fi Network (SSID)</label>
                                                    <input className={inputCls} value={form.wifi_ssid || ""} onChange={e => set("wifi_ssid", e.target.value)} placeholder="Vaiyu_Guest" />
                                                </div>
                                                <div>
                                                    <label className={labelCls}>Wi-Fi Password</label>
                                                    <input className={inputCls} value={form.wifi_password || ""} onChange={e => set("wifi_password", e.target.value)} placeholder="welcome123" />
                                                </div>
                                            </div>

                                            {/* Breakfast Timings */}
                                            <div className="space-y-4">
                                                <h4 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">Breakfast Timings</h4>
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <label className={labelCls}>Start Time</label>
                                                        <input type="time" className={inputCls} value={form.breakfast_start || "07:00"} onChange={e => set("breakfast_start", e.target.value)} />
                                                    </div>
                                                    <div>
                                                        <label className={labelCls}>End Time</label>
                                                        <input type="time" className={inputCls} value={form.breakfast_end || "10:30"} onChange={e => set("breakfast_end", e.target.value)} />
                                                    </div>
                                                </div>
                                            </div>

                                            {/* General Guest Notes */}
                                            <div className="sm:col-span-2 mt-2">
                                                <label className={labelCls}>General Guest Notes / Instructions</label>
                                                <textarea className={`${inputCls} min-h-[100px] resize-y py-3 leading-relaxed`} value={form.guest_notes || ""} onChange={e => set("guest_notes", e.target.value)} placeholder="E.g. Pool rules, noise restrictions, or reception contact info..."></textarea>
                                            </div>
                                        </div>
                                    </Section>

                                    {/* Payment */}
                                    <Section emoji="💳" title="Payment">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className={labelCls}>UPI ID</label>
                                                <input className={inputCls} value={form.upi_id} onChange={e => set("upi_id", e.target.value)} placeholder="hotel@paytm" />
                                            </div>
                                            <div>
                                                <label className={labelCls}>Booking URL</label>
                                                <input className={inputCls} value={form.booking_url} onChange={e => set("booking_url", e.target.value)} placeholder="https://booking.hotel.com" />
                                            </div>
                                        </div>
                                    </Section>

                                    {/* Branding */}
                                    <Section emoji="🎨" title="Hotel Branding">
                                        <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-12 items-start">
                                            {/* Left: Brand Identity Context */}
                                            <div className="space-y-10">
                                                <ImageUpload
                                                    label="Brand Logo"
                                                    value={form.logo_url}
                                                    onChange={(url) => set("logo_url", url)}
                                                    aspectRatio="1:1"
                                                    helperText="512x512 Square"
                                                    pathPrefix={hotelId}
                                                    fileName="logo.png"
                                                />

                                                <div className="pt-6 border-t border-slate-800/40">
                                                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-4 block">Accent Color</label>
                                                    <div className="bg-slate-950/40 p-4 rounded-3xl border border-slate-700/30 shadow-inner group/color">
                                                        <div className="flex items-center gap-4">
                                                            <div className="relative shrink-0">
                                                                <input
                                                                    type="color"
                                                                    className="w-12 h-12 rounded-[18px] border-2 border-slate-700/50 cursor-pointer bg-slate-900 p-1 appearance-none hover:scale-110 hover:border-indigo-500/50 transition-all duration-300 shadow-xl"
                                                                    value={form.brand_color}
                                                                    onChange={e => set("brand_color", e.target.value)}
                                                                />
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-1.5 mb-1">
                                                                    <span className="text-[10px] font-mono text-indigo-400 font-bold uppercase">{form.brand_color}</span>
                                                                </div>
                                                                <input
                                                                    className="w-full bg-transparent border-none text-[12px] font-medium text-slate-300 outline-none placeholder:text-slate-600 truncate"
                                                                    value={form.brand_color.replace('#', '')}
                                                                    onChange={e => set("brand_color", `#${e.target.value.replace(/[^0-9A-Fa-f]/g, '').substring(0, 6)}`)}
                                                                    placeholder="HEX CODE"
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Right: Visionary Banner Preview */}
                                            <div className="space-y-8 h-full flex flex-col">
                                                <ImageUpload
                                                    label="Cover Banner"
                                                    value={form.cover_image_url}
                                                    onChange={(url) => set("cover_image_url", url)}
                                                    aspectRatio="16:9"
                                                    helperText="1920x1080 (HD)"
                                                    pathPrefix={hotelId}
                                                    fileName="cover.png"
                                                />

                                                <div className="mt-auto p-6 rounded-[32px] bg-slate-800/20 border border-slate-700/30 flex-1 flex flex-col justify-center">
                                                    <h4 className="text-white text-sm font-bold mb-2 flex items-center gap-2">
                                                        <Sparkles size={16} className="text-indigo-400" />
                                                        Brand Intelligence
                                                    </h4>
                                                    <p className="text-[11px] text-slate-400 font-medium leading-[1.8] pr-4">
                                                        Your branding assets are used to generate a unique visual DNA. This includes guest-facing booking interfaces, invoice themes, and staff dashboard accents designed to maintain a consistent luxury identity across all touchpoints.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </Section>

                                    {/* Amenities */}
                                    <Section emoji="⭐" title="Amenities">
                                        <div className="flex flex-wrap gap-2">
                                            {AMENITY_LIST.map(a => (
                                                <button
                                                    key={a}
                                                    type="button"
                                                    onClick={() => toggleAmenity(a)}
                                                    className={`
                                                px-3.5 py-2 rounded-xl text-sm font-medium border transition-all duration-200
                                                ${form.amenities.includes(a)
                                                            ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-300"
                                                            : "bg-slate-800/40 border-slate-700/40 text-slate-400 hover:border-slate-600 hover:text-slate-300"
                                                        }
                                             `}
                                                >
                                                    {a}
                                                </button>
                                            ))}
                                        </div>
                                    </Section>
                                </div>
                            )}

                            {/* ═══════════════════════════════════════════ */}
                            {/*  STEP 2: Room Setup                        */}
                            {/* ═══════════════════════════════════════════ */}
                            {step === 2 && (
                                <div className="space-y-5">
                                    <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-12 gap-4">

                                        {/* ─── Column A: Room Types ─── */}
                                        <div className="xl:col-span-3 space-y-3">
                                            <div className="flex items-center gap-2">
                                                <div className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-xs">A</div>
                                                <h3 className="font-bold text-white text-sm">Room Types</h3>
                                            </div>
                                            <div className="rounded-2xl bg-slate-800/40 border border-slate-700/50 overflow-hidden">
                                                <button type="button" onClick={() => setIsAddRoomModalOpen(true)} className="w-full flex items-center justify-center gap-2 text-xs font-semibold text-indigo-400 border-b border-slate-700/50 py-2.5 hover:bg-indigo-500/10 transition cursor-pointer">
                                                    <Plus size={14} /> Add Room Type
                                                </button>
                                                {/* Table Header */}
                                                <div className="grid grid-cols-[1fr_40px_40px_40px_48px] gap-0.5 px-2.5 py-1.5 bg-slate-800/80 border-b border-slate-700/50">
                                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Type Name</span>
                                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider text-center">Base</span>
                                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider text-center">Max</span>
                                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider text-center">Active</span>
                                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider text-center">Actions</span>
                                                </div>
                                                {/* Room Type Rows */}
                                                <div className="divide-y divide-slate-800/60">
                                                    {roomTypes.map((rt, i) => (
                                                        <div key={rt.id} className="grid grid-cols-[1fr_40px_40px_40px_48px] gap-0.5 px-2.5 py-1.5 items-center hover:bg-slate-800/30 transition group">
                                                            <span className={`text-sm font-semibold truncate ${rt.name ? "text-white" : "text-slate-600 italic"}`}>{rt.name || "Unnamed"}</span>
                                                            <span className="text-sm text-slate-300 text-center font-mono">{rt.base_occupancy}</span>
                                                            <span className="text-sm text-slate-300 text-center font-mono">{rt.max_occupancy}</span>
                                                            <div className="flex justify-center">
                                                                <SwitchToggle active={rt.active} onClick={() => updateRoomType(i, "active", !rt.active)} />
                                                            </div>
                                                            <div className="flex items-center justify-center gap-1">
                                                                <button type="button" onClick={() => setEditingRoomTypeIdx(i)} className="p-1 rounded text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10 transition cursor-pointer" title="Edit">
                                                                    <Pencil size={13} />
                                                                </button>
                                                                <button type="button" onClick={() => removeRoomType(i)} className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer" title="Delete">
                                                                    <Trash2 size={13} />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                                {/* Footer */}
                                                <div className="flex justify-between px-3 py-2 bg-slate-800/50 border-t border-slate-700/50">
                                                    <span className="text-xs font-semibold text-slate-500">Total Types: <span className="text-white">{roomTypes.length}</span></span>
                                                    <span className="text-xs font-semibold text-emerald-400">Active: {roomTypes.filter(r => r.active).length}</span>
                                                </div>
                                            </div>
                                            {fieldErrors.rooms && <p className={errCls}>{fieldErrors.rooms}</p>}
                                        </div>

                                        {/* ─── Column B: Add Rooms (Bulk + Range Parser) ─── */}
                                        <div className="xl:col-span-4 space-y-3">
                                            <div className="flex items-center gap-2">
                                                <div className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-xs">B</div>
                                                <h3 className="font-bold text-white text-sm">Add Rooms <span className="text-slate-500 text-xs font-normal">(Bulk + Range Parser)</span></h3>
                                            </div>
                                            <div className="p-4 rounded-2xl bg-slate-800/40 border border-slate-700/50 space-y-4">
                                                {/* Room Type Select */}
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-400 mb-1">Room Type<span className="text-rose-400">*</span></label>
                                                    <select className={selectCls + ` !py-2 !text-sm ${fieldErrors.parserType ? "!border-rose-500" : ""}`} value={selectedRoomTypeId} onChange={e => setSelectedRoomTypeId(e.target.value)}>
                                                        <option value="" disabled>Select Type...</option>
                                                        {roomTypes.filter(rt => rt.name.trim()).map(rt => (<option key={rt.id} value={rt.id}>{rt.name}</option>))}
                                                    </select>
                                                </div>
                                                {/* Wing Select */}
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-400 mb-1">Wing (Optional)</label>
                                                    <select className={selectCls + " !py-2 !text-sm"} value={selectedWing} onChange={e => setSelectedWing(e.target.value)}>
                                                        <option value="">None</option>
                                                        <option value="A - Wing">A - Wing</option>
                                                        <option value="B - Wing">B - Wing</option>
                                                        <option value="C - Wing">C - Wing</option>
                                                        <option value="North Wing">North Wing</option>
                                                        <option value="South Wing">South Wing</option>
                                                    </select>
                                                </div>
                                                {/* Room Numbers — Tag/Chip Input */}
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-400 mb-1">Room Numbers<span className="text-rose-400">*</span></label>
                                                    <div className={`${inputCls} !py-2 !px-2 flex flex-wrap items-center gap-1.5 min-h-[44px] cursor-text`} onClick={() => document.getElementById('room-parse-input')?.focus()}>
                                                        {parseTags.map(tag => (
                                                            <span key={tag} className="inline-flex items-center gap-1 bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-xs font-bold px-2 py-0.5 rounded-lg">
                                                                {tag}
                                                                <button type="button" onClick={(e) => { e.stopPropagation(); removeParseTag(tag); }} className="hover:text-rose-400 cursor-pointer"><X size={12} /></button>
                                                            </span>
                                                        ))}
                                                        <input
                                                            id="room-parse-input"
                                                            className="bg-transparent border-none outline-none text-sm text-white placeholder-slate-600 flex-1 min-w-[80px] p-0"
                                                            value={parseInput}
                                                            onChange={e => {
                                                                const v = e.target.value;
                                                                if (v.endsWith(',') || v.endsWith(' ')) { addParseTag(v); } else { setParseInput(v); }
                                                            }}
                                                            onKeyDown={e => {
                                                                if (e.key === 'Enter') { e.preventDefault(); addParseTag(parseInput); }
                                                                if (e.key === 'Backspace' && !parseInput && parseTags.length > 0) { setParseTags(p => p.slice(0, -1)); }
                                                            }}
                                                            placeholder={parseTags.length === 0 ? "201-210, 301A, 101,103,105" : ""}
                                                        />
                                                    </div>
                                                    <div className="flex items-center justify-between mt-1.5">
                                                        <p className="text-[10px] text-slate-500 italic">Examples: 201-210, 301A, 101,103,105</p>
                                                        <button type="button" onClick={runParser} className="text-xs font-bold text-indigo-400 hover:text-indigo-300 cursor-pointer">Parse</button>
                                                    </div>
                                                </div>
                                                {/* Floor Detection */}
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs text-slate-400">Floor <span className="text-indigo-400 font-semibold">({autoDetectFloor ? `Auto-detected` : `Override: ${overrideFloorVal}`})</span></span>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[10px] text-slate-500 font-semibold">Override</span>
                                                        <SwitchToggle active={!autoDetectFloor} onClick={() => setAutoDetectFloor(!autoDetectFloor)} />
                                                        {!autoDetectFloor && (
                                                            <input className={inputCls + " !py-1 !px-2 !w-12 !text-xs !text-center"} value={overrideFloorVal} onChange={e => setOverrideFloorVal(e.target.value)} />
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Preview Section */}
                                                {previewRooms.length > 0 && (
                                                    <div className="space-y-3 animate-[fadeIn_0.3s_ease]">
                                                        <div className="flex justify-between items-center">
                                                            <span className="text-xs font-bold text-emerald-400">Preview ({previewRooms.length} Rooms)</span>
                                                            <button type="button" onClick={() => { setPreviewRooms([]); }} className="text-xs text-rose-400 hover:text-rose-300 font-semibold cursor-pointer">Clear All</button>
                                                        </div>
                                                        <div className="max-h-36 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-slate-600 pr-1">
                                                            {previewRooms.slice(0, 6).map(pr => {
                                                                const typeName = roomTypes.find(t => t.id === pr.room_type_id)?.name || "Unknown";
                                                                const isDup = duplicateRoomNumbers.includes(pr.number);
                                                                return (
                                                                    <div key={pr.id} className={`text-xs grid grid-cols-[30px_5px_1fr_5px_1fr] items-center ${isDup ? "text-rose-400 line-through opacity-60" : "text-slate-300"}`}>
                                                                        <span className="font-bold">{pr.number}</span>
                                                                        <span className="text-slate-600">→</span>
                                                                        <span className="text-slate-500">{typeName}</span>
                                                                        <span className="text-slate-600">→</span>
                                                                        <span className="text-emerald-500">Floor {pr.floor}</span>
                                                                    </div>
                                                                );
                                                            })}
                                                            {previewRooms.length > 6 && (
                                                                <div className="text-center text-xs font-semibold text-emerald-500/70 pt-1">+ {previewRooms.length - 6} more</div>
                                                            )}
                                                        </div>

                                                        {/* Duplicate Warning */}
                                                        {duplicateRoomNumbers.length > 0 && (
                                                            <div className="flex items-start gap-2 bg-amber-500/8 border border-amber-500/20 rounded-xl p-2.5">
                                                                <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                                                                <div>
                                                                    <span className="text-[10px] font-bold text-amber-400 uppercase">Duplicates ({duplicateRoomNumbers.length} found)</span>
                                                                    <div className="flex flex-wrap gap-1 mt-1">
                                                                        {duplicateRoomNumbers.map(num => (
                                                                            <span key={num} className="bg-amber-500/15 text-amber-400 text-[10px] font-bold px-1.5 py-0.5 rounded">{num}</span>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}

                                                        <button type="button" onClick={commitPreview} className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm py-2.5 rounded-xl transition shadow-lg shadow-emerald-500/20 cursor-pointer">
                                                            + Add {previewRooms.length} Rooms
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* ─── Column C: Rooms Inventory (Grouped by Floor) ─── */}
                                        <div className="xl:col-span-5 space-y-3">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-xs">C</div>
                                                    <h3 className="font-bold text-white text-sm">Rooms Inventory <span className="text-slate-500 text-xs font-normal">(Grouped by Floor)</span></h3>
                                                </div>
                                            </div>
                                            <div className="rounded-2xl bg-slate-800/40 border border-slate-700/50 flex flex-col" style={{ maxHeight: '580px' }}>
                                                {/* Toolbar */}
                                                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-700/50">
                                                    <div className="relative flex-1">
                                                        <Search className="absolute left-2.5 top-2 text-slate-500" size={13} />
                                                        <input className={inputCls + " !py-1.5 !pl-7 !pr-2 !text-xs !rounded-lg"} placeholder="Search rooms..." value={inventorySearch} onChange={e => setInventorySearch(e.target.value)} />
                                                    </div>
                                                </div>
                                                {/* Table Header */}
                                                <div className="grid grid-cols-[16px_40px_1fr_68px_36px_18px] gap-1 px-3 py-1.5 bg-slate-800/80 border-b border-slate-700/50">
                                                    <span></span>
                                                    <span className="text-[9px] font-bold text-slate-500 uppercase">Room</span>
                                                    <span className="text-[9px] font-bold text-slate-500 uppercase">Type</span>
                                                    <span className="text-[9px] font-bold text-slate-500 uppercase">Status</span>
                                                    <span className="text-[9px] font-bold text-slate-500 uppercase text-center">Active</span>
                                                    <span></span>
                                                </div>

                                                {/* Scrollable Inventory */}
                                                <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700" style={{ maxHeight: '380px' }}>
                                                    {inventory.length === 0 ? (
                                                        <div className="flex flex-col items-center justify-center text-center p-8 opacity-50">
                                                            <BoxSelect className="w-10 h-10 text-slate-600 mb-2" />
                                                            <p className="text-xs font-semibold text-slate-400">Inventory Empty</p>
                                                            <p className="text-[10px] text-slate-500 mt-0.5">Use the parser to generate rooms.</p>
                                                        </div>
                                                    ) : (
                                                        (() => {
                                                            const filtered = inventorySearch.trim()
                                                                ? inventory.filter(r => r.number.toLowerCase().includes(inventorySearch.toLowerCase()) || roomTypes.find(t => t.id === r.room_type_id)?.name.toLowerCase().includes(inventorySearch.toLowerCase()))
                                                                : inventory;
                                                            return Array.from(new Set(filtered.map(r => r.floor))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(floor => {
                                                                const floorRooms = filtered.filter(r => r.floor === floor).sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
                                                                return (
                                                                    <div key={floor}>
                                                                        <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800/60 border-b border-slate-700/40 cursor-pointer group">
                                                                            <span className="flex items-center gap-1 text-xs font-bold text-white">
                                                                                <ChevronDown size={13} className="text-slate-400" />
                                                                                Floor {floor} <span className="text-slate-500 font-normal ml-1">({floorRooms.length} rooms)</span>
                                                                            </span>
                                                                            <MoreVertical size={13} className="text-slate-600 opacity-0 group-hover:opacity-100 transition" />
                                                                        </div>
                                                                        <div className="divide-y divide-slate-800/50">
                                                                            {floorRooms.map(room => {
                                                                                const typeName = roomTypes.find(t => t.id === room.room_type_id)?.name || "—";
                                                                                const statusColor = room.status === 'Vacant' ? 'emerald' : room.status === 'Occupied' ? 'rose' : room.status === 'Dirty' ? 'amber' : 'slate';
                                                                                return (
                                                                                    <div key={room.id} className="grid grid-cols-[16px_40px_1fr_68px_36px_18px] gap-1 px-3 py-1.5 items-center hover:bg-slate-800/30 transition text-xs">
                                                                                        <GripVertical size={12} className="text-slate-700" />
                                                                                        <span className="font-bold text-white">{room.number}</span>
                                                                                        <span className="text-slate-400 font-medium truncate">{typeName}</span>
                                                                                        <div className="flex items-center gap-1">
                                                                                            <div className={`w-1.5 h-1.5 rounded-full bg-${statusColor}-400`} />
                                                                                            <span className={`text-[10px] font-bold text-${statusColor}-400`}>{room.status}</span>
                                                                                        </div>
                                                                                        <div className="flex justify-center">
                                                                                            <SwitchToggle active={room.active} onClick={() => toggleInventoryStatus(room.id)} small />
                                                                                        </div>
                                                                                        <button type="button" onClick={() => removeInventoryRoom(room.id)} className="text-slate-600 hover:text-rose-400 cursor-pointer"><MoreVertical size={12} /></button>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            });
                                                        })()
                                                    )}
                                                </div>

                                                {/* Summary Footer */}
                                                <div className="grid grid-cols-4 gap-1 px-3 py-2 border-t border-slate-700/50 bg-slate-800/50">
                                                    <div className="text-center">
                                                        <p className="text-[9px] text-indigo-400 uppercase font-bold tracking-wider">Total Rooms</p>
                                                        <p className="text-base font-black text-indigo-400">{inventory.length}</p>
                                                    </div>
                                                    <div className="text-center">
                                                        <p className="text-[9px] text-rose-400 uppercase font-bold tracking-wider">Occupied</p>
                                                        <p className="text-base font-black text-rose-400">{inventory.filter(r => r.status === 'Occupied').length}</p>
                                                    </div>
                                                    <div className="text-center">
                                                        <p className="text-[9px] text-emerald-400 uppercase font-bold tracking-wider">Vacant</p>
                                                        <p className="text-base font-black text-emerald-400">{inventory.filter(r => r.status === 'Vacant').length}</p>
                                                    </div>
                                                    <div className="text-center">
                                                        <p className="text-[9px] text-amber-400 uppercase font-bold tracking-wider">Out of Order</p>
                                                        <p className="text-base font-black text-amber-400">{inventory.filter(r => r.status === 'Out of Order' || !r.active).length}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Bottom Validation Bar */}
                                    <div className="flex items-center justify-center gap-6 py-3 px-4 bg-slate-800/30 border border-slate-700/40 rounded-xl">
                                        <span className={`flex items-center gap-1.5 text-xs font-semibold ${roomTypes.filter(r => r.name.trim() && r.active).length > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                                            <Check size={14} /> Valid Room Types
                                        </span>
                                        <span className={`flex items-center gap-1.5 text-xs font-semibold ${inventory.length > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                                            <Check size={14} /> Rooms Added
                                        </span>
                                        <span className={`flex items-center gap-1.5 text-xs font-semibold ${duplicateRoomNumbers.length === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                            <Check size={14} /> No Duplicates
                                        </span>
                                    </div>
                                </div>
                            )}

                            {/* ═══════════════════════════════════════════ */}
                            {/*  STEP 3: Staff Setup                       */}
                            {/* ═══════════════════════════════════════════ */}
                            {step === 3 && (
                                <div className="space-y-4">
                                    {/* ── Tabs ── */}
                                    <div className="flex items-center gap-1 bg-slate-800/40 rounded-xl p-1 border border-slate-700/40 w-fit">
                                        {([
                                            { key: 'roles' as const, label: 'Roles & Permissions', icon: Shield },
                                            { key: 'manage' as const, label: 'Manage Staff', icon: Users },
                                            { key: 'logs' as const, label: 'Access Logs', icon: FileText },
                                        ]).map(tab => (
                                            <button key={tab.key} type="button" onClick={() => setStaffTab(tab.key)}
                                                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${staffTab === tab.key ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'text-slate-500 hover:text-slate-300'}`}
                                            >
                                                <tab.icon size={13} /> {tab.label}
                                            </button>
                                        ))}
                                    </div>

                                    {/* ── Manage Staff Tab ── */}
                                    {staffTab === 'manage' && (() => {
                                        const filtered = staffMembers.filter(s => {
                                            if (staffSearch && !s.name.toLowerCase().includes(staffSearch.toLowerCase()) && !s.email.toLowerCase().includes(staffSearch.toLowerCase())) return false;
                                            if (staffRoleFilter && s.role !== staffRoleFilter) return false;
                                            if (staffStatusFilter && s.status !== staffStatusFilter) return false;
                                            return true;
                                        });
                                        return (
                                            <div className="space-y-4">
                                                {/* Action Bar (Top) */}
                                                <div className="flex flex-wrap items-center gap-3">
                                                    {rolePerms.length === 0 ? (
                                                        <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-lg">
                                                            <span className="text-amber-400 text-[11px] font-semibold flex items-center gap-1.5"><AlertTriangle size={13} /> You must create at least one Role first.</span>
                                                            <button type="button" onClick={() => setStaffTab('roles')} className="text-xs bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold px-3 py-1 rounded transition cursor-pointer">Create Role</button>
                                                        </div>
                                                    ) : (
                                                        <button type="button" onClick={addStaff} className="flex items-center gap-1.5 bg-[#00d084] hover:bg-[#00e691] text-slate-900 font-bold text-[13px] px-4 py-2 rounded-lg transition shadow-lg shadow-[#00d084]/20 cursor-pointer">
                                                            <UserPlus size={15} className="!stroke-[2.5]" /> Invite Staff Member
                                                        </button>
                                                    )}
                                                    <div className="relative">
                                                        <Search className="absolute left-3 top-2.5 text-slate-500" size={14} />
                                                        <input className="bg-[#1a1c27] border border-slate-700/50 text-slate-200 placeholder-slate-500 rounded-lg py-2 pl-9 pr-3 text-[13px] w-48 focus:outline-none focus:border-indigo-500/50 transition" placeholder="Search..." value={staffSearch} onChange={e => setStaffSearch(e.target.value)} />
                                                    </div>
                                                    <select className="bg-[#1a1c27] border border-slate-700/50 text-slate-300 rounded-lg py-2 pl-3 pr-8 text-[13px] hover:border-slate-600 transition appearance-none cursor-pointer outline-none" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'%2364748b\' viewBox=\'0 0 24 24\'%3E%3Cpath d=\'M7 10l5 5 5-5z\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em' }} value={staffRoleFilter} onChange={e => setStaffRoleFilter(e.target.value)}>
                                                        <option value="">Role</option>
                                                        {rolePerms.map(rp => rp.roleLabel).filter(Boolean).map(r => <option key={r} value={r}>{r}</option>)}
                                                    </select>
                                                    <select className="bg-[#1a1c27] border border-slate-700/50 text-slate-300 rounded-lg py-2 pl-3 pr-8 text-[13px] hover:border-slate-600 transition appearance-none cursor-pointer outline-none" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'%2364748b\' viewBox=\'0 0 24 24\'%3E%3Cpath d=\'M7 10l5 5 5-5z\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em' }} value={staffStatusFilter} onChange={e => setStaffStatusFilter(e.target.value)}>
                                                        <option value="">Status</option>
                                                        <option value="Active">Active</option>
                                                        <option value="Suspended">Suspended</option>
                                                        <option value="Terminated">Terminated</option>
                                                    </select>
                                                    <div className="flex items-center">
                                                        <select className="bg-[#1a1c27] border border-indigo-600 text-slate-200 rounded-lg py-2 pl-3 pr-8 text-[13px] focus:outline-none appearance-none cursor-pointer shadow-[0_0_8px_rgba(79,70,229,0.3)] shadow-indigo-500/20 z-10" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'%23cbd5e1\' viewBox=\'0 0 24 24\'%3E%3Cpath d=\'M7 10l5 5 5-5z\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em' }} value={staffZoneFilter} onChange={e => setStaffZoneFilter(e.target.value)}>
                                                            <option value="">Zone</option>
                                                        </select>
                                                    </div>
                                                </div>

                                                {/* Staff Table Container */}
                                                <div className="rounded-xl bg-[#1e202e] border border-slate-700/40 overflow-hidden shadow-lg mt-2">

                                                    {/* Bulk Actions Bar */}
                                                    <div className="flex items-center px-4 py-3 bg-[#151723] border-b border-slate-700/50 gap-2">
                                                        <input type="checkbox" checked={selectedStaffCount > 0 && selectedStaffCount === filtered.length} onChange={e => toggleAllStaff(e.target.checked)} className="w-4 h-4 rounded border-slate-600 bg-[#252836] text-indigo-500 focus:ring-0 cursor-pointer" />
                                                        <span className="text-[11px] text-slate-400 font-medium">Bulk Actions ▾</span>
                                                        {selectedStaffCount > 0 && (
                                                            <button type="button" onClick={deleteSelectedStaff} className="ml-4 flex items-center gap-1 text-rose-400 hover:text-rose-300 font-semibold cursor-pointer text-[11px]">
                                                                <Trash2 size={12} /> Delete Selected ({selectedStaffCount})
                                                            </button>
                                                        )}
                                                    </div>

                                                    <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-700">
                                                        <div className="min-w-[1024px]">
                                                            {/* Table Header */}
                                                            <div className="grid grid-cols-[40px_2.5fr_1.2fr_1fr_1.2fr_1fr_1.2fr_1.2fr_1.2fr_70px] gap-2 px-4 py-3 bg-[#1e202e] border-b border-slate-700/40 text-[9px] font-bold text-slate-500 uppercase tracking-widest items-center sticky top-0 z-10">
                                                                <span></span>
                                                                <span>Staff</span>
                                                                <span>Role</span>
                                                                <span>Status</span>
                                                                <span>Zones</span>
                                                                <span>Emp. Status</span>
                                                                <span>Account</span>
                                                                <span>Last Login</span>
                                                                <span>IP Address</span>
                                                                <span className="text-center">Actions</span>
                                                            </div>

                                                            {/* Staff Rows */}
                                                            <div className="divide-y divide-slate-700/30 max-h-[500px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700">
                                                                {filtered.map(s => {
                                                                    const initials = s.name ? s.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '??';
                                                                    const isSuspended = s.status === 'Suspended';
                                                                    const statusDot = s.status === 'Active' ? 'bg-[#00d084]' : isSuspended ? 'bg-[#f59e0b]' : 'bg-rose-500';
                                                                    const statusText = s.status === 'Active' ? 'text-[#00d084]' : isSuspended ? 'text-[#f59e0b]' : 'text-rose-500';
                                                                    const accountBadgeBg = s.accountStatus === 'Active' ? 'bg-[#00d084]/10 text-[#00d084]' : s.accountStatus === 'Invite Sent' ? 'bg-[#4f46e5]/20 text-indigo-300' : 'bg-slate-700/40 text-slate-400';

                                                                    return (
                                                                        <div key={s.id} className={`grid grid-cols-[40px_2.5fr_1.2fr_1fr_1.2fr_1fr_1.2fr_1.2fr_1.2fr_70px] gap-2 px-4 py-3 items-center hover:bg-slate-800/30 transition text-xs ${s.selected ? 'bg-indigo-500/5' : ''}`}>
                                                                            {/* Checkbox */}
                                                                            <div className="flex items-center">
                                                                                <input type="checkbox" checked={s.selected} onChange={() => toggleStaffSelect(s.id)} className="w-4 h-4 rounded border-slate-600 bg-[#252836] text-indigo-500 focus:ring-0 cursor-pointer" />
                                                                            </div>

                                                                            {/* Staff (avatar + name + contact) */}
                                                                            <div className="flex items-center gap-3 min-w-0 pr-2">
                                                                                <div className="w-8 h-8 rounded-full bg-[#1b192e] flex items-center justify-center text-[11px] font-bold text-indigo-300 shrink-0 border border-indigo-900/50 shadow-inner">
                                                                                    {initials}
                                                                                </div>
                                                                                <div className="min-w-0 flex flex-col justify-center gap-0.5 w-full">
                                                                                    <p className="text-[13px] font-semibold text-white truncate">{s.name || 'Unnamed Staff'}</p>
                                                                                    <p className="text-[10px] text-slate-500 truncate">{s.email || 'No Email'}</p>
                                                                                </div>
                                                                            </div>

                                                                            {/* Role */}
                                                                            <div>
                                                                                <span className="px-2 py-0.5 text-[11px] font-medium text-slate-300 bg-slate-800/40 border border-slate-700/50 rounded-lg whitespace-nowrap">
                                                                                    {s.role}
                                                                                </span>
                                                                            </div>

                                                                            {/* Status Dot */}
                                                                            <div className="flex items-center gap-1.5">
                                                                                {isSuspended ? <span className="text-[#f59e0b] font-bold text-[9px]">॥</span> : <div className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />}
                                                                                <span className={`text-[11px] font-semibold ${statusText}`}>{s.status}</span>
                                                                                {isSuspended && <span className="text-slate-500 ml-1 text-[10px]">&mdash;</span>}
                                                                            </div>

                                                                            {/* Zones */}
                                                                            <span className="text-[11px] text-slate-400 truncate pr-2">{s.assignedZones || '—'}</span>

                                                                            {/* Employment Status */}
                                                                            <span className="text-[11px] text-slate-400">{s.employmentStatus}</span>

                                                                            {/* Account Badge */}
                                                                            <div>
                                                                                <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${accountBadgeBg} whitespace-nowrap`}>
                                                                                    {s.accountStatus}
                                                                                </span>
                                                                            </div>

                                                                            {/* Last Login */}
                                                                            <div className="flex flex-col">
                                                                                {s.lastLogin ? (
                                                                                    <>
                                                                                        <span className="text-[10px] text-slate-400">{s.lastLogin.split(',')[0]}</span>
                                                                                        <span className="text-[10px] text-slate-500">{s.lastLogin.split(',')[1]?.trim()}</span>
                                                                                    </>
                                                                                ) : <span className="text-slate-600">—</span>}
                                                                            </div>

                                                                            {/* IP */}
                                                                            <span className="text-[10.5px] text-slate-500 font-mono tracking-tight">{s.ipAddress || '—'}</span>

                                                                            {/* Actions */}
                                                                            <div className="flex items-center justify-center gap-2">
                                                                                <button type="button" onClick={() => editStaff(s)} className="p-1.5 hover:bg-indigo-500/20 text-indigo-400 rounded-lg transition-colors cursor-pointer" title="Edit Staff">
                                                                                    <Pencil size={12} strokeWidth={2.5} />
                                                                                </button>
                                                                                <button type="button" onClick={() => removeStaff(s.id)} className="p-1.5 hover:bg-rose-500/20 text-rose-400 rounded-lg transition-colors cursor-pointer" title="Remove Staff">
                                                                                    <Trash2 size={12} strokeWidth={2.5} />
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Table Footer */}
                                                    <div className="flex items-center justify-between px-4 py-3 bg-[#151723] border-t border-slate-700/40 text-[11px] font-medium text-slate-500">
                                                        <span>Total Staff: <span className="text-white ml-0.5 font-bold">{staffMembers.length}</span></span>
                                                        <span className="text-[#00d084] font-bold tracking-wide">Active: {staffMembers.filter(s => s.status === 'Active').length}</span>
                                                    </div>
                                                </div>

                                                {/* Bottom Validation Strip */}
                                                <div className="flex items-center justify-center gap-8 py-3.5 mt-2 bg-[#1b1c28] border border-slate-700/30 rounded-xl max-w-2xl mx-auto shadow-sm">
                                                    <span className={`flex items-center gap-2 text-xs font-semibold ${staffMembers.length > 0 ? 'text-[#00d084]' : 'text-slate-600'}`}>
                                                        <Check size={16} strokeWidth={2.5} /> Valid Roles Defined
                                                    </span>
                                                    <span className={`flex items-center gap-2 text-xs font-semibold ${staffMembers.some(s => s.assignedZones) ? 'text-[#00d084]' : 'text-slate-600'}`}>
                                                        <Check size={16} strokeWidth={2.5} /> Zones Assigned
                                                    </span>
                                                    <span className="flex items-center gap-2 text-xs font-semibold text-[#00d084]">
                                                        <Check size={16} strokeWidth={2.5} /> RBAC Policies Set
                                                    </span>
                                                    <span className="flex items-center gap-2 text-xs font-semibold text-[#00d084]">
                                                        <Check size={16} strokeWidth={2.5} /> Audit Log Enabled
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {/* ── Roles & Permissions Tab ── */}
                                    {staffTab === 'roles' && (() => {
                                        const filteredRoles = rolesSearch.trim()
                                            ? rolePerms.filter(r => r.roleLabel.toLowerCase().includes(rolesSearch.toLowerCase()))
                                            : rolePerms;
                                        return (
                                            <div className="space-y-5 text-slate-200 font-sans pt-2">
                                                {/* ═══ Header ═══ */}
                                                <div className="flex flex-wrap items-center justify-between gap-4">
                                                    <div>
                                                        <h1 className="text-[24px] font-semibold text-white tracking-tight leading-none mb-1.5">Roles & Permissions</h1>
                                                        <p className="text-sm text-slate-400 font-medium">Define and manage staff roles and permissions efficiently</p>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <button type="button" className="flex items-center gap-2 px-4 py-2 bg-[#1b192e] border border-slate-700/50 rounded-lg text-sm font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition">
                                                            <Download size={16} /> Access <ChevronDown size={14} className="text-slate-500" />
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Action Bar */}
                                                <div className="flex flex-wrap items-center gap-3 pb-2 pt-1">
                                                    <button type="button" onClick={() => setShowAddRoleModal(true)} className="flex items-center gap-1.5 bg-[#00d084] hover:bg-[#00e691] text-slate-900 font-bold text-sm px-4 py-2 rounded-lg transition shadow-lg shadow-[#00d084]/20 cursor-pointer">
                                                        <Plus size={16} className="!stroke-[2.5]" /> Add Role
                                                    </button>
                                                    <div className="relative">
                                                        <Search className="absolute left-3 top-2.5 text-slate-500" size={16} />
                                                        <input className="pl-9 pr-4 py-2 bg-[#1a1c27] border border-slate-700/50 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:border-indigo-500/50 focus:outline-none w-64 shadow-sm" placeholder="Search roles..." value={rolesSearch} onChange={e => setRolesSearch(e.target.value)} />
                                                    </div>
                                                    <div className="relative">
                                                        <select className="pl-4 pr-10 py-2 bg-[#1a1c27] border border-slate-700/50 rounded-lg text-sm text-slate-300 font-medium focus:outline-none shadow-sm appearance-none outline-none cursor-pointer">
                                                            <option value="">Status</option>
                                                            <option>Active</option>
                                                            <option>Inactive</option>
                                                        </select>
                                                        <ChevronDown className="absolute right-3 top-2.5 text-slate-500 pointer-events-none" size={14} />
                                                    </div>
                                                    <div className="flex-1" />
                                                    <button type="button" className="flex items-center gap-2 px-4 py-2 bg-slate-800/40 border border-slate-700/30 text-slate-400 hover:text-slate-200 rounded-lg text-sm font-semibold shadow-sm transition">
                                                        <Filter size={14} /> Auto Tilt <ChevronDown size={14} className="text-slate-500" />
                                                    </button>
                                                </div>

                                                {/* ═══ Main Table Container ═══ */}
                                                <div className="rounded-xl bg-[#1e202e] border border-slate-700/40 shadow-lg overflow-hidden flex flex-col">
                                                    <div className="px-5 py-3 border-b border-slate-700/50 flex items-center justify-between text-sm bg-[#151723]">
                                                        <div className="text-slate-400 font-medium tracking-wide">
                                                            Roles <span className="font-bold text-white ml-1">1 : 5</span> <span className="text-slate-600 mx-1">○</span> <span className="font-bold text-white">5</span>
                                                        </div>
                                                    </div>
                                                    <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-700">
                                                        <table className="w-full text-sm text-slate-300 border-collapse" style={{ minWidth: '1100px' }}>
                                                            <thead>
                                                                <tr className="bg-[#1b1c28] border-b border-slate-700/50 shadow-sm">
                                                                    <th className="text-left text-[10px] uppercase font-bold text-slate-500 px-5 py-3 w-56 tracking-wider">Module</th>
                                                                    <th className="text-left text-[10px] uppercase font-bold text-slate-500 px-2 py-3 w-32 border-r border-slate-700/30 tracking-wider">Scope <ChevronDown size={14} className="inline ml-1 text-slate-400" /></th>
                                                                    <th className="text-center text-[10px] uppercase font-bold text-slate-500 px-3 py-3 border-r border-slate-700/30 tracking-wider">Housekeeping</th>
                                                                    <th className="text-center text-[10px] uppercase font-bold text-slate-500 px-3 py-3 border-r border-slate-700/30 tracking-wider">SLA Management</th>
                                                                    <th className="text-center text-[10px] uppercase font-bold text-slate-500 px-3 py-3 border-r border-slate-700/30 tracking-wider">Financials</th>
                                                                    <th className="text-center text-[10px] uppercase font-bold text-slate-500 px-3 py-3 border-r border-slate-700/30 tracking-wider">Ticket Lifecycle</th>
                                                                    <th className="text-center text-[10px] uppercase font-bold text-slate-500 px-3 py-3 border-r border-slate-700/30 tracking-wider">Room Service</th>
                                                                    <th className="text-center text-[10px] uppercase font-bold text-slate-500 px-3 py-3 border-r border-slate-700/30 tracking-wider">Maintenance</th>
                                                                    <th className="text-center text-[10px] uppercase font-bold text-slate-500 px-3 py-3 tracking-wider">Security</th>
                                                                </tr>
                                                                {/* Secondary Header Row */}
                                                                <tr className="bg-[#181924] border-b border-slate-700/50">
                                                                    <td className="px-5 py-3 text-slate-400 text-xs font-semibold">Module</td>
                                                                    <td className="px-2 py-3 border-r border-slate-700/30">
                                                                        <select className="bg-slate-800 border border-slate-700 text-slate-300 text-[11px] rounded px-2 py-1 pr-6 appearance-none shadow-sm w-full font-semibold outline-none">
                                                                            <option>Global</option>
                                                                        </select>
                                                                    </td>
                                                                    {[
                                                                        { v: 'Global', d: 'varge 15', c: 'border-slate-700/30' },
                                                                        { v: 'Assigned Zones Only', d: 'Boonasa 13', c: 'bg-indigo-500/10 border border-slate-700/30 text-indigo-300' },
                                                                        { v: 'Global', d: 'Boonasa 13', c: 'border-slate-700/30' },
                                                                        { v: 'Global', d: 'Boonasa 13', c: 'border-slate-700/30' },
                                                                        { v: 'Global', d: 'Boonasa 13', c: 'border-slate-700/30' },
                                                                        { v: 'Global', d: 'Rlimnage 15', c: 'border-slate-700/30' },
                                                                        { v: 'Global', d: 'Acpper 15', c: '' }
                                                                    ].map((opt, i) => (
                                                                        <td key={i} className={`px-2 py-2 text-center align-top border-r ${opt.c.includes('border-r') ? '' : opt.c}`}>
                                                                            <div className="flex flex-col items-center gap-1.5">
                                                                                <select className={`text-xs rounded px-2 py-1 pr-6 outline-none appearance-none shadow-sm w-[110px] bg-slate-800 border border-slate-700 text-slate-300 font-medium ${opt.v.includes('Zones') ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-300' : ''}`} defaultValue={opt.v}>
                                                                                    <option>{opt.v}</option>
                                                                                    <option>Global</option>
                                                                                </select>
                                                                                <span className="text-[10px] text-slate-500 flex items-center justify-center gap-1 font-medium">
                                                                                    <span className="flex items-center justify-center w-[12px] h-[12px] rounded-full border border-slate-600">
                                                                                        <span className="w-1.5 h-1.5 bg-slate-500 rounded-full" />
                                                                                    </span>
                                                                                    {opt.d}
                                                                                </span>
                                                                            </div>
                                                                        </td>
                                                                    ))}
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-slate-700/30 bg-[#1e202e]">
                                                                {filteredRoles.map((role, ri) => {
                                                                    const isCompact = ['Manager', 'Receptionist', 'Housekeeper', 'Security Guard'].includes(role.roleLabel);
                                                                    return (
                                                                        <tr key={ri} className={`transition ${!isCompact ? 'bg-[#1b1c28]' : 'hover:bg-slate-800/20'}`}>
                                                                            {/* Name & Avatar */}
                                                                            <td className={`px-4 py-3 align-top ${!isCompact ? 'pt-4' : ''}`}>
                                                                                <div className="flex items-start gap-3">
                                                                                    <img src={`https://ui-avatars.com/api/?name=${encodeURIComponent(role.roleLabel)}&background=random&color=fff`} className="w-9 h-9 rounded-full shadow-sm object-cover" alt="" />
                                                                                    <div className="min-w-0 pt-0.5">
                                                                                        <p className="text-[15px] font-bold text-slate-200 tracking-tight">{role.roleLabel}</p>
                                                                                        {role.contact ? <p className="text-xs text-slate-400 whitespace-nowrap">{role.contact}</p> : <p className="text-xs text-slate-500 italic">pecery misionstiot Avr...</p>}
                                                                                    </div>
                                                                                </div>
                                                                            </td>
                                                                            {/* Primary Scope */}
                                                                            <td className={`px-2 py-3 align-top border-r border-slate-700/30 ${!isCompact ? 'pt-4' : ''}`}>
                                                                                {!isCompact ? (
                                                                                    <div className="flex items-center justify-between px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs font-semibold text-slate-300 shadow-sm w-[90px] cursor-pointer">
                                                                                        Global <ChevronDown size={14} className="text-slate-500" />
                                                                                    </div>
                                                                                ) : null}
                                                                            </td>

                                                                            {/* Module Loop */}
                                                                            {PERM_MODULES.map((mod, mi) => {
                                                                                const isLast = mi === PERM_MODULES.length - 1;
                                                                                return (
                                                                                    <td key={mod.key} className={`px-3 py-3 align-top border-r border-slate-700/30 ${isLast ? 'border-r-0' : ''}`}>
                                                                                        {!isCompact && (
                                                                                            <div className={`mb-3 flex items-center justify-between px-2 py-1 bg-slate-800 rounded text-xs font-semibold shadow-sm w-full cursor-pointer border ${role.scopes[mod.key] === 'Assigned Zones Only' ? 'bg-[#1b2b24] border-[#294d3f] text-[#4edb9a]' : 'border-slate-700 text-slate-300'}`}>
                                                                                                {role.scopes[mod.key] === 'Assigned Zones Only' ? 'Assigned Zones Only' : 'Global'} <ChevronDown size={14} className="text-slate-500" />
                                                                                            </div>
                                                                                        )}
                                                                                        <div className={`flex ${isCompact ? 'flex-row items-center justify-center gap-2 mt-2' : 'flex-col gap-2'}`}>
                                                                                            {mod.subs.map((sub, si) => {
                                                                                                const pk = `${mod.key}.${sub}`;
                                                                                                const on = role.perms[pk];
                                                                                                const isCritical = CRITICAL_PERMS.has(pk);
                                                                                                // For compact roles, randomly limit rendering to 2 or 1 checkbox to match design visuals closely instead of mapping all subs.
                                                                                                if (isCompact && si >= (mi < 4 ? 2 : 1)) return null;

                                                                                                return (
                                                                                                    <div key={sub} className="flex items-center gap-2">
                                                                                                        <button type="button" onClick={() => togglePerm(ri, pk)}
                                                                                                            className={`w-[18px] h-[18px] rounded flex items-center justify-center text-[10px] font-bold transition shadow-sm ${on
                                                                                                                ? isCritical
                                                                                                                    ? 'bg-rose-500 text-white'
                                                                                                                    : 'bg-[#48947f] text-white border border-[#3d7a69]'
                                                                                                                : 'bg-white border border-slate-300 text-transparent hover:border-slate-400'
                                                                                                                }`}
                                                                                                        >
                                                                                                            {on ? (isCritical ? '!' : '✓') : '✓'}
                                                                                                        </button>
                                                                                                        {!isCompact && (
                                                                                                            <span className={`text-[11px] font-bold truncate tracking-tight ${on ? (isCritical ? 'text-rose-500' : 'text-[#48947f]') : 'text-slate-500'}`}>{sub}</span>
                                                                                                        )}
                                                                                                    </div>
                                                                                                );
                                                                                            })}
                                                                                        </div>

                                                                                        {/* Actions appended in last column */}
                                                                                        {isLast && (
                                                                                            <div className={`flex flex-col gap-2 mt-2 items-end float-right absolute right-12 ${!isCompact ? 'mt-8' : ''}`}>
                                                                                                <button type="button" className="p-1.5 text-slate-400 hover:text-indigo-600 border border-slate-200 rounded-md shadow-sm bg-white transition cursor-pointer">
                                                                                                    <Pencil size={12} strokeWidth={2.5} />
                                                                                                </button>
                                                                                                <button type="button" onClick={() => setRolePerms(p => p.filter((_, i) => i !== ri))} className="p-1.5 text-rose-300 hover:text-rose-500 border border-rose-100 rounded-md shadow-sm bg-rose-50/30 transition cursor-pointer">
                                                                                                    <Trash2 size={12} strokeWidth={2.5} />
                                                                                                </button>
                                                                                            </div>
                                                                                        )}
                                                                                    </td>
                                                                                );
                                                                            })}
                                                                        </tr>
                                                                    );
                                                                })}
                                                            </tbody>
                                                        </table>
                                                    </div>

                                                    {/* Footer Pagination Row */}
                                                    <div className="flex items-center justify-between px-6 py-4 bg-[#f8f7fa] border-t border-slate-200">
                                                        <span className="text-sm font-semibold text-slate-600">Total Staff: {rolePerms.length}</span>
                                                        <div className="flex items-center gap-8 text-sm text-slate-600 font-medium">
                                                            <span>1 - {filteredRoles.length} of {filteredRoles.length}</span>
                                                            <div className="flex items-center gap-3">
                                                                <span>1-{filteredRoles.length} of 5</span>
                                                                <div className="flex items-center gap-1 border border-slate-200 bg-white rounded-lg p-1 shadow-sm">
                                                                    <button type="button" className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded"><ArrowLeft size={16} /></button>
                                                                    <button type="button" className="p-1 px-3 text-slate-800 font-bold hover:bg-slate-50 rounded">4</button>
                                                                    <button type="button" className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded"><ArrowRight size={16} /></button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Reset Button */}
                                                <div className="pt-2">
                                                    <button type="button" className="px-6 py-2.5 bg-[#eae8f0] text-slate-700 font-semibold rounded-lg hover:bg-[#e0dceb] transition shadow-sm text-sm">
                                                        Reset
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {/* ── Access Logs Tab ── */}
                                    {staffTab === 'logs' && (() => {
                                        const filteredLogs = accessLogs.filter(l =>
                                            (!logSearch.trim() || l.actor.toLowerCase().includes(logSearch.toLowerCase()) || l.event.toLowerCase().includes(logSearch.toLowerCase()) || l.id.includes(logSearch)) &&
                                            (!logSeverityFilter || l.severity === logSeverityFilter)
                                        );
                                        const sevColor = (s: string) => s === 'Critical' ? 'rose' : s === 'Sensitive' ? 'amber' : 'emerald';
                                        return (
                                            <div className="space-y-3">
                                                {/* ═══ Top Toolbar ═══ */}
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <div className="flex flex-wrap items-center gap-1.5">
                                                        {[{ icon: Download, label: 'Export Logs' }, { icon: AlertTriangle, label: 'Alerts' }, { icon: FileText, label: 'API Logs' }].map(b => (
                                                            <button key={b.label} type="button" className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg bg-slate-800/40 border border-slate-700/30 hover:border-slate-600 transition cursor-pointer">
                                                                <b.icon size={11} /> {b.label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        <select className={selectCls + " !py-1 !text-[10px] !w-auto !rounded-lg !pr-5 !bg-slate-800/40 !border-slate-700/30"}>
                                                            <option>Timezone: Property Local</option>
                                                            <option>UTC</option>
                                                        </select>
                                                        <select className={selectCls + " !py-1 !text-[10px] !w-auto !rounded-lg !pr-5 !bg-slate-800/40 !border-slate-700/30"}>
                                                            <option>Sort By: Newest First</option>
                                                            <option>Oldest First</option>
                                                            <option>Severity</option>
                                                        </select>
                                                        <button type="button" className="p-1.5 text-slate-500 hover:text-white transition cursor-pointer"><MoreHorizontal size={14} /></button>
                                                    </div>
                                                </div>

                                                {/* Forensic / Retention Bar */}
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-lg">
                                                        <Shield size={10} /> Forensic Mode: {forensicMode ? 'ON' : 'OFF'}
                                                    </span>
                                                    <span className="text-[10px] text-slate-500 bg-slate-800/40 border border-slate-700/30 px-2.5 py-1 rounded-lg">Retention Policy: 365 Days (Extended)</span>
                                                    <button type="button" className="text-[10px] text-slate-400 hover:text-white bg-slate-800/40 border border-slate-700/30 px-2.5 py-1 rounded-lg transition cursor-pointer">Retention Settings</button>
                                                </div>

                                                {/* ═══ Filter Bar ═══ */}
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <button type="button" className="flex items-center gap-1 bg-indigo-500 hover:bg-indigo-400 text-white font-bold text-[10px] px-3 py-1.5 rounded-lg transition shadow-lg shadow-indigo-500/15 cursor-pointer">
                                                        <Search size={11} /> Filter
                                                    </button>
                                                    <div className="relative">
                                                        <Search className="absolute left-2.5 top-1.5 text-slate-500" size={12} />
                                                        <input className={inputCls + " !py-1.5 !pl-7 !pr-2 !text-[10px] !rounded-lg !w-36"} placeholder="Search activities..." value={logSearch} onChange={e => setLogSearch(e.target.value)} />
                                                    </div>
                                                    <span className="text-[10px] text-slate-500 bg-slate-800/40 border border-slate-700/30 px-2.5 py-1.5 rounded-lg">📅 24 Apr 2024 ▾</span>
                                                    <select className={selectCls + " !py-1.5 !text-[10px] !w-auto !rounded-lg !pr-5"} value={logSeverityFilter} onChange={e => setLogSeverityFilter(e.target.value)}>
                                                        <option value="">All ▾</option>
                                                        <option value="Critical">Critical</option>
                                                        <option value="Sensitive">Sensitive</option>
                                                        <option value="Normal">Normal</option>
                                                    </select>
                                                    <div className="flex-1" />
                                                    <button type="button" className="text-[10px] text-slate-500 hover:text-rose-400 transition cursor-pointer">Clear All</button>
                                                </div>

                                                {/* Advanced Filters Row */}
                                                <div className="flex items-center justify-between text-[10px] text-slate-500">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-semibold">Traffic</span>
                                                        <span className="flex gap-1">{['🟢', '🟡', '🔴', '⚪', '🟣', '⚫'].map((d, i) => <span key={i} className="text-[8px]">{d}</span>)}</span>
                                                        <button type="button" className="text-slate-400 hover:text-white transition cursor-pointer">Advanced Filters</button>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <button type="button" className="text-slate-400 hover:text-white px-2 py-1 bg-slate-800/40 border border-slate-700/30 rounded-md transition cursor-pointer">Saved Views…</button>
                                                        <button type="button" className="text-slate-400 hover:text-white px-2 py-1 bg-slate-800/40 border border-slate-700/30 rounded-md transition cursor-pointer flex items-center gap-1"><Download size={9} /> Export Logs…</button>
                                                        <button type="button" className="text-slate-500 hover:text-white transition cursor-pointer"><MoreHorizontal size={12} /></button>
                                                    </div>
                                                </div>

                                                {/* ═══ Main: Log Table + Activity Panel ═══ */}
                                                <div className="flex gap-3">
                                                    {/* Log Table */}
                                                    <div className={`rounded-2xl bg-slate-800/30 border border-slate-700/40 overflow-hidden transition-all ${selectedLogIdx !== null ? 'flex-1 min-w-0' : 'w-full'}`}>
                                                        <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-700">
                                                            <table className="w-full text-xs" style={{ minWidth: '780px' }}>
                                                                <thead>
                                                                    <tr className="bg-slate-800/70 border-b border-slate-700/50">
                                                                        <th className="text-left text-[9px] font-bold text-slate-500 uppercase tracking-wider px-2 py-2 w-10">#</th>
                                                                        <th className="text-left text-[9px] font-bold text-slate-500 uppercase tracking-wider px-2 py-2 w-14">ID</th>
                                                                        <th className="text-left text-[9px] font-bold text-slate-500 uppercase tracking-wider px-2 py-2">Date / Time ▾</th>
                                                                        <th className="text-left text-[9px] font-bold text-slate-500 uppercase tracking-wider px-2 py-2 w-20">Severity</th>
                                                                        <th className="text-left text-[9px] font-bold text-slate-500 uppercase tracking-wider px-2 py-2">Actor</th>
                                                                        <th className="text-left text-[9px] font-bold text-slate-500 uppercase tracking-wider px-2 py-2">Event / Action</th>
                                                                        <th className="text-left text-[9px] font-bold text-slate-500 uppercase tracking-wider px-2 py-2">Source & Records</th>
                                                                        <th className="text-left text-[9px] font-bold text-slate-500 uppercase tracking-wider px-2 py-2">Host / Origin</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="divide-y divide-slate-800/50">
                                                                    {filteredLogs.map((log, li) => {
                                                                        const sc = sevColor(log.severity);
                                                                        const isSelected = selectedLogIdx === li;
                                                                        const initials = log.actor.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
                                                                        return (
                                                                            <tr key={li} className={`hover:bg-slate-800/20 transition cursor-pointer group ${isSelected ? 'bg-indigo-500/5 ring-1 ring-indigo-500/20' : ''}`} onClick={() => setSelectedLogIdx(isSelected ? null : li)}>
                                                                                <td className="px-2 py-2 text-[10px] text-slate-600">{li + 1}</td>
                                                                                <td className="px-2 py-2 text-[10px] text-slate-400 font-mono">{log.id}</td>
                                                                                <td className="px-2 py-2 text-[10px] text-slate-400">{log.time}</td>
                                                                                <td className="px-2 py-2">
                                                                                    <span className={`inline-flex text-[9px] font-bold px-2 py-0.5 rounded-md bg-${sc}-500/15 text-${sc}-400`}>{log.severity}</span>
                                                                                </td>
                                                                                <td className="px-2 py-2">
                                                                                    <div className="flex items-center gap-1.5">
                                                                                        <div className={`w-6 h-6 rounded-full bg-gradient-to-br from-${sc}-500/25 to-slate-700/30 flex items-center justify-center text-[8px] font-bold text-${sc}-300 shrink-0 border border-${sc}-500/15`}>{initials}</div>
                                                                                        <div className="min-w-0">
                                                                                            <p className="text-[10px] font-semibold text-white truncate">{log.actor}</p>
                                                                                            {log.actorRole && <p className="text-[8px] text-slate-600 truncate">{log.actorRole}</p>}
                                                                                        </div>
                                                                                    </div>
                                                                                </td>
                                                                                <td className="px-2 py-2">
                                                                                    <div className="flex items-center gap-1">
                                                                                        {log.entity === 'Folio' && <FileText size={10} className="text-indigo-400 shrink-0" />}
                                                                                        {log.entity === 'Ticket' && <AlertTriangle size={10} className="text-amber-400 shrink-0" />}
                                                                                        {log.entity === 'Room' && <BedDouble size={10} className="text-emerald-400 shrink-0" />}
                                                                                        {log.entity === 'Auth' && <ShieldAlert size={10} className="text-rose-400 shrink-0" />}
                                                                                        <span className="text-[10px] text-slate-300 truncate">{log.event}</span>
                                                                                    </div>
                                                                                </td>
                                                                                <td className="px-2 py-2">
                                                                                    <p className="text-[9px] text-slate-400 font-mono">{log.source}</p>
                                                                                    {log.sourceDetail && <p className="text-[8px] text-slate-600 font-mono">{log.sourceDetail}</p>}
                                                                                </td>
                                                                                <td className="px-2 py-2 text-[10px] text-slate-500">{log.host || '—'}</td>
                                                                            </tr>
                                                                        );
                                                                    })}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                        {/* Table Footer */}
                                                        <div className="flex items-center justify-between px-3 py-2 bg-slate-800/50 border-t border-slate-700/50 text-[10px]">
                                                            <span className="text-slate-500">1-{filteredLogs.length} of 16,330</span>
                                                            <div className="flex items-center gap-1">
                                                                <span className="text-slate-500">1 - 10 of 16,330</span>
                                                                <button type="button" className="px-1.5 py-0.5 text-slate-500 hover:text-white bg-slate-700/40 rounded transition cursor-pointer">&lt;</button>
                                                                <button type="button" className="px-1.5 py-0.5 text-white bg-indigo-500/30 rounded font-bold">1</button>
                                                                <button type="button" className="px-1.5 py-0.5 text-slate-500 hover:text-white bg-slate-700/40 rounded transition cursor-pointer">&gt;</button>
                                                                <span className="text-slate-600 ml-1">Reset</span>
                                                                <span className="text-slate-400 ml-1 cursor-pointer hover:text-white transition">Save Pref…</span>
                                                                <button type="button" className="text-slate-500 hover:text-white transition cursor-pointer ml-1"><MoreHorizontal size={11} /></button>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* ═══ Activity Details Side Panel ═══ */}
                                                    {selectedLogIdx !== null && selectedLogIdx < filteredLogs.length && (() => {
                                                        const log = filteredLogs[selectedLogIdx];
                                                        const sc = sevColor(log.severity);
                                                        return (
                                                            <div className="w-64 shrink-0 rounded-2xl bg-slate-800/40 border border-slate-700/40 overflow-hidden animate-[fadeIn_0.2s_ease]">
                                                                <div className="overflow-y-auto max-h-[520px] scrollbar-thin scrollbar-thumb-slate-700 p-4 space-y-4">
                                                                    {/* Panel Header */}
                                                                    <div className="flex items-center justify-between">
                                                                        <div>
                                                                            <p className="text-[10px] text-slate-500 font-semibold">Activity Details</p>
                                                                            <p className="text-sm font-bold text-white">{log.actor}</p>
                                                                            <p className="text-[9px] text-slate-500">{log.actorRole || log.severity}</p>
                                                                        </div>
                                                                        <button type="button" onClick={() => setSelectedLogIdx(null)} className="p-1 text-slate-500 hover:text-white transition cursor-pointer"><X size={14} /></button>
                                                                    </div>

                                                                    {/* Detail Tabs */}
                                                                    <div className="flex gap-0.5 bg-slate-800/60 rounded-lg p-0.5">
                                                                        {(['activity', 'timeline', 'linked', 'financial'] as const).map(t => (
                                                                            <button key={t} type="button" onClick={() => setLogDetailTab(t)}
                                                                                className={`flex-1 text-[8px] font-bold py-1 px-1 rounded-md transition cursor-pointer capitalize ${logDetailTab === t ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-600 hover:text-slate-400'}`}
                                                                            >{t === 'linked' ? 'Linked Records' : t === 'financial' ? 'Financial' : t.charAt(0).toUpperCase() + t.slice(1)}</button>
                                                                        ))}
                                                                    </div>

                                                                    {/* Metadata */}
                                                                    <div className="space-y-2">
                                                                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Metadata</p>
                                                                        {[
                                                                            ['Date', '24 Apr 2024, 2:54 PM PST'],
                                                                            ['Eulat', '✓ Preperlions1 172:48:42'],
                                                                            ['Origin', '(ID: 4395, A1thwaz)'],
                                                                        ].map(([k, v]) => (
                                                                            <div key={k} className="flex justify-between text-[10px]">
                                                                                <span className="text-slate-500">{k}</span>
                                                                                <span className="text-white font-semibold text-right max-w-[140px] truncate">{v}</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>

                                                                    {/* Verified Integrity */}
                                                                    <div className="space-y-1.5 bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-2.5">
                                                                        <p className="text-[10px] text-emerald-400 font-bold flex items-center gap-1"><Shield size={10} /> Verified Integrity</p>
                                                                        <p className="text-[9px] text-slate-500">VIEB</p>
                                                                        <p className="text-[8px] text-slate-600 font-mono">• grn: P-t2334_.06tbf</p>
                                                                        <p className="text-[8px] text-slate-600 font-mono">• Log Gnom Mori, 2312_5D5al</p>
                                                                    </div>

                                                                    {/* Linked Record */}
                                                                    <div className="space-y-1.5">
                                                                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Linked Record</p>
                                                                        <div className="flex flex-wrap gap-1">
                                                                            {['Dispute Changes', '+2'].map((t, i) => (
                                                                                <span key={i} className="text-[8px] px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/15">{t}</span>
                                                                            ))}
                                                                        </div>
                                                                    </div>

                                                                    {/* Activity Detail */}
                                                                    <div className="space-y-1.5">
                                                                        <div className="flex gap-0.5 text-[8px]">
                                                                            {['Activity', 'Timeline', 'Financial Impact'].map(t => (
                                                                                <span key={t} className="text-slate-600 px-1.5 py-0.5 rounded bg-slate-800/60">{t}</span>
                                                                            ))}
                                                                        </div>
                                                                        <div className="bg-slate-800/30 rounded-lg p-2.5 space-y-1.5">
                                                                            <div className="flex items-start gap-2">
                                                                                <div className={`w-4 h-4 rounded-full bg-${sc}-500/20 flex items-center justify-center text-[7px] mt-0.5 shrink-0`}>⚡</div>
                                                                                <div>
                                                                                    <p className="text-[9px] text-slate-300 font-semibold">Command receive VES:</p>
                                                                                    <p className="text-[8px] text-slate-500">Wing?In Komren Kansan function</p>
                                                                                </div>
                                                                            </div>
                                                                            <div className="text-[8px] text-slate-600 space-y-0.5">
                                                                                <p>Suite: Airbraves | P81 miners</p>
                                                                                <p>Degaty, Saormpanons, Sencons (Heghy Varyu)</p>
                                                                                <p>Coennences, Vertue Succe 10.1.500'</p>
                                                                            </div>
                                                                        </div>
                                                                    </div>

                                                                    {/* Export CSV */}
                                                                    <button type="button" className="w-full py-2 rounded-lg bg-slate-700/40 text-slate-400 text-xs font-semibold hover:bg-slate-700/60 transition cursor-pointer border border-slate-700/30 flex items-center justify-center gap-1">
                                                                        <Download size={11} /> Export CSV
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        );
                                                    })()}
                                                </div>

                                                {/* Reconstruct + Controls Row */}
                                                <div className="flex flex-wrap items-center gap-3 text-[10px]">
                                                    <span className="flex items-center gap-1.5 text-slate-400">
                                                        <Search size={10} /> Reconstruct Incident
                                                    </span>
                                                    <button type="button" className={`relative w-9 h-5 rounded-full transition cursor-pointer ${forensicMode ? 'bg-emerald-500' : 'bg-slate-700'}`} onClick={() => setForensicMode(!forensicMode)}>
                                                        <span className={`absolute top-0.5 ${forensicMode ? 'right-0.5' : 'left-0.5'} w-4 h-4 rounded-full bg-white shadow transition-all`} />
                                                    </button>
                                                    <button type="button" className="text-slate-400 hover:text-white px-2 py-1 bg-slate-800/40 border border-slate-700/30 rounded-md transition cursor-pointer">Saved Views…</button>
                                                    <button type="button" className="flex items-center gap-1 text-slate-400 hover:text-white px-2 py-1 bg-slate-800/40 border border-slate-700/30 rounded-md transition cursor-pointer"><Download size={9} /> Export Logs…</button>
                                                </div>

                                                {/* ═══ Retention Bar ═══ */}
                                                <div className="flex flex-wrap items-center gap-3 py-2 px-3 bg-indigo-500/5 border border-indigo-500/15 rounded-xl text-[10px]">
                                                    <span className="text-indigo-400/80 flex items-center gap-1"><Clock size={10} /> Retention</span>
                                                    <span className="text-slate-400">Policy: 365 Days (Extended)</span>
                                                    <span className="flex items-center gap-1">
                                                        <span className={`w-2 h-2 rounded-full ${forensicMode ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                                                        <span className="text-slate-300 font-semibold">Forensic Mode: {forensicMode ? 'ON' : 'OFF'}</span>
                                                    </span>
                                                    <button type="button" className="text-indigo-400 hover:text-indigo-300 transition cursor-pointer ml-auto">Retention Settings</button>
                                                </div>

                                                {/* ═══ Bottom Bar Controls ═══ */}
                                                <div className="flex items-center justify-between py-2 px-3 bg-slate-800/30 border border-slate-700/40 rounded-xl text-xs">
                                                    <div className="flex items-center gap-2">
                                                        <button type="button" className="px-3 py-1.5 rounded-lg bg-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-700 transition font-semibold cursor-pointer">Reset</button>
                                                        <button type="button" className="px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 transition font-semibold cursor-pointer flex items-center gap-1"><Save size={11} /> Save</button>
                                                        <button type="button" className="px-3 py-1.5 rounded-lg bg-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-700 transition font-semibold cursor-pointer flex items-center gap-1"><Download size={11} /> Export Logs</button>
                                                        <button type="button" className="px-3 py-1.5 rounded-lg bg-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-700 transition font-semibold cursor-pointer flex items-center gap-1"><FileText size={11} /> Saved Logs</button>
                                                        <button type="button" className="px-3 py-1.5 rounded-lg bg-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-700 transition font-semibold cursor-pointer flex items-center gap-1"><Eye size={11} /> Saved Views…</button>
                                                    </div>
                                                    <div className="flex items-center gap-2 text-[10px] text-slate-500">
                                                        <select className={selectCls + " !py-0.5 !text-[9px] !w-auto !rounded !pr-4 !bg-transparent !border-slate-700/40"}>
                                                            <option>-4-99</option>
                                                        </select>
                                                        <span>CSV</span>
                                                        <ChevronDown size={10} />
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            )}

                            {/* ═══════════════════════════════════════════ */}
                            {/*  STEP 4: Enable Features                   */}
                            {/* ═══════════════════════════════════════════ */}
                            {step === 4 && (
                                <div className="space-y-3">
                                    {features.map(f => (
                                        <div
                                            key={f.key}
                                            onClick={() => toggleFeature(f.key)}
                                            className={`
                                        group flex items-center gap-4 p-5 rounded-2xl border cursor-pointer transition-all duration-200
                                        ${f.enabled
                                                    ? "bg-indigo-500/8 border-indigo-500/30"
                                                    : "bg-slate-800/20 border-slate-700/30 hover:border-slate-600/50"
                                                }
                                    `}
                                        >
                                            <div className="flex-1">
                                                <h4 className={`text-sm font-bold ${f.enabled ? "text-white" : "text-slate-400"}`}>{f.label}</h4>
                                                <p className={`text-xs mt-0.5 leading-relaxed ${f.enabled ? "text-slate-400" : "text-slate-600"}`}>{f.desc}</p>
                                            </div>
                                            <div className={`
                                        relative w-14 h-8 rounded-full transition-all duration-300 shrink-0
                                        ${f.enabled ? "bg-gradient-to-r from-indigo-500 to-violet-500 shadow-lg shadow-indigo-500/20" : "bg-slate-700"}
                                    `}>
                                                <div className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-all duration-300 ${f.enabled ? "left-[26px]" : "left-1"}`} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* ── Footer Buttons ── */}
                            <div className="flex items-center justify-between pt-8 mt-10 border-t border-slate-800/40">
                                <div>
                                    {step > 0 && (
                                        <button type="button" onClick={handleBack}
                                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-400 hover:text-white bg-slate-800/40 hover:bg-slate-800/60 border border-slate-700/40 transition-all"
                                        >
                                            <ArrowLeft size={16} /> Back
                                        </button>
                                    )}
                                </div>

                                {step < STEPS.length - 1 ? (
                                    <button type="button" onClick={handleSaveAndContinue} disabled={saving}
                                        className="flex items-center gap-2 px-7 py-3 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 shadow-lg shadow-emerald-500/25 hover:shadow-xl hover:shadow-emerald-500/30 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                        {saving ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : <>Save & Continue <ArrowRight size={16} /></>}
                                    </button>
                                ) : (
                                    <button type="button" onClick={handleSaveAndContinue} disabled={saving}
                                        className="flex items-center gap-2 px-7 py-3 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 shadow-lg shadow-indigo-500/25 hover:shadow-xl active:scale-[0.98] transition-all disabled:opacity-60"
                                    >
                                        {saving ? <><Loader2 size={16} className="animate-spin" /> Completing Setup…</> : <><Sparkles size={16} /> Complete Setup</>}
                                    </button>
                                )}
                            </div>

                        </div>{/* end transition wrapper */}
                    </main>
                </div >


                {/* ═══════════════════════════════════════════ */}
                {/*  ADD ROLE MODAL                             */}
                {/* ═══════════════════════════════════════════ */}
                {
                    showAddRoleModal && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
                            <div className="bg-slate-900 border border-slate-700/60 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                                {/* Header */}
                                <div className="flex items-center justify-between p-5 pb-4 border-b border-slate-800/60">
                                    <div>
                                        <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                            <Shield className="text-indigo-400" size={24} />
                                            Add Roles
                                        </h3>
                                        <p className="text-sm text-slate-400 mt-1">Select from pre-configured standard roles.</p>
                                    </div>
                                    <button onClick={() => setShowAddRoleModal(false)} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer">
                                        <X size={20} />
                                    </button>
                                </div>

                                {/* Body */}
                                <div className="p-5 overflow-y-auto space-y-8 flex-1 scrollbar-thin scrollbar-thumb-slate-700">
                                    {loadingRoles ? (
                                        <div className="flex items-center justify-center p-12 text-slate-400">
                                            <Loader2 className="animate-spin mr-2" size={20} /> Loading standard roles...
                                        </div>
                                    ) : availableRoles.length === 0 ? (
                                        <div className="text-center p-8 text-slate-500 text-sm">No role templates found in the system.</div>
                                    ) : (
                                        [
                                            { cat: 'GOVERNANCE', label: 'Governance & Management', color: 'bg-violet-500', iconDefault: Shield },
                                            { cat: 'FRONT_OFFICE', label: 'Front Office', color: 'bg-blue-500', iconDefault: UserCircle },
                                            { cat: 'HOUSEKEEPING', label: 'Housekeeping', color: 'bg-teal-500', iconDefault: Paintbrush },
                                            { cat: 'FNB', label: 'Food & Beverage', color: 'bg-orange-500', iconDefault: Coffee },
                                            { cat: 'MAINTENANCE', label: 'Maintenance', color: 'bg-amber-500', iconDefault: Settings2 },
                                            { cat: 'FINANCE', label: 'Finance & Accounts', color: 'bg-emerald-500', iconDefault: FileText },
                                            { cat: 'SECURITY', label: 'Security', color: 'bg-red-500', iconDefault: ShieldAlert },
                                            { cat: 'ADVANCED', label: 'Advanced & IT', color: 'bg-cyan-500', iconDefault: Zap },
                                        ].map(group => {
                                            const rolesInCat = availableRoles.filter(r => r.category === group.cat);
                                            if (rolesInCat.length === 0) return null;

                                            return (
                                                <div key={group.cat} className="space-y-3">
                                                    <h4 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                                                        <div className={`w-1.5 h-1.5 rounded-full ${group.color}`} />
                                                        {group.label}
                                                    </h4>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                        {rolesInCat.map(role => {
                                                            const isSelected = selectedRolesToAdd.includes(role.code);
                                                            const isAlreadyAdded = rolePerms.some(r => r.roleLabel.toUpperCase() === role.code || r.roleLabel === role.name);
                                                            let Icon = group.iconDefault;

                                                            // Fallback specific visual overrides for iconic roles
                                                            if (role.code === 'OWNER') Icon = Star;
                                                            if (role.code === 'CONCIERGE') Icon = Map;
                                                            if (role.code === 'GENERAL_MANAGER') Icon = Users;

                                                            // Get color names from the Tailwind arbitrary class
                                                            const colorName = group.color.replace('bg-', '').replace('-500', '');

                                                            return (
                                                                <div key={role.code}
                                                                    onClick={() => {
                                                                        if (isAlreadyAdded) return;
                                                                        setSelectedRolesToAdd(prev => isSelected ? prev.filter(id => id !== role.code) : [...prev, role.code])
                                                                    }}
                                                                    className={`
                                                                    relative p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-3
                                                                    ${isAlreadyAdded ? 'bg-slate-800/20 border-slate-700/30 opacity-60 cursor-not-allowed' :
                                                                            isSelected ? `bg-${colorName}-500/10 border-${colorName}-500/30 shadow-[0_0_15px_-3px_var(--tw-shadow-color)] shadow-${colorName}-500/15 bg-gradient-to-br from-${colorName}-500/5 to-transparent` :
                                                                                'bg-slate-800/40 border-slate-700/50 hover:border-slate-600/50 hover:bg-slate-800/60'
                                                                        }
                                                                `}
                                                                >
                                                                    <div className={`mt-0.5 p-2 rounded-lg shrink-0 ${isSelected ? `bg-${colorName}-500/20 text-${colorName}-400` : 'bg-slate-700/50 text-slate-400'}`}>
                                                                        {React.createElement(Icon, { size: 16 })}
                                                                    </div>
                                                                    <div className="flex-1 pr-6">
                                                                        <div className="flex items-center gap-2">
                                                                            <p className={`text-sm font-bold ${isSelected ? `text-${colorName}-200` : 'text-slate-200'}`}>{role.name}</p>
                                                                            {isAlreadyAdded && <span className="text-[10px] uppercase font-bold text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">Added</span>}
                                                                        </div>
                                                                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">{role.description || 'System standard role'}</p>
                                                                    </div>
                                                                    {!isAlreadyAdded && (
                                                                        <div className={`absolute top-4 right-4 flex items-center justify-center w-5 h-5 rounded-full border transition-colors ${isSelected ? `bg-${colorName}-500 border-${colorName}-500` : 'border-slate-600 bg-slate-800/50'}`}>
                                                                            {isSelected && <Check size={12} className="text-white" strokeWidth={3} />}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                </div>
                                            )
                                        })
                                    )}
                                </div>

                                {/* Footer */}
                                <div className="p-5 border-t border-slate-800/60 bg-slate-900/50 flex justify-end gap-3 shrink-0">
                                    <button
                                        onClick={() => {
                                            setShowAddRoleModal(false);
                                            setSelectedRolesToAdd([]);
                                        }}
                                        className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-400 hover:text-white bg-slate-800/50 hover:bg-slate-800 transition-colors border border-slate-700/50 cursor-pointer"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => {
                                            // TODO: We will mock adding the role for now. 
                                            // A real integration would use the real `api.supabase().from('hotel_roles').insert()` route here later.
                                            selectedRolesToAdd.forEach(roleId => {
                                                const labelMap: Record<string, string> = {
                                                    'SUPERVISOR': 'Supervisor',
                                                    'ADMIN': 'Administrator',
                                                    'OWNER': 'Hotel Owner',
                                                    'RECEPTIONIST': 'Receptionist',
                                                    'CONCIERGE': 'Concierge',
                                                    'HOUSEKEEPING_STAFF': 'Housekeeper',
                                                    'KITCHEN': 'Kitchen Staff',
                                                    'RUNNER': 'Runner',
                                                    'SECURITY_GUARD': 'Security Guard'
                                                };
                                                setRolePerms(p => [...p, { roleLabel: labelMap[roleId] || roleId, contact: '', scopes: makeScopes('Global'), perms: makePerms(false) }]);
                                            });
                                            setShowAddRoleModal(false);
                                            setSelectedRolesToAdd([]);
                                        }}
                                        disabled={selectedRolesToAdd.length === 0}
                                        className={`
                                        px-6 py-2.5 rounded-xl text-sm font-bold shadow-lg transition-all flex items-center gap-2
                                        ${selectedRolesToAdd.length > 0
                                                ? 'bg-indigo-500 hover:bg-indigo-400 text-white shadow-indigo-500/20 cursor-pointer'
                                                : 'bg-slate-800 text-slate-500 shadow-none cursor-not-allowed'
                                            }
                                    `}
                                    >
                                        Add Selected Roles
                                        {selectedRolesToAdd.length > 0 && (
                                            <span className="bg-indigo-600 text-white text-xs px-2 py-0.5 rounded-md ml-1">{selectedRolesToAdd.length}</span>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )
                }
                {/* ═══════════════════════════════════════════ */}
                {/*  ADD ROOM TYPE MODAL                         */}
                {/* ═══════════════════════════════════════════ */}
                {
                    isAddRoomModalOpen && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
                            <div className="bg-slate-900 border border-slate-700/60 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                                {/* Header */}
                                <div className="flex flex-col p-5 pb-3 border-b border-slate-800/60 shrink-0 relative">
                                    <button onClick={() => setIsAddRoomModalOpen(false)} className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full bg-slate-800/50 transition-colors">
                                        <X size={16} />
                                    </button>
                                    <h3 className="text-xl font-bold text-white text-center mb-4 mt-2">Add Room Type</h3>

                                    {/* Tabs (Pill style) */}
                                    <div className="flex justify-center mb-5">
                                        <div className="flex p-1 bg-slate-800/40 rounded-full border border-slate-700/30">
                                            {(['recommended', 'all', 'custom'] as const).map(tabKey => (
                                                <button
                                                    key={tabKey}
                                                    onClick={() => setAddRoomTab(tabKey)}
                                                    className={`px-5 py-1.5 text-sm font-semibold capitalize rounded-full transition-all ${addRoomTab === tabKey ? 'bg-indigo-500/20 text-indigo-400 shadow-[0_0_15px_-3px_rgba(99,102,241,0.2)]' : 'text-slate-500 hover:text-slate-300'}`}
                                                >
                                                    {tabKey === 'all' ? 'All Templates' : tabKey}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Search */}
                                    {addRoomTab !== 'custom' && (
                                        <div className="relative w-full">
                                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                                            <input
                                                type="text"
                                                placeholder="Search room templates..."
                                                className="w-full bg-slate-800/40 border border-slate-700/40 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:border-indigo-500/50 focus:bg-slate-800 outline-none transition-all"
                                                value={modalSearch}
                                                onChange={e => setModalSearch(e.target.value)}
                                            />
                                        </div>
                                    )}
                                </div>

                                {/* Modals Body */}
                                <div className="p-5 overflow-y-auto custom-scrollbar flex-1 bg-slate-900/50">
                                    {(addRoomTab === 'recommended' || addRoomTab === 'all') && (
                                        <div className="space-y-3">
                                            <h4 className="text-sm font-bold text-slate-300 mb-2">Suggested Room Types</h4>
                                            <div className="space-y-2">
                                                {SYSTEM_ROOM_TEMPLATES
                                                    .filter(t => addRoomTab === 'all' || RECOMMENDED_ROOM_TYPES.includes(t.code))
                                                    .filter(t => t.name.toLowerCase().includes(modalSearch.toLowerCase()) || t.description.toLowerCase().includes(modalSearch.toLowerCase()))
                                                    .map(tpl => {
                                                        const isSelected = !!selectedTemplates[tpl.code];
                                                        return (
                                                            <div key={tpl.code} className={`flex flex-col rounded-xl border transition-all overflow-hidden ${isSelected ? 'border-indigo-500/30 bg-indigo-500/5' : 'border-slate-800 bg-slate-800/40 hover:bg-slate-800 hover:border-slate-700'}`}>
                                                                {/* Main Row */}
                                                                <div className="flex items-center justify-between p-3.5 cursor-pointer" onClick={() => handleToggleTemplate(tpl)}>
                                                                    <div className="flex items-center gap-4">
                                                                        <div className={`p-2 rounded-lg ${isSelected ? 'bg-indigo-500/10 text-indigo-400' : 'bg-slate-800 text-slate-500'}`}>
                                                                            {tpl.code.includes('SUITE') ? <BedDouble size={20} /> : <Users size={20} />}
                                                                        </div>
                                                                        <div>
                                                                            <div className="flex items-center gap-2">
                                                                                <span className={`text-sm font-bold ${isSelected ? 'text-white' : 'text-slate-300'}`}>{tpl.name}</span>
                                                                                {isSelected && <span className="text-[10px] text-emerald-400 flex items-center gap-0.5"><Check size={12} /> Selected</span>}
                                                                            </div>
                                                                            <span className="text-xs text-slate-500 line-clamp-1">{isSelected ? `Template: Base ${tpl.base_occupancy} | Max ${tpl.max_occupancy}` : tpl.description}</span>
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex items-center gap-4">
                                                                        <span className="text-xs font-mono text-slate-500">Base {tpl.base_occupancy} | Max {tpl.max_occupancy}</span>
                                                                        <div className="flex items-center gap-2">
                                                                            <SwitchToggle active={isSelected} onClick={() => { }} small />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}

                                                {Object.keys(selectedTemplates).length === 0 && (
                                                    <div className="flex justify-between items-center py-4 px-2 mt-4">
                                                        <span className="text-sm font-bold text-slate-500">Don't see your type?</span>
                                                        <button onClick={() => setAddRoomTab('custom')} className="text-sm font-bold text-slate-400 hover:text-white flex items-center gap-2"><span className="text-indigo-400">Switch Custom</span> instead <ArrowRight size={14} /></button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {addRoomTab === 'custom' && (
                                        <div className="space-y-4 max-w-md mx-auto pt-4">
                                            <div className="text-center mb-6">
                                                <div className="inline-flex w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 items-center justify-center text-indigo-400 mb-3">
                                                    <BoxSelect size={24} />
                                                </div>
                                                <h4 className="text-sm font-bold text-white">Create Custom Room</h4>
                                                <p className="text-xs text-slate-400 mt-1">Specify unique terminology like 'Villa' or 'Chalet'.</p>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-slate-400 mb-1.5">Custom Room Name <span className="text-rose-400">*</span></label>
                                                <input
                                                    type="text"
                                                    className={inputCls}
                                                    placeholder="e.g. Garden Villa, Treehouse"
                                                    value={customRoomForm.name}
                                                    onChange={e => setCustomRoomForm({ ...customRoomForm, name: e.target.value })}
                                                    autoFocus
                                                />
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-400 mb-1.5">Base Occupancy</label>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        className={inputCls}
                                                        value={customRoomForm.base_occupancy}
                                                        onChange={e => setCustomRoomForm({ ...customRoomForm, base_occupancy: e.target.value })}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-400 mb-1.5">Max Occupancy</label>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        className={inputCls}
                                                        value={customRoomForm.max_occupancy}
                                                        onChange={e => setCustomRoomForm({ ...customRoomForm, max_occupancy: e.target.value })}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Footer */}
                                <div className="p-4 border-t border-slate-800/60 bg-slate-900/80 flex justify-end gap-3 shrink-0">
                                    <button onClick={() => setIsAddRoomModalOpen(false)} className="px-5 py-2.5 text-sm font-bold text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors">
                                        Cancel
                                    </button>
                                    {addRoomTab === 'custom' ? (
                                        <button
                                            onClick={handleAddCustomRoomType}
                                            disabled={!customRoomForm.name.trim()}
                                            className="px-6 py-2.5 text-sm font-bold text-white bg-indigo-500 hover:bg-indigo-400 rounded-xl shadow-lg shadow-indigo-500/20 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            Add Custom Type
                                        </button>
                                    ) : (
                                        <button
                                            onClick={handleAddSelectedTemplates}
                                            disabled={Object.keys(selectedTemplates).length === 0}
                                            className="px-6 py-2.5 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-500 border border-emerald-500 shadow-lg shadow-emerald-500/20 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                        >
                                            Add Selected {Object.keys(selectedTemplates).length > 0 && <span className="flex items-center justify-center bg-white text-emerald-700 rounded-full w-5 h-5 text-xs">{Object.keys(selectedTemplates).length}</span>}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )
                }
                {/* ═══════════════════════════════════════════ */}
                {/*  EDIT ROOM TYPE MODAL                        */}
                {/* ═══════════════════════════════════════════ */}
                {/*  EDIT ROOM TYPE MODAL                        */}
                {/* ═══════════════════════════════════════════ */}
                {
                    editingRoomTypeIdx !== null && roomTypes[editingRoomTypeIdx] && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
                            <div className="bg-slate-900 border border-slate-700/60 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col pt-5">
                                <div className="px-6 pb-2">
                                    <h3 className="text-lg font-bold text-white mb-1">Edit Room Type</h3>
                                    <p className="text-xs text-slate-400">Modify the settings for this room category.</p>
                                </div>

                                <div className="px-6 py-4 space-y-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 mb-1.5">Room Name</label>
                                        <input
                                            type="text"
                                            className={inputCls}
                                            value={roomTypes[editingRoomTypeIdx].name}
                                            onChange={e => updateRoomType(editingRoomTypeIdx, "name", e.target.value)}
                                            autoFocus
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-400 mb-1.5">Base Occupancy</label>
                                            <input
                                                type="number"
                                                min="1"
                                                className={inputCls}
                                                value={roomTypes[editingRoomTypeIdx].base_occupancy}
                                                onChange={e => updateRoomType(editingRoomTypeIdx, "base_occupancy", e.target.value)}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-400 mb-1.5">Max Occupancy</label>
                                            <input
                                                type="number"
                                                min="1"
                                                className={inputCls}
                                                value={roomTypes[editingRoomTypeIdx].max_occupancy}
                                                onChange={e => updateRoomType(editingRoomTypeIdx, "max_occupancy", e.target.value)}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="p-4 bg-slate-900/80 border-t border-slate-800 flex justify-end gap-3 shrink-0">
                                    <button onClick={() => setEditingRoomTypeIdx(null)} className="px-5 py-2 text-sm font-bold text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors">
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => setEditingRoomTypeIdx(null)}
                                        className="px-6 py-2 text-sm font-bold text-white bg-indigo-500 hover:bg-indigo-400 rounded-xl shadow-lg shadow-indigo-500/20 active:scale-95 transition-all"
                                    >
                                        Save Changes
                                    </button>
                                </div>
                            </div>
                        </div>
                    )
                }

                {/* ═══════════════════════════════════════════ */}
                {/*  STAFF ADD/EDIT MODAL                         */}
                {/* ═══════════════════════════════════════════ */}
                {
                    isStaffModalOpen && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md">
                            <div className="bg-[#1e202e] border border-slate-700/60 rounded-[28px] w-full max-w-lg shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
                                {/* Header */}
                                <div className="px-8 pt-8 pb-4 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 p-8 opacity-5">
                                        <UserPlus size={120} className="text-indigo-500 rotate-12" />
                                    </div>
                                    <div className="relative z-10">
                                        <div className="flex items-center gap-3 mb-2">
                                            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/20">
                                                {editingStaffId ? <Pencil size={20} /> : <UserPlus size={20} />}
                                            </div>
                                            <h3 className="text-xl font-bold text-white">{editingStaffId ? "Edit Staff Member" : "Invite Staff Member"}</h3>
                                        </div>
                                        <p className="text-sm text-slate-400">{editingStaffId ? "Update existing staff member's details and roles." : "Onboard a new team member by sending them an invitation."}</p>
                                    </div>
                                </div>

                                {/* Content */}
                                <div className="px-8 py-4 space-y-6 max-h-[70vh] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                        <div className="space-y-1.5">
                                            <label className={labelCls}>Full Name</label>
                                            <div className="relative">
                                                <Users className="absolute left-3.5 top-3.5 text-slate-500" size={16} />
                                                <input
                                                    type="text"
                                                    placeholder="John Doe"
                                                    className={`${inputCls} pl-11`}
                                                    value={staffForm.name || ""}
                                                    onChange={e => setStaffForm(p => ({ ...p, name: e.target.value }))}
                                                    autoFocus
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className={labelCls}>Email Address</label>
                                            <div className="relative">
                                                <Mail className="absolute left-3.5 top-3.5 text-slate-500" size={16} />
                                                <input
                                                    type="email"
                                                    placeholder="john@example.com"
                                                    className={`${inputCls} pl-11`}
                                                    value={staffForm.email || ""}
                                                    onChange={e => setStaffForm(p => ({ ...p, email: e.target.value }))}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                        <div className="space-y-1.5">
                                            <label className={labelCls}>Phone Number</label>
                                            <div className="relative">
                                                <Phone className="absolute left-3.5 top-3.5 text-slate-500" size={16} />
                                                <input
                                                    type="tel"
                                                    placeholder="+91 98765 43210"
                                                    className={`${inputCls} pl-11`}
                                                    value={staffForm.phone || ""}
                                                    onChange={e => setStaffForm(p => ({ ...p, phone: e.target.value }))}
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className={labelCls}>Primary Role</label>
                                            <div className="relative">
                                                <Shield className="absolute left-3.5 top-3.5 text-slate-500" size={16} />
                                                <select
                                                    className={`${selectCls} pl-11 pr-10`}
                                                    value={staffForm.role || ""}
                                                    onChange={e => setStaffForm(p => ({ ...p, role: e.target.value }))}
                                                    style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'%2364748b\' viewBox=\'0 0 24 24\'%3E%3Cpath d=\'M7 10l5 5 5-5z\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.75rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em' }}
                                                >
                                                    {rolePerms.map(rp => rp.roleLabel).filter(Boolean).map(r => <option key={r} value={r} className="bg-slate-800">{r}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-5">
                                        <div className="space-y-1.5">
                                            <label className={labelCls}>Staff Status</label>
                                            <div className="flex flex-wrap gap-2">
                                                {["Active", "Suspended", "Terminated"].map(status => (
                                                    <button
                                                        key={status}
                                                        type="button"
                                                        onClick={() => setStaffForm(p => ({ ...p, status: status as any }))}
                                                        className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${staffForm.status === status ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300' : 'bg-slate-800/40 border-slate-700/50 text-slate-500 hover:border-slate-600'}`}
                                                    >
                                                        {status}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Footer */}
                                <div className="px-8 py-6 mb-2 bg-[#1a1c27]/50 border-t border-slate-700/40 flex items-center justify-end gap-3 mt-4">
                                    <button
                                        onClick={() => { setIsStaffModalOpen(false); setEditingStaffId(null); }}
                                        className="px-6 py-2.5 text-sm font-bold text-slate-400 hover:text-white hover:bg-slate-800/60 rounded-xl transition-all"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleStaffSubmit}
                                        className="flex items-center gap-2 px-8 py-2.5 bg-indigo-500 hover:bg-indigo-400 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-500/20 active:scale-95 transition-all"
                                    >
                                        {editingStaffId ? <Save size={16} /> : <Plus size={16} />}
                                        {editingStaffId ? "Save Changes" : "Send Invite"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )
                }
            </div >
        </div >
    );
}

/* ═══════════════════════════════════════════ */
/*  Sub-components                            */
/* ═══════════════════════════════════════════ */
function Section({ emoji, title, children }: { emoji: string; title: string; children: React.ReactNode }) {
    return (
        <section className="group">
            <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-2xl bg-slate-800/40 border border-slate-700/50 flex items-center justify-center text-xl shadow-lg ring-4 ring-slate-900 group-hover:bg-indigo-500/10 group-hover:border-indigo-500/20 group-hover:text-indigo-400 transition-all duration-500">
                    {emoji}
                </div>
                <div>
                    <h3 className="text-lg font-bold text-white tracking-tight leading-none mb-1 group-hover:text-indigo-300 transition-colors duration-500">{title}</h3>
                    <div className="h-[2px] w-8 bg-indigo-500/40 rounded-full group-hover:w-12 transition-all duration-500"></div>
                </div>
            </div>
            <div className="bg-slate-900/30 border border-slate-800/40 rounded-[32px] p-8 shadow-2xl backdrop-blur-sm relative overflow-hidden group-hover:border-indigo-500/10 transition-colors duration-500">
                {/* Subtle Glow */}
                <div className="absolute -top-24 -right-24 w-48 h-48 bg-indigo-500/5 blur-[100px] pointer-events-none"></div>
                <div className="relative z-10">
                    {children}
                </div>
            </div>
        </section>
    );
}

function DarkToggle({ active, onClick, small }: { active: boolean; onClick: () => void; small?: boolean }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`
                flex items-center justify-center gap-1.5 rounded-xl border transition-all duration-200
                ${small ? "px-2 py-1.5 text-xs font-bold w-full" : "w-full px-4 py-3 text-sm font-bold"}
                ${active
                    ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-300"
                    : "bg-slate-800/40 border-slate-700/40 text-slate-500 hover:border-slate-600 text-slate-500"
                }
            `}
        >
            {active ? (small ? "✓" : "✓ YES") : (small ? "✗" : "✗ NO")}
        </button>
    );
}

function SwitchToggle({ active, onClick, small }: { active: boolean; onClick: () => void; small?: boolean }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`
                relative shrink-0 rounded-full transition-all duration-300 cursor-pointer
                ${small ? "w-8 h-[18px]" : "w-10 h-[22px]"}
                ${active ? "bg-gradient-to-r from-emerald-500 to-teal-500 shadow-sm shadow-emerald-500/30" : "bg-slate-600"}
            `}
        >
            <div className={`absolute top-[2px] rounded-full bg-white shadow transition-all duration-300 ${small ? "w-[14px] h-[14px]" : "w-[18px] h-[18px]"} ${active ? (small ? "left-[14px]" : "left-[18px]") : "left-[2px]"}`} />
        </button>
    );
}
