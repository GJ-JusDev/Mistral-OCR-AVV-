"use client";

import React, { ComponentPropsWithoutRef } from 'react';

export const Table = ({ className = '', ...props }: ComponentPropsWithoutRef<'table'>) => (
  <div className="w-full overflow-x-auto border border-[#dee2e6] rounded-sm">
    <table className={`w-full text-left text-sm text-[#212529] ${className}`} {...props} />
  </div>
);

export const TableHeader = ({ className = '', ...props }: ComponentPropsWithoutRef<'thead'>) => (
  <thead className={`bg-[#f8f9fa] text-xs font-semibold text-[#495057] uppercase tracking-wider ${className}`} {...props} />
);

export const TableBody = ({ className = '', ...props }: ComponentPropsWithoutRef<'tbody'>) => (
  <tbody className={`divide-y divide-[#dee2e6] bg-white ${className}`} {...props} />
);

export const TableRow = ({ className = '', ...props }: ComponentPropsWithoutRef<'tr'>) => (
  <tr className={`hover:bg-[#f1f3f5] ${className}`} {...props} />
);

export const TableHead = ({ className = '', ...props }: ComponentPropsWithoutRef<'th'>) => (
  <th className={`px-4 py-3 font-medium whitespace-nowrap border-b border-[#dee2e6] ${className}`} {...props} />
);

export const TableCell = ({ className = '', ...props }: ComponentPropsWithoutRef<'td'>) => (
  <td className={`px-4 py-3 ${className}`} {...props} />
);