// web/src/hooks/useOwnerKpis.ts
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_ANON_KEY!
)

type KpiRow = {
  hotel_id: string
  as_of_date: string
  occupied_today: number
  orders_today: number
  revenue_today: number
  pickup_7d: number
  avg_rating_30d: number | null
  updated_at: string
}

export function useOwnerKpis(hotelId: string | null) {
  const [data, setData] = useState<KpiRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!hotelId) return
    let unsub = () => {}

    ;(async () => {
      // initial load
      const { data: row, error } = await supabase
        .from('owner_dashboard_kpis')
        .select('*')
        .eq('hotel_id', hotelId)
        .maybeSingle()

      if (error) setError(error)
      else setData(row ?? null)
      setLoading(false)

      // realtime updates
      const channel = supabase
        .channel('kpi-stream')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'owner_dashboard_kpis', filter: `hotel_id=eq.${hotelId}` },
          (payload) => setData((payload.new as KpiRow) ?? null)
        )
        .subscribe()

      unsub = () => supabase.removeChannel(channel)
    })()

    return () => unsub()
  }, [hotelId])

  return { data, loading, error }
}
