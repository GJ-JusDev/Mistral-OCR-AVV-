import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  let target = specifier;
  if (specifier.startsWith('@/')) {
    const resolvedPath = path.resolve('./src', specifier.slice(2));
    target = pathToFileURL(resolvedPath).href;
  }

  try {
    return await nextResolve(target, context);
  } catch (err) {
    if (
      err.code === 'ERR_MODULE_NOT_FOUND' &&
      (target.startsWith('./') || target.startsWith('../') || target.startsWith('file://'))
    ) {
      for (const ext of ['.ts', '.tsx', '.js', '/index.ts', '/index.js']) {
        try {
          return await nextResolve(target + ext, context);
        } catch {}
      }
    }
    throw err;
  }
}
