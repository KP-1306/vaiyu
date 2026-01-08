import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';

// ----------------------------------------------------------------------
// Mock Data (based on screenshot)
// ----------------------------------------------------------------------

const STAFF_LIST = [
    { id: '1', name: 'Sophia Ramirez', role: 'Housekeeping / Maintenance', avatar: 'https://i.pravatar.cc/150?u=1', shift: '7:00 AM - 3:00 PM', zone: 'Floor 3' },
    { id: '2', name: 'Emily Johnson', role: 'Housekeeping', avatar: 'https://i.pravatar.cc/150?u=2', shift: '3:00 PM - 11:00 PM', zone: 'Pool Area' },
    { id: '3', name: 'Daniel Lee', role: 'Front Desk / Housekeeping', avatar: 'https://i.pravatar.cc/150?u=3', shift: '11:00 PM - 7:00 AM', zone: null },
    { id: '4', name: 'Mark Patel', role: 'Engineering / Housekeeping', avatar: 'https://i.pravatar.cc/150?u=4', shift: '11:00 PM - 7:00 AM', zone: null },
    { id: '5', name: 'Linda Wong', role: 'Food & Beverage', avatar: 'https://i.pravatar.cc/150?u=5', shift: null, zone: null },
];

const SHIFTS = [
    { id: 's1', staffId: '1', start: '07:00', end: '15:00', color: 'bg-green-600', label: '7:00 AM - 3:00 PM' },
    { id: 's2', staffId: '2', start: '15:00', end: '23:00', color: 'bg-purple-600', label: '3:00 PM - 11:00 PM' },
    { id: 's3', staffId: '3', start: '23:00', end: '07:00', color: 'bg-blue-700', label: '11:00 PM - 7:00 AM' },
    { id: 's4', staffId: '4', start: '23:00', end: '07:00', color: 'bg-blue-700', label: '11:00 PM - 7:00 AM' },
];

// ... (rest of imports/helpers)

