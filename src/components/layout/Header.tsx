"use client";

import React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

interface Breadcrumb {
  label: string;
  href?: string;
}

interface HeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: Breadcrumb[];
  actions?: React.ReactNode;
}

export default function Header({
  title,
  description,
  breadcrumbs,
  actions
}: HeaderProps) {
  return (
    <header className="w-full border-b border-[#dee2e6] bg-white px-4 py-4 sm:px-6 lg:px-8">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-4">
          <ol className="flex items-center space-x-2 text-sm text-[#6c757d]">
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <li key={index} className="flex items-center">
                  {crumb.href && !isLast ? (
                    <Link
                      href={crumb.href}
                      className="hover:text-[#212529] hover:underline"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className={isLast ? 'text-[#212529] font-medium' : ''}>
                      {crumb.label}
                    </span>
                  )}
                  {!isLast && (
                    <ChevronRight className="mx-2 h-4 w-4 flex-shrink-0 text-[#adb5bd]" />
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.5rem] font-semibold leading-7 text-[#212529] sm:truncate sm:tracking-tight">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-[#6c757d]">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="mt-4 flex sm:ml-4 sm:mt-0">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}