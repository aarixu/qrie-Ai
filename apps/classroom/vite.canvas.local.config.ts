// LOCAL ONLY, never commit: runs the canvas worktree on its own port, and
// allows the main checkout's node_modules (a junction here) to be served.
import { fileURLToPath } from 'node:url';
import type { ConfigEnv, UserConfig } from 'vite';
import base from './vite.config';

const worktree = fileURLToPath(new URL('../..', import.meta.url));
const mainModules = fileURLToPath(new URL('../../../../../node_modules', import.meta.url));

export default (env: ConfigEnv): UserConfig => {
  const config = (base as (e: ConfigEnv) => UserConfig)(env);
  return { ...config, server: { ...config.server, port: 5191, strictPort: true, fs: { allow: [worktree, mainModules] } } };
};
