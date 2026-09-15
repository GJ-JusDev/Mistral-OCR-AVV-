"use client";

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!mounted) return null;

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
  };

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-300 ${
        isOpen ? 'opacity-100 visible' : 'opacity-0 invisible pointer-events-none'
      }`}
    >
      <div
        className="fixed inset-0 bg-zinc-900/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      <div
        className={`relative w-full ${sizes[size]} transform overflow-hidden rounded-2xl bg-white text-left align-middle shadow-xl transition-all dark:bg-zinc-900 ${
          isOpen ? 'scale-100' : 'scale-95'
        }`}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-500 focus:outline-none dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <span className="sr-only">Close</span>
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-4">{children}</div>
        {footer && (
          <div className="border-t border-zinc-100 bg-zinc-50 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900/50">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
