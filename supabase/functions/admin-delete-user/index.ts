/**
 * supabase/functions/admin-delete-user/index.ts
 *
 * Hard-deletes an auth.users row (and all cascading data) using the
 * service-role key. Only callable by master_admin — verified by checking
 * the caller's JWT against get_my_role() before any destructive action.
 *
 * Deploy:
 *   supabase functions deploy admin-delete-user --no-verify-jwt
 *   (JWT is verified manually inside the function so we can return a
 *    structured error instead of a Supabase-generated 401.)
 *
 * Request body: { "userId": "<uuid>" }
 * Response:     { "ok": true } | { "error": "<message>" }
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── 1. Verify caller is authenticated ────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing authorization header' }, 401);
    }

    // Caller-scoped client (uses caller's JWT — respects RLS)
    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // ── 2. Verify caller is master_admin ─────────────────────────────────────
    const { data: roleData, error: roleErr } = await callerClient.rpc('get_my_role');
    if (roleErr || roleData !== 'master_admin') {
      return json({ error: 'Forbidden: master_admin role required' }, 403);
    }

    // ── 3. Parse target userId ────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const userId: string = body?.userId;
    if (!userId || typeof userId !== 'string') {
      return json({ error: 'Missing or invalid userId in request body' }, 400);
    }

    // ── 4. Hard-delete via service-role admin API ─────────────────────────────
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteErr) {
      console.error('auth.admin.deleteUser error:', deleteErr);
      return json({ error: deleteErr.message }, 500);
    }

    return json({ ok: true });
  } catch (err) {
    console.error('Unexpected error:', err);
    return json({ error: 'Internal server error' }, 500);
  }
});

// ─── helpers ─────────────────────────────────────────────────────────────────
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
