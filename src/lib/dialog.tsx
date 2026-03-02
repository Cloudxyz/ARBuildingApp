/**
 * src/lib/dialog.tsx
 *
 * Imperative dialog system — drop-in replacement for Alert.alert.
 *
 * Usage:
 *   const dialog = useDialog();
 *
 *   // Info / error notification (one OK button)
 *   await dialog.alert({ title: 'Error', message: 'Name is required.' });
 *
 *   // Confirmation (returns true if confirmed, false if cancelled)
 *   const ok = await dialog.confirm({
 *     title: 'Delete Unit',
 *     message: 'This cannot be undone.',
 *     confirmText: 'Delete',
 *     destructive: true,
 *   });
 *   if (ok) { ... }
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import { AppDialog } from '../components/AppDialog';

// ─── types ────────────────────────────────────────────────────────────────────

export interface AlertOptions {
  title: string;
  message?: string;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

interface DialogState {
  visible: boolean;
  title: string;
  message?: string;
  confirmText: string;
  cancelText?: string;       // undefined = no cancel button (alert mode)
  destructive: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

interface DialogContextValue {
  alert: (opts: AlertOptions) => Promise<void>;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

// ─── context ──────────────────────────────────────────────────────────────────

const DialogContext = createContext<DialogContextValue | null>(null);

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DialogState>({
    visible: false,
    title: '',
    message: undefined,
    confirmText: 'OK',
    cancelText: undefined,
    destructive: false,
    onConfirm: () => {},
    onCancel: () => {},
  });

  // Ref to prevent stale-closure issues with multiple rapid calls
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const show = useCallback(
    (opts: DialogState) => {
      setState(opts);
    },
    []
  );

  const dismiss = useCallback(() => {
    setState((prev) => ({ ...prev, visible: false }));
  }, []);

  const alert = useCallback(
    (opts: AlertOptions): Promise<void> =>
      new Promise((resolve) => {
        show({
          visible: true,
          title: opts.title,
          message: opts.message,
          confirmText: 'OK',
          cancelText: undefined,
          destructive: false,
          onConfirm: () => { dismiss(); resolve(); },
          onCancel: () => { dismiss(); resolve(); },
        });
      }),
    [show, dismiss]
  );

  const confirm = useCallback(
    (opts: ConfirmOptions): Promise<boolean> =>
      new Promise((resolve) => {
        resolveRef.current = resolve;
        show({
          visible: true,
          title: opts.title,
          message: opts.message,
          confirmText: opts.confirmText ?? 'Confirm',
          cancelText: opts.cancelText ?? 'Cancel',
          destructive: opts.destructive ?? false,
          onConfirm: () => { dismiss(); resolve(true); },
          onCancel:  () => { dismiss(); resolve(false); },
        });
      }),
    [show, dismiss]
  );

  return (
    <DialogContext.Provider value={{ alert, confirm }}>
      {children}
      <AppDialog
        visible={state.visible}
        title={state.title}
        message={state.message}
        confirmText={state.confirmText}
        cancelText={state.cancelText}
        destructive={state.destructive}
        onConfirm={state.onConfirm}
        onCancel={state.onCancel}
      />
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used inside <DialogProvider>');
  return ctx;
}
