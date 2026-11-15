import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({ output: 'server', adapter: node({ mode: 'standalone' }), devToolbar: { enabled: false }, vite: { build: { assetsInlineLimit: 0 } } });
