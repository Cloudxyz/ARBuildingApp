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
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/hooks/useAuth';

const ACCENT = '#00d4ff';
const BG = '#070714';
const FORM_TEXT = '#ffffff';
const INPUT_BORDER = 'rgba(255,255,255,0.55)';
const PLACEHOLDER = '#b8c1df';

export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Error', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    const error = await signIn(email.trim(), password);
    setLoading(false);
    if (error) {
      Alert.alert('Login Failed', error);
    } else {
      router.replace('/(app)');
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.inner}>
        {/* Branding */}
        <View style={styles.brand}>
          <Text style={styles.brandTag}>VR REAL ESTATE</Text>
          <Text style={styles.brandTitle}>Welcome back</Text>
          <Text style={styles.brandSub}>Sign in to manage your units</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
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
            placeholder="Password"
            placeholderTextColor={PLACEHOLDER}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={BG} />
            ) : (
              <Text style={styles.btnText}>SIGN IN</Text>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
          <Text style={styles.switchText}>
            No account?{' '}
            <Text style={{ color: ACCENT }}>Create one</Text>
          </Text>
        </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  brand: {
    marginBottom: 40,
  },
  brandTag: {
    color: ACCENT,
    fontSize: 10,
    fontFamily: 'monospace',
    letterSpacing: 4,
    marginBottom: 10,
  },
  brandTitle: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '800',
    marginBottom: 6,
  },
  brandSub: {
    color: '#555577',
    fontSize: 14,
  },
  form: {
    marginBottom: 24,
    gap: 12,
  },
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
  btnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    color: BG,
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 3,
  },
  switchText: {
    color: '#555577',
    textAlign: 'center',
    fontSize: 14,
  },
});

