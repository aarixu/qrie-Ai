import type { StopStatus } from '@ai-tutor/admin-client';
import { useCallback, useEffect, useState } from 'react';
import { admin } from '@/lib/client';
import { StopControl } from '@/components/stop-control';

const REFRESH_MS = 30_000;

/**
 * Finance's stop (0061): admin.stop_status is the one status read finance may
 * make. Read on mount and every 30 seconds; a failed read keeps the last
 * value, and before any read succeeds nothing is shown.
 */
export function HeaderStop() {
  const [status, setStatus] = useState<StopStatus | null>(null);

  const reload = useCallback(async () => {
    try {
      setStatus(await admin.stopStatus());
    } catch {
      // Keep the last value: the button still works, and the database decides.
    }
  }, []);

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(id);
  }, [reload]);

  return status ? <StopControl status={status} onChanged={() => void reload()} /> : null;
}
