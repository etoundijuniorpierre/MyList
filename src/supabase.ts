import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const isConfigured = Boolean(url && key)
export const supabase = isConfigured ? createClient(url!, key!, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
}) : null
