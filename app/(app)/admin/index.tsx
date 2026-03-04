/**
 * app/(app)/admin/index.tsx
 *
 * Master Admin Panel — visible only to master_admin role.
 * Tabs: USERS | DEVELOPMENTS | UNITS
 *
 * - Users: list all profiles + roles; toggle role between user/master_admin.
 * - Developments: list all developments across all users.
 * - Units: list all units across all users.
 *
 * Data is fetched directly via Supabase. The master_admin RLS overlay
 * policies (Phase 2) ensure all rows are visible.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoleContext, AppRole } from '../../../src/lib/RoleContext';
import { useAuth } from '../../../src/hooks/useAuth';
import { useDialog } from '../../../src/lib/dialog';
import { supabase } from '../../../src/lib/supabase';
import { Development, Unit } from '../../../src/types';
import { FunctionsHttpError } from '@supabase/supabase-js';

// ─── constants ────────────────────────────────────────────────────────────────
const ACCENT  = '#00d4ff';
const BG      = '#070714';
const CARD_BG = '#0d0d22';
const BORDER  = '#1a1a3a';
const GREEN   = '#00ff88';
const YELLOW  = '#ffe044';
const RED     = '#ff4444';
const PLACEHOLDER = '#b8c1df';

type AdminTab = 'users' | 'developments' | 'units';

interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
}

// ─── sub-components ───────────────────────────────────────────────────────────
function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.countBadge}>
        <Text style={styles.countBadgeText}>{count}</Text>
      </View>
    </View>
  );
}

function UserCard({
  user,
  isSelf,
  onToggleRole,
  onDelete,
}: {
  user: UserRow;
  isSelf: boolean;
  onToggleRole: () => void;
  onDelete: () => void;
}) {
  const isAdmin = user.role === 'master_admin';
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardName} numberOfLines={1}>
          {user.full_name ?? '(no name)'}{isSelf ? ' (you)' : ''}
        </Text>
        <View style={[styles.rolePill, isAdmin && styles.rolePillAdmin]}>
          <Text style={[styles.rolePillText, isAdmin && styles.rolePillTextAdmin]}>
            {isAdmin ? 'MASTER' : 'USER'}
          </Text>
        </View>
      </View>
      <Text style={styles.cardSub} numberOfLines={1}>{user.email}</Text>
      <View style={styles.cardFooter}>
        <TouchableOpacity
          style={[styles.actionBtn, isSelf && styles.actionBtnDisabled]}
          onPress={isSelf ? undefined : onToggleRole}
          disabled={isSelf}
        >
          <Text style={styles.actionBtnText}>
            {isAdmin ? 'DEMOTE → USER' : 'PROMOTE → MASTER'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnDanger, isSelf && styles.actionBtnDisabled]}
          onPress={isSelf ? undefined : onDelete}
          disabled={isSelf}
        >
          <Text style={styles.actionBtnText}>DELETE</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function DevCard({ dev, onDelete }: { dev: Development & { ownerEmail?: string }; onDelete: () => void }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardName} numberOfLines={1}>{dev.name}</Text>
        <View style={[styles.rolePill, { backgroundColor: 'rgba(0,255,136,0.12)' }]}>
          <Text style={[styles.rolePillText, { color: GREEN }]}>{dev.type.toUpperCase()}</Text>
        </View>
      </View>
      {dev.ownerEmail ? (
        <Text style={styles.cardSub} numberOfLines={1}>Owner: {dev.ownerEmail}</Text>
      ) : null}
      {dev.city || dev.state ? (
        <Text style={styles.cardSub} numberOfLines={1}>
          {[dev.city, dev.state].filter(Boolean).join(', ')}
        </Text>
      ) : null}
      <View style={styles.cardFooter}>
        <TouchableOpacity style={[styles.actionBtn, styles.actionBtnDanger]} onPress={onDelete}>
          <Text style={styles.actionBtnText}>DELETE</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function UnitCard({ unit, onDelete }: { unit: Unit & { ownerEmail?: string }; onDelete: () => void }) {
  const statusColor =
    unit.status === 'available' ? GREEN : unit.status === 'reserved' ? YELLOW : RED;
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardName} numberOfLines={1}>{unit.name}</Text>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
      </View>
      {unit.ownerEmail ? (
        <Text style={styles.cardSub} numberOfLines={1}>Owner: {unit.ownerEmail}</Text>
      ) : null}
      <Text style={[styles.cardSub, { color: statusColor }]}>{unit.status.toUpperCase()}</Text>
      <View style={styles.cardFooter}>
        <TouchableOpacity style={[styles.actionBtn, styles.actionBtnDanger]} onPress={onDelete}>
          <Text style={styles.actionBtnText}>DELETE</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── main screen ──────────────────────────────────────────────────────────────
export default function AdminScreen() {
  const { isMaster } = useRoleContext();
  const { user: currentUser } = useAuth();
  const dialog = useDialog();
  const insets = useSafeAreaInsets();
  const safeBottom = insets.bottom + 24;

  const [tab, setTab] = useState<AdminTab>('users');

  // ─ Create User modal state ────────────────────────────────────────────────
  const [createVisible, setCreateVisible] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createEmail, setCreateEmail]     = useState('');
  const [createName, setCreateName]       = useState('');
  const [createRole, setCreateRole]       = useState<AppRole>('user');
  const [createMode, setCreateMode]       = useState<'invite' | 'temp_password'>('invite');
  const [createPass, setCreatePass]       = useState('');

  const openCreateModal = () => {
    setCreateEmail(''); setCreateName(''); setCreateRole('user');
    setCreateMode('invite'); setCreatePass('');
    setCreateVisible(true);
  };

  const handleCreateUser = useCallback(async () => {
    const email = createEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await dialog.alert({ title: 'Validation', message: 'Enter a valid email address.' });
      return;
    }
    if (createMode === 'temp_password' && createPass.trim().length < 8) {
      await dialog.alert({ title: 'Validation', message: 'Password must be at least 8 characters.' });
      return;
    }
    setCreateLoading(true);

    // Explicitly get the session token so the Edge Function always receives it.
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) {
      setCreateLoading(false);
      await dialog.alert({ title: 'Auth Error', message: 'No active session. Please sign in again.' });
      return;
    }

    const { data: fnData, error: fnError } = await supabase.functions.invoke('admin-create-user', {
      body: {
        email,
        full_name:     createName.trim() || undefined,
        role:          createRole,
        mode:          createMode,
        temp_password: createMode === 'temp_password' ? createPass.trim() : undefined,
      },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    setCreateLoading(false);

    if (fnError) {
      let message = fnError.message;
      if (fnError instanceof FunctionsHttpError) {
        try { const body = await fnError.context.json(); message = body?.error ?? message; } catch {}
      }
      console.error('[admin-create-user] error:', message);
      await dialog.alert({ title: 'Error', message });
      return;
    }
    setCreateVisible(false);
    await dialog.alert({
      title: 'Success',
      message: createMode === 'invite'
        ? `Invite sent to ${email}.`
        : `User ${email} created with temporary password.`,
    });
    fetchUsers();
  }, [createEmail, createName, createRole, createMode, createPass, dialog, fetchUsers]);

  // ─ Users data ─────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    // Fetch all profiles
    const { data: profiles, error: pErr } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .order('email');

    if (pErr || !profiles) { setUsersLoading(false); return; }

    // Fetch all roles
    const { data: roles } = await supabase
      .from('user_roles')
      .select('user_id, role');

    const roleMap: Record<string, AppRole> = {};
    for (const r of roles ?? []) roleMap[r.user_id] = r.role as AppRole;

    setUsers(
      profiles.map((p: { id: string; email: string; full_name: string | null }) => ({
        id: p.id,
        email: p.email,
        full_name: p.full_name,
        role: roleMap[p.id] ?? 'user',
      }))
    );
    setUsersLoading(false);
  }, []);

  // ─ Developments data ──────────────────────────────────────────────────────
  const [devs, setDevs] = useState<(Development & { ownerEmail?: string })[]>([]);
  const [devsLoading, setDevsLoading] = useState(true);

  const fetchDevs = useCallback(async () => {
    setDevsLoading(true);
    const { data, error } = await supabase
      .from('developments')
      .select('*')
      .order('created_at', { ascending: false });

    if (error || !data) { setDevsLoading(false); return; }

    // Attach owner email from profiles
    const uids = [...new Set((data as Development[]).map((d) => d.user_id))];
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, email')
      .in('id', uids);
    const emailMap: Record<string, string> = {};
    for (const p of profs ?? []) emailMap[p.id] = p.email;

    setDevs((data as Development[]).map((d) => ({ ...d, ownerEmail: emailMap[d.user_id] })));
    setDevsLoading(false);
  }, []);

  // ─ Units data ─────────────────────────────────────────────────────────────
  const [units, setUnits] = useState<(Unit & { ownerEmail?: string })[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(true);

  const fetchUnits = useCallback(async () => {
    setUnitsLoading(true);
    const { data, error } = await supabase
      .from('units')
      .select('*')
      .order('created_at', { ascending: false });

    if (error || !data) { setUnitsLoading(false); return; }

    const uids = [...new Set((data as Unit[]).map((u) => u.user_id))];
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, email')
      .in('id', uids);
    const emailMap: Record<string, string> = {};
    for (const p of profs ?? []) emailMap[p.id] = p.email;

    setUnits((data as Unit[]).map((u) => ({ ...u, ownerEmail: emailMap[u.user_id] })));
    setUnitsLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); fetchDevs(); fetchUnits(); }, [fetchUsers, fetchDevs, fetchUnits]);

  // ─ Role toggle ────────────────────────────────────────────────────────────
  const handleToggleRole = useCallback(async (user: UserRow) => {
    const nextRole: AppRole = user.role === 'master_admin' ? 'user' : 'master_admin';
    const label = nextRole === 'master_admin' ? 'Promote to Master Admin' : 'Demote to User';
    const ok = await dialog.confirm({
      title: label,
      message: `${label} for ${user.email}?`,
      confirmText: 'Confirm',
      destructive: nextRole !== 'master_admin',
    });
    if (!ok) return;
    const { error } = await supabase
      .from('user_roles')
      .upsert({ user_id: user.id, role: nextRole }, { onConflict: 'user_id' });
    if (error) { await dialog.alert({ title: 'Error', message: error.message }); return; }
    fetchUsers();
  }, [fetchUsers, dialog]);

  // ─ Delete user (hard-delete via Edge Function — removes auth.users row + cascade) ─
  const handleDeleteUser = useCallback(async (user: UserRow) => {
    const ok = await dialog.confirm({
      title: 'Delete User',
      message: `Permanently delete ${user.email}?\n\nThis removes their auth account and ALL associated data. This cannot be undone.`,
      confirmText: 'Delete Permanently',
      destructive: true,
    });
    if (!ok) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) {
      await dialog.alert({ title: 'Auth Error', message: 'No active session. Please sign in again.' });
      return;
    }
    const { data: fnData, error: fnError } = await supabase.functions.invoke('admin-delete-user', {
      body: { userId: user.id },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (fnError) {
      let message = fnError.message;
      if (fnError instanceof FunctionsHttpError) {
        try { const body = await fnError.context.json(); message = body?.error ?? message; } catch {}
      }
      console.error('[admin-delete-user] error:', message);
      await dialog.alert({ title: 'Error', message });
      return;
    }
    fetchUsers();
  }, [fetchUsers, dialog]);

  // ─ Delete development ─────────────────────────────────────────────────────
  const handleDeleteDev = useCallback(async (dev: Development) => {
    const ok = await dialog.confirm({
      title: 'Delete Development',
      message: `Delete "${dev.name}"? Units will be unassigned.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('developments').delete().eq('id', dev.id);
    if (error) { await dialog.alert({ title: 'Error', message: error.message }); return; }
    fetchDevs();
  }, [fetchDevs, dialog]);

  // ─ Delete unit ────────────────────────────────────────────────────────────
  const handleDeleteUnit = useCallback(async (unit: Unit) => {
    const ok = await dialog.confirm({
      title: 'Delete Unit',
      message: `Delete "${unit.name}"? This cannot be undone.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('units').delete().eq('id', unit.id);
    if (error) { await dialog.alert({ title: 'Error', message: error.message }); return; }
    fetchUnits();
  }, [fetchUnits, dialog]);

  // ─ Guard ──────────────────────────────────────────────────────────────────
  if (!isMaster) {
    return (
      <>
        <Stack.Screen options={{ title: 'Admin Panel', headerShown: true }} />
        <View style={styles.centered}>
          <Text style={styles.guardText}>Access denied.</Text>
        </View>
      </>
    );
  }

  const isCurrentTabLoading =
    tab === 'users' ? usersLoading :
    tab === 'developments' ? devsLoading : unitsLoading;

  return (
    <>
      <Stack.Screen options={{ title: 'Admin Panel', headerShown: true }} />
      <View style={styles.root}>

        {/* Tabs */}
        <View style={styles.tabsWrap}>
          {(['users', 'developments', 'units'] as AdminTab[]).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
              onPress={() => setTab(t)}
            >
              <Text style={[styles.tabBtnText, tab === t && styles.tabBtnTextActive]}>
                {t.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {isCurrentTabLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={ACCENT} size="large" />
          </View>
        ) : tab === 'users' ? (
          <FlatList
            data={users}
            keyExtractor={(u) => u.id}
            contentContainerStyle={[styles.list, { paddingBottom: safeBottom }]}
            ListHeaderComponent={
              <>
                <SectionHeader title="ALL USERS" count={users.length} />
                <TouchableOpacity style={styles.createBtn} onPress={openCreateModal}>
                  <Text style={styles.createBtnText}>+ CREATE USER</Text>
                </TouchableOpacity>
              </>
            }
            refreshControl={<RefreshControl refreshing={usersLoading} onRefresh={fetchUsers} tintColor={ACCENT} />}
            ListEmptyComponent={<Text style={styles.emptyText}>No users found.</Text>}
            renderItem={({ item }) => (
              <UserCard
                user={item}
                isSelf={item.id === currentUser?.id}
                onToggleRole={() => handleToggleRole(item)}
                onDelete={() => handleDeleteUser(item)}
              />
            )}
          />
        ) : tab === 'developments' ? (
          <FlatList
            data={devs}
            keyExtractor={(d) => d.id}
            contentContainerStyle={[styles.list, { paddingBottom: safeBottom }]}
            ListHeaderComponent={<SectionHeader title="ALL DEVELOPMENTS" count={devs.length} />}
            refreshControl={<RefreshControl refreshing={devsLoading} onRefresh={fetchDevs} tintColor={ACCENT} />}
            ListEmptyComponent={<Text style={styles.emptyText}>No developments found.</Text>}
            renderItem={({ item }) => (
              <DevCard dev={item} onDelete={() => handleDeleteDev(item)} />
            )}
          />
        ) : (
          <FlatList
            data={units}
            keyExtractor={(u) => u.id}
            contentContainerStyle={[styles.list, { paddingBottom: safeBottom }]}
            ListHeaderComponent={<SectionHeader title="ALL UNITS" count={units.length} />}
            refreshControl={<RefreshControl refreshing={unitsLoading} onRefresh={fetchUnits} tintColor={ACCENT} />}
            ListEmptyComponent={<Text style={styles.emptyText}>No units found.</Text>}
            renderItem={({ item }) => (
              <UnitCard unit={item} onDelete={() => handleDeleteUnit(item)} />
            )}
          />
        )}
      </View>

      {/* ── Create User Modal ─────────────────────────────────────────────── */}
      <Modal
        visible={createVisible}
        transparent
        animationType="slide"
        onRequestClose={() => !createLoading && setCreateVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>CREATE USER</Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Email *"
              placeholderTextColor={PLACEHOLDER}
              value={createEmail}
              onChangeText={setCreateEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Full name (optional)"
              placeholderTextColor={PLACEHOLDER}
              value={createName}
              onChangeText={setCreateName}
            />

            <Text style={styles.modalLabel}>ROLE</Text>
            <View style={styles.modalToggleRow}>
              {(['user', 'master_admin'] as AppRole[]).map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[styles.modalToggleBtn, createRole === r && styles.modalToggleBtnActive]}
                  onPress={() => setCreateRole(r)}
                >
                  <Text style={[styles.modalToggleBtnText, createRole === r && styles.modalToggleBtnTextActive]}>
                    {r === 'master_admin' ? 'MASTER ADMIN' : 'USER'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.modalLabel}>METHOD</Text>
            <View style={styles.modalToggleRow}>
              {(['invite', 'temp_password'] as const).map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.modalToggleBtn, createMode === m && styles.modalToggleBtnActive]}
                  onPress={() => setCreateMode(m)}
                >
                  <Text style={[styles.modalToggleBtnText, createMode === m && styles.modalToggleBtnTextActive]}>
                    {m === 'invite' ? 'SEND INVITE' : 'SET PASSWORD'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {createMode === 'temp_password' && (
              <TextInput
                style={styles.modalInput}
                placeholder="Temporary password (min 8 chars)"
                placeholderTextColor={PLACEHOLDER}
                value={createPass}
                onChangeText={setCreatePass}
                secureTextEntry
                autoCapitalize="none"
              />
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => setCreateVisible(false)}
                disabled={createLoading}
              >
                <Text style={styles.modalBtnText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnConfirm]}
                onPress={handleCreateUser}
                disabled={createLoading}
              >
                {createLoading
                  ? <ActivityIndicator color={BG} size="small" />
                  : <Text style={[styles.modalBtnText, { color: BG }]}>CREATE</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root:             { flex: 1, backgroundColor: BG },
  centered:         { flex: 1, justifyContent: 'center', alignItems: 'center' },
  guardText:        { color: RED, fontFamily: 'monospace', fontSize: 14 },
  list:             { padding: 16, gap: 12 },
  emptyText:        { color: '#555577', textAlign: 'center', marginTop: 48, fontFamily: 'monospace' },

  tabsWrap: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: CARD_BG,
  },
  tabBtn:          { flex: 1, paddingVertical: 10, alignItems: 'center' },
  tabBtnActive:    { backgroundColor: 'rgba(0,212,255,0.12)' },
  tabBtnText:      { color: 'rgba(255,255,255,0.6)', fontSize: 9, fontFamily: 'monospace', letterSpacing: 1.4, fontWeight: '700' },
  tabBtnTextActive:{ color: ACCENT },

  sectionHeader:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sectionTitle:    { color: '#eeeeff', fontSize: 10, fontFamily: 'monospace', letterSpacing: 1.4, fontWeight: '700' },
  countBadge:      { backgroundColor: 'rgba(0,212,255,0.15)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  countBadgeText:  { color: ACCENT, fontSize: 10, fontFamily: 'monospace', fontWeight: '700' },

  card: {
    backgroundColor: CARD_BG,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
  },
  cardHeader:      { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  cardName:        { flex: 1, color: '#eeeeff', fontSize: 15, fontWeight: '700' },
  cardSub:         { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontFamily: 'monospace', marginBottom: 2 },
  cardFooter:      { flexDirection: 'row', gap: 8, marginTop: 10 },
  statusDot:       { width: 8, height: 8, borderRadius: 4 },

  rolePill:        { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: 'rgba(255,255,255,0.06)' },
  rolePillText:    { fontSize: 9, fontFamily: 'monospace', letterSpacing: 1, color: 'rgba(255,255,255,0.5)', fontWeight: '700' },
  rolePillAdmin:   { backgroundColor: 'rgba(0,212,255,0.15)' },
  rolePillTextAdmin: { color: ACCENT },

  actionBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 6,
    paddingVertical: 7,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  actionBtnDanger: { borderColor: '#ff2f4530', backgroundColor: 'rgba(255,47,69,0.08)' },
  actionBtnDisabled: { opacity: 0.3 },
  actionBtnText:   { color: 'rgba(255,255,255,0.65)', fontSize: 9, fontFamily: 'monospace', letterSpacing: 1, fontWeight: '700' },

  // ─ Create User button ────────────────────────────────────────────────────────
  createBtn: {
    borderWidth: 1,
    borderColor: ACCENT,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 12,
    backgroundColor: 'rgba(0,212,255,0.08)',
  },
  createBtnText: { color: ACCENT, fontSize: 11, fontFamily: 'monospace', letterSpacing: 1.5, fontWeight: '700' },

  // ─ Modal ────────────────────────────────────────────────────────────────────
  modalOverlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: CARD_BG,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 24,
    gap: 12,
  },
  modalTitle: {
    color: '#eeeeff',
    fontSize: 11,
    fontFamily: 'monospace',
    letterSpacing: 2,
    fontWeight: '700',
    marginBottom: 4,
  },
  modalLabel: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 9,
    fontFamily: 'monospace',
    letterSpacing: 1.5,
    marginBottom: -4,
  },
  modalInput: {
    backgroundColor: '#0a0a1a',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#ffffff',
    fontSize: 14,
  },
  modalToggleRow:    { flexDirection: 'row', gap: 8 },
  modalToggleBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#0a0a1a',
  },
  modalToggleBtnActive:    { borderColor: ACCENT, backgroundColor: 'rgba(0,212,255,0.12)' },
  modalToggleBtnText:      { color: 'rgba(255,255,255,0.5)', fontSize: 9, fontFamily: 'monospace', letterSpacing: 1 },
  modalToggleBtnTextActive:{ color: ACCENT },
  modalActions:  { flexDirection: 'row', gap: 10, marginTop: 4 },
  modalBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1,
  },
  modalBtnCancel:  { borderColor: BORDER, backgroundColor: 'rgba(255,255,255,0.04)' },
  modalBtnConfirm: { borderColor: ACCENT, backgroundColor: ACCENT },
  modalBtnText:    { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontFamily: 'monospace', letterSpacing: 1, fontWeight: '700' },
});
