import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://nrfdrbqmjwulcwmiztbk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_bDjSvxVG8yVAd7S6T3gO4w_aFPzyc-R";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
