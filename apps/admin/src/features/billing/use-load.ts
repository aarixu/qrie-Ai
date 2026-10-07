import { toAdminError } from '@ai-tutor/admin-client';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One read for a billing page: its data, whether it is loading, the error's
 * message, whether that error was a refusal (the page then says the person has
 * no access to billing), and a reload. `key` changes when the read should run
 * again (a filter, an id).
 */
export function useLoad<T>(fn: () => Promise<T>, key = '') {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const [loading, setLoading] = useState(true);
  const latest = useRef(fn);
  latest.current = fn;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await latest.current());
      setError(null);
      setRefused(false);
    } catch (e) {
      const err = toAdminError(e);
      setError(err.message);
      setRefused(err.code === 'not-allowed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, key]);

  return { data, error, refused, loading, reload };
}
