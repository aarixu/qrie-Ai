import type { Me } from '@ai-tutor/admin-client';
import { createContext, useContext } from 'react';

/** Who is signed in, once the gate is ready; screens read it instead of asking again. */
export const MeContext = createContext<Me | null>(null);

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe is used only behind the gate');
  return me;
}
