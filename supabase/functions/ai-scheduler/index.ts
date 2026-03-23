import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { week_start, zone_id, demand, hotel_id } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing Supabase environment variables");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // =====================================================
    // 1. GET BASE STAFF + DEPARTMENT DATA
    // =====================================================
    const { data: staffData, error: staffError } = await supabase
      .from("hotel_members")
      .select(`
        id,
        hotel_id,
        staff_departments (
          department_id,
          priority,
          is_primary,
          is_active
        )
      `)
      .eq("hotel_id", hotel_id)
      .eq("is_active", true);

    if (staffError || !staffData) throw new Error("Failed to fetch staff");

    // =====================================================
    // 2. GET ZONE → DEPARTMENT
    // =====================================================
    let targetDept: string | null = null;
    if (zone_id) {
        const { data: zone, error: zoneError } = await supabase
        .from("hotel_zones")
        .select("department_id")
        .eq("id", zone_id)
        .single();
        if (zoneError || !zone) throw new Error("Zone not found");
        targetDept = zone.department_id;
    }

    // =====================================================
    // 3. BUILD SLOTS (EXPANDING DEMAND TO INDEPENDENT SLOTS)
    // =====================================================
    const slots: any[] = [];
    const weekStartObj = new Date(week_start);

    for (let d = 0; d < 7; d++) {
      const day = new Date(weekStartObj);
      day.setDate(day.getDate() + d);
      const isoDate = day.toISOString().split("T")[0];

      for (const shiftType of Object.keys(demand)) {
        // Support array demand layout UI uses: [{shift_type: 'morning', required: 1}]
        const demandObj = Array.isArray(demand) ? demand.find((x:any) => x.shift_type === shiftType) : null;
        const count = demandObj ? demandObj.required : (demand[shiftType] || 0);

        for (let i = 0; i < count; i++) {
          slots.push({
            id: `${isoDate}-${shiftType}-${i}`,
            shift_date: isoDate,
            shift_type: shiftType,
          });
        }
      }
    }

    // =====================================================
    // 4. BUILD CANDIDATE POOL (FILTERED)
    // =====================================================
    function getCandidates(slot: any) {
      return staffData!
        .map((s: any) => {
          let dept: any;
          if (targetDept) {
            dept = s.staff_departments.find((d: any) => d.department_id === targetDept && d.is_active === true);
          } else {
             // If no zone filter, prioritize primary departments but allow anyone active.
            dept = s.staff_departments.find((d: any) => d.is_primary === true && d.is_active === true) || 
                   s.staff_departments.find((d: any) => d.is_active === true);
          }

          if (!dept) return null;

          return {
            staff_id: s.id,
            department_id: dept.department_id,
            priority: dept.priority,
            is_primary: dept.is_primary,
          };
        })
        .filter(Boolean)
        .slice(0, 15); // Limit candidates per slot for performance
    }

    // =====================================================
    // 5. BEAM SEARCH
    // =====================================================
    const beamWidth = 5;

    let beam = [
      {
        schedule: [],
        score: 0,
      },
    ];

    for (const slot of slots) {
      let newBeam: any[] = [];
      const candidates = getCandidates(slot);

      for (const state of beam) {
        let addedToState = false;

        for (const c of candidates) {
          // 🚫 Prevent duplicate staff in exact same shift block (date + type)
          const alreadyAssigned = state.schedule.some((s: any) => 
            s.staff_id === c.staff_id && s.shift_date === slot.shift_date && s.shift_type === slot.shift_type
          );
          if (alreadyAssigned) continue;

          // 🚫 Prevent immediate overlap fatigue (too many shifts same day)
          const shiftsToday = state.schedule.filter((s:any) => s.staff_id === c.staff_id && s.shift_date === slot.shift_date).length;
          if (shiftsToday >= 2) continue; // max 2 back-to-back allowed

          const { score: deltaScore, explanation } = computeScoreWithReason(state.schedule, c);
          
          const newSchedule = [
            ...state.schedule,
            {
              staff_id: c.staff_id,
              department_id: c.department_id,
              shift_date: slot.shift_date,
              shift_type: slot.shift_type,
              score: deltaScore,
              explanation,
              reason: buildReason(explanation),
              action_reason: "AI auto-scheduler" // Tag for the DB constraint
            },
          ];

          newBeam.push({
            schedule: newSchedule,
            score: state.score + deltaScore,
          });
          addedToState = true;
        }

        // if no candidates could be added to this slot, carry the state forward so we don't drop the beam completely
        if (!addedToState) {
          newBeam.push(state);
        }
      }

      // Keep best schedules only
      newBeam.sort((a, b) => b.score - a.score);
      beam = newBeam.slice(0, beamWidth);
    }

    const best = beam[0];

    // =====================================================
    // 6. FINAL RESPONSE
    // =====================================================
    return new Response(
      JSON.stringify({
        improved: true,
        improved_score: best.score,
        base_score: 0, // Using v2 differential logic via client now
        schedule: best.schedule.map((s:any) => ({...s, status: 'scheduled'})), // Ensure map compat
        total_assignments: best.schedule.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});


// =====================================================
// 🧠 EXPLAINABLE SCORING FUNCTION
// =====================================================
function computeScoreWithReason(schedule: any[], candidate: any) {
  let score = 0;
  const explanation: any = {};
  const staffCount: Record<string, number> = {};

  for (const s of schedule) {
    staffCount[s.staff_id] = (staffCount[s.staff_id] || 0) + 1;
  }

  // 1. Department
  if (candidate.is_primary) {
    score += 40;
    explanation.department = "+40 (primary department match)";
  } else {
    score += 25;
    explanation.department = "+25 (secondary department)";
  }

  // 2. Priority
  const p = candidate.priority || 1;
  const priorityScore = 30 - p * 10;
  score += priorityScore;
  explanation.priority = `+${priorityScore} (priority ${p})`;

  // 3. Workload balance
  const counts = Object.values(staffCount);
  let workloadScore = 0;
  if (counts.length > 0) {
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    workloadScore = 50 - (max - min) * 10;
  }

  // Add penalty if staff member's *own* workload is getting high to artificially distribute
  const ownCount = staffCount[candidate.staff_id] || 0;
  if (ownCount > 3) {
      workloadScore -= (ownCount * 5); // Fatigue
      explanation.workload = `${workloadScore} (approaching fatigue limits)`;
  } else {
      score += workloadScore;
      explanation.workload = `+${workloadScore} (balanced load)`;
  }

  // 4. Assignment reward
  const assignmentScore = 15;
  score += assignmentScore;
  explanation.assignment = `+${assignmentScore} (schedule completion)`;

  return { score, explanation };
}

function buildReason(exp: any) {
  const parts = [];

  if (exp.department?.includes("primary")) {
    parts.push("Primary department match");
  }

  if (exp.workload?.includes("balanced")) {
    parts.push("Balanced workload");
  }

  if (exp.priority && !exp.priority.includes("(-")) {
    parts.push("High priority staff");
  }

  return parts.join(" + ") || "Best available match";
}
