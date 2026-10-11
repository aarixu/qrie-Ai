import { toAdminError } from '@ai-tutor/admin-client';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One read for a billing page: its data, whether it is loading, the error's
 * message, whether that error was a refusal (the page then says the person has
 * no access to billing), and a reload. `key` changes when the read should run
 * again (a filter, an id).
 *
 * The data always belongs to the key on screen: when the key changes, data is
 * null and loading is true until that key's own answer arrives, and an answer
 * that is not the latest request's is dropped. Record a payment posts to the
 * id of the invoice it holds, so an older invoice's late answer must never
 * stand in for the one chosen. A reload under the same key keeps the last
 * good data on screen while it runs.
 */
export function useLoad<T>(fn: () => Promise<T>, key = '') {
  const [got, setGot] = useState<{ key: string; data: T } | null>(null);
  const [error, setError] = useState<{ key: string; message: string; refused: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(fn);
  latest.current = fn;
  const keyNow = useRef(key);
  keyNow.current = key;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    const forKey = keyNow.current;
    setLoading(true);
    try {
      const data = await latest.current();
      if (mine !== seq.current) return;
      setGot({ key: forKey, data });
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      const err = toAdminError(e);
      setError({ key: forKey, message: err.message, refused: err.code === 'not-allowed' });
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, key]);

  const mine = got !== null && got.key === key;
  const err = error !== null && error.key === key ? error : null;
  return {
    data: mine ? got.data : null,
    error: err ? err.message : null,
    refused: err ? err.refused : false,
    loading: loading || (!mine && err === null),
    reload,
  };
}
