import type { ButtonHTMLAttributes } from 'react';

export function cx(...values: Array<string | false | undefined>) {
    return values.filter(Boolean).join(' ');
}

export function Spinner({
    size = 20,
    label,
    className = '',
}: {
    size?: 12 | 14 | 16 | 20;
    label?: string;
    className?: string;
}) {
    return (
        <span
            className={cx('loading-orbit', className)}
            data-size={size}
            role={label ? 'status' : undefined}
            aria-label={label}
            aria-hidden={label ? undefined : true}
        />
    );
}

export function Button({
    variant = 'secondary',
    className = '',
    type = 'button',
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
    const variants = {
        primary: 'button-primary',
        secondary: 'button-secondary',
        ghost: 'button-ghost',
        danger: 'button-danger',
    };
    return (
        <button
            {...props}
            type={type}
            className={cx('button-base', variants[variant], className)}
        />
    );
}
