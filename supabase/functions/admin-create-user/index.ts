// Setup type definitions for built-in Supabase Runtime APIs
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ROLES = ['user', 'master_admin'] as const;
type AllowedRole = (typeof ALLOWED_ROLES)[number];

interface ReqPayload {
  email: string;
  full_name?: string;
  role: AllowedRole;
  mode: 'invite' | 'temp_password';
  temp_password?: string;
}

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

console.info('admin-create-user started');

serve(async (req: Request) => {
  // ── Preflight ───────────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // ── Env guards (do not crash) ───────────────────────────────────────────────
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!SUPABASE_URL) return json({ ok: false, error: 'Missing env var: SUPABASE_URL' }, 500);
  if (!SUPABASE_ANON_KEY) return json({ ok: false, error: 'Missing env var: SUPABASE_ANON_KEY' }, 500);
  if (!SERVICE_ROLE_KEY) return json({ ok: false, error: 'Missing env var: SUPABASE_SERVICE_ROLE_KEY' }, 500);

  try {
    // ── 1) Verify caller is authenticated ─────────────────────────────────────
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    if (!authHeader) {
      return json({ ok: false, error: 'Missing authorization header' }, 401);
    }

    // Caller-scoped client (uses caller JWT — respects RLS)
    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Resolve caller identity early (also used for fallback role check)
    const { data: callerUserData, error: callerErr } = await callerClient.auth.getUser();
    const callerUser = callerUserData?.user;
    if (callerErr || !callerUser) {
      console.error('auth.getUser failed:', callerErr);
      return json({ ok: false, error: 'Could not resolve caller identity' }, 401);
    }

    // ── 2) Verify caller is master_admin ──────────────────────────────────────
    let callerRole: unknown = null;

    // Preferred: RPC
    const { data: rpcRole, error: roleErr } = await callerClient.rpc('get_my_role');
    if (roleErr) {
      console.error('get_my_role rpc failed:', { message: roleErr.message, code: (roleErr as any).code });

      // Fallback: read from user_roles (profiles table has NO role column)
      const { data: ur, error: urErr } = await callerClient
        .from('user_roles')
        .select('role')
        .eq('user_id', callerUser.id)
        .maybeSingle();

      if (urErr) {
        console.error('user_roles fallback failed:', { message: urErr.message, code: (urErr as any).code });
        return json(
          {
            ok: false,
            error: 'Forbidden: master_admin role required',
            details: `get_my_role failed: ${roleErr.message}; user_roles fallback failed: ${urErr.message}`,
          },
          403,
        );
      }

      callerRole = ur?.role ?? null;
    } else {
      callerRole = rpcRole;
    }

    console.info('caller role resolved:', callerRole, '| caller id:', callerUser.id);

    if (callerRole !== 'master_admin') {
      return json({ ok: false, error: 'Forbidden: master_admin role required' }, 403);
    }

    // ── 3) Parse + validate body ──────────────────────────────────────────────
    const body: Partial<ReqPayload> = await req.json().catch(() => ({}));

    const email = (body.email ?? '').trim().toLowerCase();
    const full_name = (body.full_name ?? '').trim();
    const role = (body.role ?? '') as string;
    const mode = (body.mode ?? '') as string;
    const temp_password = (body.temp_password ?? '').trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: 'Invalid email address' }, 400);
    }
    if (!ALLOWED_ROLES.includes(role as AllowedRole)) {
      return json({ ok: false, error: `Invalid role. Allowed: ${ALLOWED_ROLES.join(', ')}` }, 400);
    }
    if (mode !== 'invite' && mode !== 'temp_password') {
      return json({ ok: false, error: 'mode must be "invite" or "temp_password"' }, 400);
    }
    if (mode === 'temp_password' && temp_password.length < 8) {
      return json({ ok: false, error: 'temp_password must be at least 8 characters' });
    }

    // ── 4) Create / invite via service-role admin API ─────────────────────────
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let newUserId: string;

    if (mode === 'invite') {
      const { data: inviteData, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
        data: { full_name: full_name || undefined },
      });

      if (inviteErr) {
        console.error('inviteUserByEmail error:', inviteErr);
        const msg = inviteErr.message.toLowerCase();
        if (msg.includes('already') || msg.includes('exists') || msg.includes('registered')) {
          return json({ ok: false, error: 'A user with that email already exists.' }, 409);
        }
        return json({ ok: false, error: inviteErr.message }, 500);
      }

      newUserId = inviteData.user.id;
    } else {
      const { data: createData, error: createErr } = await adminClient.auth.admin.createUser({
        email,
        password: temp_password,
        email_confirm: true,
        user_metadata: { full_name: full_name || undefined },
      });

      if (createErr) {
        console.error('createUser error:', createErr);
        const msg = createErr.message.toLowerCase();
        if (msg.includes('already') || msg.includes('exists') || msg.includes('registered')) {
          return json({ ok: false, error: 'A user with that email already exists.' }, 409);
        }
        return json({ ok: false, error: createErr.message }, 500);
      }

      newUserId = createData.user.id;
    }

    // ── 5) Upsert profile (best-effort) ───────────────────────────────────────
    try {
      await adminClient
        .from('profiles')
        .upsert(
          { id: newUserId, email, ...(full_name ? { full_name } : {}) },
          { onConflict: 'id' },
        );
    } catch (e) {
      console.error('profiles upsert failed (non-fatal):', e);
    }

    // ── 6) Upsert role in user_roles (best-effort) ────────────────────────────
    try {
      const { error: roleUpsertErr } = await adminClient
        .from('user_roles')
        .upsert({ user_id: newUserId, role }, { onConflict: 'user_id' });

      if (roleUpsertErr) console.error('user_roles upsert error (non-fatal):', roleUpsertErr);
    } catch (e) {
      console.error('user_roles upsert failed (non-fatal):', e);
    }

    // ── 7) Audit log (best-effort) ────────────────────────────────────────────
    try {
      await adminClient.from('admin_audit').insert({
        action: 'create_user',
        actor_id: callerUser.id,
        target_user_id: newUserId,
        target_email: email,
        metadata: { role, mode, full_name: full_name || null },
      });
    } catch (auditErr) {
      console.error('admin_audit insert failed (non-fatal):', auditErr);
    }

    return json({ ok: true, user_id: newUserId, email }, 200);
  } catch (err) {
    console.error('Unexpected error:', err);
    return json({ ok: false, error: 'Internal server error' }, 500);
  }
});

// ─── helpers ──────────────────────────────────────────────────────────────────
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}