'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Load data now, then again every `intervalMs` while the tab is visible.
 * Polling (not websockets) is deliberate for the MVP: one stateless API, no sticky connections.
 */
export function usePolling(load, intervalMs = 4000) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const run = useCallback(async () => {
    try {
      await loadRef.current();
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    run();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') run();
    }, intervalMs);
    return () => clearInterval(id);
  }, [run, intervalMs]);

  return { loading, error, reload: run };
}
