import { FlatCompat } from '@eslint/eslintrc';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: currentDirectory });

const config = [
  {
    ignores: ['.next/**', '.next-*/**', 'node_modules/**', 'next-env.d.ts', 'tsconfig.tsbuildinfo'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
];

export default config;