export default function OwnerStaffShifts() {
    const { slug } = useParams();
    const [currentDate, setCurrentDate] = useState(new Date('2024-08-26'));

    const dashboardLink = slug ? `/owner/${slug}` : '/owner';

    return (
        <div className="flex h-screen flex-col bg-slate-50 font-sans text-slate-900">
            {/* Header / Breadcrumb */}
            <header className="flex h-14 items-center border-b border-slate-200 bg-white px-4 shadow-sm">
                <div className="flex items-center gap-2 text-sm">
                    <Link to={dashboardLink} className="font-medium text-slate-500 hover:text-slate-800">
                        Dashboard
                    </Link>
                    <span className="text-slate-300">›</span>
                    <span className="font-semibold text-slate-900">Staff Roster</span>
                </div>
            </header>

            <div className="flex flex-1 gap-4 overflow-hidden p-4">

                {/* LEFT SIDEBAR: Staff Roster Navigation */}
                <div className="flex w-64 flex-col gap-6 rounded-xl bg-white p-4 shadow-sm">
                    <div>
                        <h2 className="mb-4 text-lg font-bold text-slate-800">Staff Roster</h2>

                        <div className="mb-1 text-xs font-semibold text-slate-500">Daily Shifts</div>
                        <div className="space-y-1">
                            <button className="flex w-full items-center rounded-md bg-blue-700 px-3 py-2 text-left text-sm font-medium text-white shadow-sm">
                                <span className="mr-2 opacity-80">📅</span> Daily Shifts
                            </button>
                            <button className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-50">
                                <span className="mr-2 opacity-70">📄</span> Shift History
                            </button>
                        </div>

                        <hr className="my-4 border-slate-100" />

                        <div className="mb-2 text-sm font-semibold text-slate-800">Today</div>
                        <div className="space-y-1">
                            <button className="flex w-full items-center justify-between rounded-md bg-slate-100 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-200">
                                <div className="flex items-center">
                                    <span className="mr-2 opacity-70">👤</span> Weekly Roster
                                </div>
                                <span className="text-slate-400">👆</span>
                            </button>
                            <div className="flex items-center justify-center gap-1.5 py-1 text-[10px] text-slate-500">
                                <span className="text-xs">🔒</span> Manager access required
                            </div>
                        </div>

                        <hr className="my-4 border-slate-100" />
                    </div>

                    <div>
                        <h3 className="mb-2 text-sm font-semibold text-slate-500">Today</h3>
                        <div className="text-3xl font-bold text-slate-900">19 <span className="text-lg font-normal text-slate-500">Staff on Shift</span></div>
                    </div>

                    <div>
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Currently Active</h3>
                        <div className="flex items-center gap-2 py-1 text-sm font-medium text-slate-700">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-green-600">👤</span>
                            14 On Shift
                        </div>
                        <div className="flex items-center gap-2 py-1 text-sm font-medium text-slate-700">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-slate-500">👤</span>
                            6 Off Duty
                        </div>
                    </div>
                </div>

                {/* MAIN CONTENT: Shift Timeline */}
                <div className="flex flex-1 flex-col rounded-xl bg-white shadow-sm">
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                        <div className="flex items-center gap-4">
                            <h2 className="text-xl font-bold text-slate-800">Today's Shifts</h2>
                            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-700">
                                <button className="text-slate-400 hover:text-slate-600">&lt;</button>
                                <span>Monday, Aug 26, 2024</span>
                                <button className="text-slate-400 hover:text-slate-600">&gt;</button>
                            </div>
                        </div>
                        <button className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800">
                            + Assign Shifts
                        </button>
                    </div>

                    {/* Calendar Days Header (Mock) */}
                    <div className="grid grid-cols-7 border-b border-slate-100 text-center text-sm">
                        {['MON', 'Tue 27', 'Wed 28', 'Thu 29', 'Fri 30', 'Sat 31', 'Sun 1'].map((day, i) => (
                            <div key={day} className={`py-3 font-medium ${i === 0 ? 'border-b-2 border-blue-600 bg-blue-50/50 text-blue-700' : 'text-slate-500'}`}>
                                {day}
                            </div>
                        ))}
                    </div>

                    {/* Timeline Rows */}
                    <div className="flex-1 overflow-y-auto p-4">
                        <div className="flex flex-col gap-4">
                            {/* Time Slot Rows (Simplified Mock) */}

                            {/* 6 AM Row */}
                            <div className="flex items-center gap-4">
                                <div className="w-16 text-right text-xs font-bold text-slate-400">6 AM</div>
                                <div className="flex-1 rounded-md bg-slate-50 p-1">
                                    {/* Shift Bar with Tooltip */}
                                    <div className="relative w-1/2 rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:z-10 group">
                                        Sophia Ramirez 7:00 AM - 3:00 PM

                                        {/* Tooltip */}
                                        <div className="absolute left-8 top-full z-20 mt-2 w-48 rounded-lg border border-slate-200 bg-white p-2 shadow-xl">
                                            {/* Little triangular arrow */}
                                            <div className="absolute -top-1.5 left-4 h-3 w-3 rotate-45 border-l border-t border-slate-200 bg-white"></div>

                                            <div className="relative z-10">
                                                <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                                                    <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                                                    7:00 AM - 3:00 PM
                                                </div>
                                                <div className="mt-0.5 ml-4 text-[11px] text-slate-500">
                                                    Zone: Floor 3
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* 8 AM Row */}
                            <div className="flex items-center gap-4">
                                <div className="w-16 text-right text-xs font-bold text-slate-400">8 AM</div>
                                <div className="flex-1 rounded-md bg-slate-50 p-1 relative">
                                    <div className="flex w-2/3 items-center justify-between rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm">
                                        <span>Emily Johnson 3:00 PM - 11:00 PM</span>
                                        <button className="ml-2 text-white/80 hover:text-white">✕</button>
                                    </div>
                                </div>
                            </div>

                            {/* 10 AM Row */}
                            <div className="flex items-center gap-4">
                                <div className="w-16 text-right text-xs font-bold text-slate-400">10 AM</div>
                                <div className="flex-1 flex gap-2">
                                    <div className="flex-1 rounded-md bg-blue-700 px-3 py-2 text-xs font-medium text-white shadow-sm">
                                        Daniel Lee 11:00 PM - 7:00 AM
                                    </div>
                                    <button className="rounded border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">Assign</button>
                                </div>
                            </div>

                            {/* List View of Staff below timeline */}
                            <div className="mt-6 space-y-2 border-t border-slate-100 pt-6">
                                {STAFF_LIST.map(staff => (
                                    <div key={staff.id} className="flex items-center justify-between rounded-lg border border-slate-100 bg-white p-3 shadow-sm hover:border-slate-200">
                                        <div className="flex items-center gap-3">
                                            <img src={staff.avatar} alt={staff.name} className="h-10 w-10 rounded-full bg-slate-200" />
                                            <div>
                                                <div className="text-sm font-bold text-slate-800">{staff.name}</div>
                                                <div className="text-xs text-slate-500">{staff.role}</div>
                                                {staff.zone && staff.id === '2' && (
                                                    <div className="text-[11px] text-blue-600">
                                                        Zone: {staff.zone}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Right Side Info */}
                                        <div className="flex items-center gap-4">
                                            <div className="text-right">
                                                {staff.shift ? (
                                                    <div className="text-xs font-semibold text-slate-700">{staff.shift}</div>
                                                ) : (
                                                    <div className="text-xs text-slate-300 italic">Not scheduled</div>
                                                )}

                                                {staff.zone && staff.id === '1' && (
                                                    <div className="flex items-center justify-end gap-1 text-[11px] text-blue-600">
                                                        <span>Zone: {staff.zone}</span>
                                                        <span>📍</span>
                                                    </div>
                                                )}
                                            </div>

                                            {(staff.shift || staff.id === '1' || staff.id === '2' || staff.id === '3' || staff.id === '4') ? (
                                                <button className="rounded-md border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600">
                                                    ✕
                                                </button>
                                            ) : (
                                                <button className="rounded border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">Assign</button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>

                        </div>
                    </div>
                </div>

                {/* RIGHT SIDEBAR: Weekly Overview */}
                <div className="hidden w-72 lg:block">
                    <div className="flex flex-col gap-4 rounded-xl bg-white p-4 shadow-sm">
                        <h2 className="mb-2 text-lg font-bold text-slate-800">Weekly Overview</h2>

                        <div>
                            <h3 className="mb-2 text-sm font-semibold text-slate-700">Morning Shifts</h3>
                            <div className="space-y-3">
                                <div>
                                    <div className="mb-1 flex justify-between text-xs text-slate-500">
                                        <span>8 Shifts</span>
                                        <span>7 AM - 3 PM</span>
                                    </div>
                                    <div className="h-2 w-full rounded-full bg-slate-100">
                                        <div className="h-2 w-3/4 rounded-full bg-green-600"></div>
                                    </div>
                                </div>
                                <div>
                                    <div className="mb-1 flex justify-between text-xs text-slate-500">
                                        <span>8 Shifts</span>
                                        <span>3 PM - 11 PM</span>
                                    </div>
                                    <div className="h-2 w-full rounded-full bg-slate-100">
                                        <div className="h-2 w-3/4 rounded-full bg-purple-600"></div>
                                    </div>
                                </div>
                                <div>
                                    <div className="mb-1 flex justify-between text-xs text-slate-500">
                                        <span>6 Shifts</span>
                                        <span>11 PM - 7 AM</span>
                                    </div>
                                    <div className="h-2 w-full rounded-full bg-slate-100">
                                        <div className="h-2 w-1/2 rounded-full bg-blue-700"></div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <button className="mt-2 w-full rounded-lg border border-slate-200 bg-white py-2 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50">
                            📅 View Weekly Roster
                        </button>

                        <button className="w-full rounded-lg bg-white box-border py-2 text-sm font-medium text-slate-600 hover:text-slate-800 flex items-center justify-center gap-2">
                            <span>🕒</span> View Shift History
                        </button>

                    </div>

                    {/* Available Staff Section */}
                    <div className="flex flex-col gap-4 rounded-xl bg-white p-4 shadow-sm mt-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-bold text-slate-800">Available Staff</h2>
                            <button className="text-slate-400 hover:text-slate-600">&gt;</button>
                        </div>

                        {/* Filters */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between text-sm text-slate-600">
                                <span>Hotel Department:</span>
                                <span className="font-medium text-blue-600 cursor-pointer">All De... ▼</span>
                            </div>

                            <div className="relative">
                                <span className="absolute left-3 top-2.5 text-slate-400">👤</span>
                                <select className="w-full appearance-none rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-8 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20">
                                    <option>Select Zone...</option>
                                    <option>Zone A</option>
                                    <option>Zone B</option>
                                </select>
                                <span className="absolute right-3 top-2.5 text-xs text-slate-400 pointer-events-none">▼</span>
                            </div>

                            <div className="relative">
                                <span className="absolute left-3 top-2.5 text-slate-400">🔍</span>
                                <input
                                    type="text"
                                    placeholder="Search staff..."
                                    className="w-full rounded-lg border border-slate-200 py-2 pl-9 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                />
                            </div>
                        </div>

                        <div className="border-t border-slate-100 pt-3">
                            <div className="mb-2 flex items-center justify-between">
                                <h3 className="font-bold text-slate-800">Available Staff <span className="text-sm font-normal text-slate-500">(Today)</span></h3>
                                <button className="text-slate-400 hover:text-slate-600">&gt;</button>
                            </div>

                            <div className="mb-2 text-xs font-medium text-slate-500">Currently On Shift</div>

                            <div className="space-y-3">
                                {STAFF_LIST.map(staff => (
                                    <div key={staff.id} className="flex items-center gap-3 rounded-lg border border-slate-100 p-2 shadow-sm hover:border-slate-200 bg-white">
                                        <img src={staff.avatar} alt={staff.name} className="h-10 w-10 rounded-full bg-slate-200 object-cover" />
                                        <div className="flex-1 overflow-hidden">
                                            <div className="truncate text-sm font-bold text-slate-800">{staff.name}</div>
                                            <div className="truncate text-[10px] text-slate-500">{staff.role.split(' / ')[0]}</div>
                                        </div>

                                        {/* Mock Logic based on ID to match screenshot */}
                                        {(staff.id === '2' || staff.id === '3') ? (
                                            <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-bold text-green-700 uppercase tracking-wide">ON SHIFT</span>
                                        ) : (staff.id === '4' || staff.id === '5') ? (
                                            <button className="rounded border border-blue-200 bg-white px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50">Assign</button>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}
