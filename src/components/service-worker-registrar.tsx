'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker in production only.
 *
 * In development a cached document would mask the very changes being made, so
 * the worker stays off until a real build is being served.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // A failed registration must never break the page.
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}