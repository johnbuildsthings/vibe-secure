import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// True when the module whose import.meta.url is `url` is the script node was started with.
// Resolves symlinks (macOS /var → /private/var, symlinked plugin dirs), because Node does so
// for import.meta.url. Never throws: under `node -e`, argv[1] is an arbitrary argument.
export function isMain(url) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}
