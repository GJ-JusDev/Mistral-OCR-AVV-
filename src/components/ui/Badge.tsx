"use client";

import React from 'react';

export interface BadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'amber';
  size?: 'sm' | 'md';
  children: React.ReactNode;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'default',
  size = 'sm',
  children,
  className = '',
}) => {
  const baseStyles = 'inline-flex items-center rounded-full font-medium';
  
  const variants = {
    default: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300',
    success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
    warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-500',
    error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-500',
  };

  const sizes = {
    sm: 'px-2.5 py-0.5 text-xs',
    md: 'px-3 py-1 text-sm',
  };

  return (
    <span className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}>
      {children}
    </span>
  );
};
