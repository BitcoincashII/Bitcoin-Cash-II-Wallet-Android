/**
 * Password Modal
 * Reusable modal that prompts for wallet password using PasswordInput.
 * Used in send flow and backup flow.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { PasswordInput, PasswordInputHandle } from './PasswordInput';
import { BCH2Colors, BCH2Spacing, BCH2Typography, BCH2BorderRadius } from './BCH2Theme';

interface PasswordModalProps {
  visible: boolean;
  title?: string;
  subtitle?: string;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

/** Imperative handle exposed via ref for parent control */
export interface PasswordModalHandle {
  showError: () => void;
  showSuccess: () => void;
}

export const PasswordModalWithRef = React.forwardRef<PasswordModalHandle, PasswordModalProps>(
  (props, ref) => {
    const passwordRef = useRef<PasswordInputHandle>(null);

    React.useImperativeHandle(ref, () => ({
      showError: () => passwordRef.current?.showError(),
      showSuccess: () => passwordRef.current?.showSuccess(),
    }));

    useEffect(() => {
      if (props.visible) {
        setTimeout(() => {
          passwordRef.current?.reset();
          passwordRef.current?.focus();
        }, 300);
      } else {
        passwordRef.current?.reset();
      }
    }, [props.visible]);

    const handleSubmit = useCallback((password: string) => {
      props.onSubmit(password);
    }, [props.onSubmit]);

    return (
      <Modal
        visible={props.visible}
        transparent
        animationType="fade"
        onRequestClose={props.onCancel}
      >
        <TouchableWithoutFeedback onPress={props.onCancel}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback>
              <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              >
                <View style={styles.container}>
                  <Text style={styles.title}>{props.title ?? 'Enter Password'}</Text>
                  <Text style={styles.subtitle}>{props.subtitle ?? 'Enter your wallet password to continue'}</Text>

                  <View style={styles.inputWrapper}>
                    <PasswordInput
                      ref={passwordRef}
                      onSubmit={handleSubmit}
                      placeholder="Wallet password"
                    />
                  </View>

                  <View style={styles.buttons}>
                    <TouchableOpacity style={styles.cancelButton} onPress={props.onCancel}>
                      <Text style={styles.cancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.submitButton}
                      onPress={() => {
                        const pwd = passwordRef.current?.getValue();
                        if (pwd) handleSubmit(pwd);
                      }}
                    >
                      <Text style={styles.submitText}>Unlock</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </KeyboardAvoidingView>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    );
  }
);

PasswordModalWithRef.displayName = 'PasswordModalWithRef';

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: BCH2Spacing.lg,
  },
  container: {
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.lg,
    padding: BCH2Spacing.xl,
    width: '100%',
    maxWidth: 400,
  },
  title: {
    fontSize: BCH2Typography.fontSize.xl,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.textPrimary,
    textAlign: 'center',
    marginBottom: BCH2Spacing.sm,
  },
  subtitle: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textSecondary,
    textAlign: 'center',
    marginBottom: BCH2Spacing.xl,
  },
  inputWrapper: {
    marginBottom: BCH2Spacing.xl,
  },
  buttons: {
    flexDirection: 'row',
    gap: BCH2Spacing.md,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: BCH2Spacing.md,
    borderRadius: BCH2BorderRadius.md,
    borderWidth: 1,
    borderColor: BCH2Colors.border,
    alignItems: 'center',
  },
  cancelText: {
    color: BCH2Colors.textSecondary,
    fontSize: BCH2Typography.fontSize.base,
    fontWeight: BCH2Typography.fontWeight.medium,
  },
  submitButton: {
    flex: 1,
    paddingVertical: BCH2Spacing.md,
    borderRadius: BCH2BorderRadius.md,
    backgroundColor: BCH2Colors.primary,
    alignItems: 'center',
  },
  submitText: {
    color: BCH2Colors.textPrimary,
    fontSize: BCH2Typography.fontSize.base,
    fontWeight: BCH2Typography.fontWeight.bold,
  },
});
