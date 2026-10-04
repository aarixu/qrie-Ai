// LOCAL ONLY, never commit: runs the avatar-f02 worktree on its own port.
// node_modules here is a junction to the main checkout's, which Vite treats
// as outside the project and refuses to serve (the fonts 403'd), so this
// allows the main node_modules alongside the worktree itself.
import { fileURLToPath } from 'node:url';
import type { ConfigEnv, UserConfig } from 'vite';
import base from './vite.config';

const worktree = fileURLToPath(new URL('../..', import.meta.url));
const mainModules = fileURLToPath(new URL('../../../../../node_modules', import.meta.url));

export default (env: ConfigEnv): UserConfig => {
  const config = (base as (e: ConfigEnv) => UserConfig)(env);
  return {
    ...config,
    server: {
      ...config.server,
      port: 5190,
      strictPort: true,
      fs: { allow: [worktree, mainModules] },
    },
  };
};
