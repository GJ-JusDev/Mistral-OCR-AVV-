"use client";

/**
 * useDebounce — delays updating a value until the user stops changing it.
 * Used for image adjustment sliders to prevent stutter during drag.
 */

import { useEffect, useState } from "react";

export function useDebounce<T>(value: T, delayMs: number = 200): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}
