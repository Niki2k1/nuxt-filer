import type { ProviderGetImage } from '@nuxt/image';

interface FilerProviderOptions {
  baseURL?: string;
}

const operationsGenerator = (
  modifiers: Record<string, string | number | boolean | undefined>
): string => {
  const ops: string[] = [];
  for (const [key, value] of Object.entries(modifiers)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    ops.push(`${key}_${value}`);
  }
  return ops.length ? ops.join(',') : '_';
};

export const getImage: ProviderGetImage = (
  src: string,
  { modifiers = {}, baseURL }: { modifiers?: Record<string, unknown>; baseURL?: string } = {},
  // ctx is provided by @nuxt/image but unused here
) => {
  const root = (baseURL ?? '/_filer-ipx').replace(/\/+$/, '');
  const ops = operationsGenerator(
    modifiers as Record<string, string | number | boolean | undefined>
  );
  const path = src.replace(/^\/+/, '');
  return { url: `${root}/${ops}/${path}` };
};

export const validateDomains = false;

export type { FilerProviderOptions };
