import React from 'react';
import styles from './ConfirmDialog.module.css';
import { useOwnerCommonT } from '../i18n/useOwnerT';

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    confirmVariant?: 'danger' | 'primary' | 'success';
    icon?: React.ReactNode;
    showCancel?: boolean;
    onConfirm: () => void;
    onCancel?: () => void;
}

export default function ConfirmDialog({
    isOpen,
    title,
    message,
    confirmText,
    cancelText,
    showCancel = true,
    confirmVariant = 'primary',
    icon,
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    // Owner-side dialog: localise the default button labels via owner-common so
    // a caller that omits them still gets Hindi after reveal. Callers that pass
    // explicit (already-localised) text override these.
    const tc = useOwnerCommonT();
    const confirmLabel = confirmText ?? tc('actions.confirm', 'Confirm');
    const cancelLabel = cancelText ?? tc('actions.cancel', 'Cancel');

    if (!isOpen) return null;

    return (
        <div className={`vaiyu-owner ${styles.overlay}`} onClick={showCancel ? onCancel : undefined}>
            <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
                <div className={styles.header}>
                    {icon && (
                        <div className={`${styles.iconContainer} ${styles[confirmVariant]}`}>
                            {icon}
                        </div>
                    )}
                    <h3 className={styles.title}>{title}</h3>
                </div>

                <div className={styles.body}>
                    <p className={styles.message}>{message}</p>
                </div>

                <div className={styles.footer}>
                    {showCancel && (
                        <button
                            className={styles.cancelButton}
                            onClick={onCancel}
                        >
                            {cancelLabel}
                        </button>
                    )}
                    <button
                        className={`${styles.confirmButton} ${styles[confirmVariant]}`}
                        onClick={onConfirm}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
