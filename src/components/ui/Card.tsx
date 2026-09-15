"use client";

import React from 'react';

export interface CardProps {
  title?: string;
  description?: string;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export const Card: React.FC<CardProps> = ({
  title,
  description,
  headerAction,
  children,
  className = '',
  padding = 'md',
}) => {
  const paddings = {
    none: 'p-0',
    sm: 'p-4',
    md: 'p-6',
    lg: 'p-8',
  };

  return (
    <div className={`card-premodern ${className}`}>
      {(title || description || headerAction) && (
        <div className="flex items-center justify-between border-b border-[#e9ecef] px-6 py-4">
          <div>
            {title && <h3 className="text-[1.05rem] font-medium text-[#212529]">{title}</h3>}
            {description && <p className="text-[0.875rem] text-[#6c757d] mt-1">{description}</p>}
          </div>
          {headerAction && <div>{headerAction}</div>}
        </div>
      )}
      <div className={`${paddings[padding]}`}>
        {children}
      </div>
    </div>
  );
};