import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useDialog } from '../../src/lib/dialog';
import { useAuth } from '../../src/hooks/useAuth';

const ACCENT = '#00d4ff';
const BG = '#070714';
const FORM_TEXT = '#ffffff';
const INPUT_BORDER = 'rgba(255,255,255,0.55)';
const PLACEHOLDER = '#b8c1df';

export default function RegisterScreen() {
  const router = useRouter();
  const { signUp } = useAuth();
  const dialog = useDialog();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!fullName.trim() || !email.trim() || !password) {
      await dialog.alert({ title: 'Error', message: 'All fields are required.' });
      return;
    }
    if (password !== confirm) {
      await dialog.alert({ title: 'Error', message: 'Passwords do not match.' });
      return;
    }
    if (password.length < 6) {
      await dialog.alert({ title: 'Error', message: 'Password must be at least 6 characters.' });
      return;
    }
    setLoading(true);
    const error = await signUp(email.trim(), password, fullName.trim());
    setLoading(false);
    if (error) {
      await dialog.alert({ title: 'Registration Failed', message: error });
    } else {
      await dialog.alert({
        title: 'Account Created',
        message: 'Check your email to confirm your account, then sign in.',
      });
      router.replace('/(auth)/login');
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <Text style={styles.brandTag}>VR REAL ESTATE</Text>
          <Text style={styles.brandTitle}>Create account</Text>
          <Text style={styles.brandSub}>Start managing your unit portfolio</Text>
        </View>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Full name"
            placeholderTextColor={PLACEHOLDER}
            autoCapitalize="words"
            value={fullName}
            onChangeText={setFullName}
          />
          <TextInput
            style={styles.input}
            placeholder="Email address"
            placeholderTextColor={PLACEHOLDER}
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password (min. 6 chars)"
            placeholderTextColor={PLACEHOLDER}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <TextInput
            style={styles.input}
            placeholder="Confirm password"
            placeholderTextColor={PLACEHOLDER}
            secureTextEntry
            value={confirm}
            onChangeText={setConfirm}
          />

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={BG} />
            ) : (
              <Text style={styles.btnText}>CREATE ACCOUNT</Text>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.switchText}>
            Already have an account?{' '}
            <Text style={{ color: ACCENT }}>Sign in</Text>
          </Text>
        </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  inner: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 40 },
  brand: { marginBottom: 36 },
  brandTag: { color: ACCENT, fontSize: 10, fontFamily: 'monospace', letterSpacing: 4, marginBottom: 10 },
  brandTitle: { color: '#ffffff', fontSize: 32, fontWeight: '800', marginBottom: 6 },
  brandSub: { color: 'rgba(255,255,255,0.55)', fontSize: 14 },
  form: { marginBottom: 24, gap: 12 },
  input: {
    backgroundColor: '#0d0d22',
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: FORM_TEXT,
    fontSize: 15,
  },
  btn: {
    backgroundColor: ACCENT,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: BG, fontWeight: '800', fontSize: 14, letterSpacing: 3 },
  switchText: { color: 'rgba(255,255,255,0.55)', textAlign: 'center', fontSize: 14 },
});

