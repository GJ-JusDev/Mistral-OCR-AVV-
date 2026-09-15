"use client";

import React, { forwardRef, ComponentPropsWithoutRef } from 'react';

export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className = '',
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const baseStyles = 'inline-flex items-center justify-center rounded-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[#86b7fe] disabled:opacity-50 disabled:cursor-not-allowed';
    
    const variants = {
      primary: 'bg-[#212529] text-white hover:bg-[#495057]',
      secondary: 'bg-[#e9ecef] text-[#212529] hover:bg-[#dee2e6]',
      danger: 'bg-[#dc3545] text-white hover:bg-[#c82333]',
      ghost: 'bg-transparent text-[#495057] hover:bg-[#e9ecef]',
      outline: 'border border-[#ced4da] text-[#212529] hover:bg-[#f8f9fa]',
    };

    const sizes = {
      sm: 'py-1.5 px-3 text-[0.875rem]',
      md: 'py-2 px-4 text-[0.95rem]',
      lg: 'py-3 px-5 text-base',
    };

    return (
      <button
        ref={ref}
        className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading && (
          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        )}
        {!isLoading && leftIcon && <span className="mr-2">{leftIcon}</span>}
        {children}
        {!isLoading && rightIcon && <span className="ml-2">{rightIcon}</span>}
      </button>
    );
  }
);
Button.displayName = 'Button';