import React from 'react';
import styles from './ConfirmDialog.module.css';

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
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    showCancel = true,
    confirmVariant = 'primary',
    icon,
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    if (!isOpen) return null;

    return (
        <div className={styles.overlay} onClick={showCancel ? onCancel : undefined}>
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
                            {cancelText}
                        </button>
                    )}
                    <button
                        className={`${styles.confirmButton} ${styles[confirmVariant]}`}
                        onClick={onConfirm}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}
