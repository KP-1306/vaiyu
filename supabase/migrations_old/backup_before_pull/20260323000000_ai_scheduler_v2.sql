-- =========================================================
-- AI WORKFORCE ORCHESTRATION ENGINE (V2 BASELINE)
-- =========================================================

create or replace function public.generate_ai_schedule_v2(
  p_week_start date,
  p_zone_id uuid,
  p_demand jsonb,
  p_hotel_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date;
  v_shift_type text;
  v_required int;

  v_result jsonb := '[]'::jsonb;

  v_candidate record;
  v_candidates jsonb;

  v_selected jsonb;
  v_attempt int;

  v_score int;
  v_conflicts int;

  -- in-memory tracking
  v_temp_assignments jsonb := '[]'::jsonb;

begin

  -- =====================================================
  -- LOOP DAYS
  -- =====================================================
  for v_day in 
    select generate_series(p_week_start, p_week_start + 6, interval '1 day')::date
  loop

    for v_shift_type in select * from jsonb_object_keys(p_demand)
    loop

      v_required := (p_demand ->> v_shift_type)::int;

      for i in 1..v_required
      loop

        -- =====================================================
        -- BUILD CANDIDATE LIST (TOP N)
        -- =====================================================
        v_candidates := '[]'::jsonb;

        for v_candidate in
          select 
            hm.id as staff_id,
            sd.department_id,
            sd.priority,
            sd.is_primary
          from public.hotel_members hm
          join public.staff_departments sd 
            on sd.staff_id = hm.id
          where hm.hotel_id = p_hotel_id
            and hm.is_active = true
            and sd.is_active = true
        loop

          v_score := 0;

          -- =========================
          -- SCORING
          -- =========================

          -- department match
          if p_zone_id is not null then
            if exists (
              select 1 from public.hotel_zones z
              where z.id = p_zone_id
                and z.department_id = v_candidate.department_id
            ) then
              v_score := v_score + case when v_candidate.is_primary then 40 else 25 end;
            else
              v_score := v_score - 100;
            end if;
          else
            -- If no specific zone, reward primary departments globally
            v_score := v_score + case when v_candidate.is_primary then 40 else 25 end;
          end if;

          -- priority
          v_score := v_score + (30 - (coalesce(v_candidate.priority, 1) * 10));

          -- workload penalty (temp + real)
          v_score := v_score - (
            select count(*) * 5
            from jsonb_array_elements(v_temp_assignments) x
            where (x->>'staff_id')::uuid = v_candidate.staff_id
          );

          -- fatigue (temp simulation)
          if exists (
            select 1
            from jsonb_array_elements(v_temp_assignments) x
            where (x->>'staff_id')::uuid = v_candidate.staff_id
              and (x->>'shift_date')::date = v_day
          ) then
            v_score := v_score - 50;
          end if;

          -- add to candidate list
          v_candidates := v_candidates || jsonb_build_object(
            'staff_id', v_candidate.staff_id,
            'department_id', v_candidate.department_id,
            'score', v_score
          );

        end loop;

        -- =====================================================
        -- SORT CANDIDATES (TOP 3)
        -- =====================================================
        v_candidates := (
          select jsonb_agg(elem)
          from (
            select elem
            from jsonb_array_elements(v_candidates) elem
            order by (elem->>'score')::int desc
            limit 3
          ) t
        );

        -- =====================================================
        -- TRY BEST → BACKTRACK IF NEEDED
        -- =====================================================
        v_selected := null;

        for v_attempt in 0..coalesce(jsonb_array_length(v_candidates)-1, -1)
        loop

          v_selected := v_candidates -> v_attempt;

          -- simulate conflict count
          v_conflicts := (
            select count(*)
            from jsonb_array_elements(v_temp_assignments) x
            where (x->>'staff_id') = (v_selected->>'staff_id')
              and (x->>'shift_date') = v_day::text
          );

          -- if acceptable → pick
          if v_conflicts = 0 then
            exit;
          end if;

        end loop;

        -- =====================================================
        -- FINALIZE ASSIGNMENT
        -- =====================================================
        if v_selected is not null then

          v_temp_assignments := v_temp_assignments || jsonb_build_object(
            'staff_id', v_selected->>'staff_id',
            'department_id', v_selected->>'department_id',
            'shift_date', v_day,
            'shift_type', v_shift_type
          );

          v_result := v_result || jsonb_build_object(
            'staff_id', v_selected->>'staff_id',
            'department_id', v_selected->>'department_id',
            'shift_date', v_day,
            'shift_type', v_shift_type,
            'score', v_selected->>'score',
            'reason', 'Optimized with conflict minimization'
          );

        else
          v_result := v_result || jsonb_build_object(
            'shift_date', v_day,
            'shift_type', v_shift_type,
            'status', 'unfilled'
          );
        end if;

      end loop;

    end loop;

  end loop;

  return v_result;

end;
$$;
