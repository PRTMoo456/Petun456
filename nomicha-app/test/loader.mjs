import { pathToFileURL } from 'node:url';
export async function resolve(specifier, context, next) {
  if (specifier.endsWith('supabaseClient.js')) {
    return { url: pathToFileURL(process.cwd() + '/test/supabaseStub.mjs').href, shortCircuit: true };
  }
  return next(specifier, context);
}
