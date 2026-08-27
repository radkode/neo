#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

process.argv[1] = fileURLToPath(import.meta.url);
await import('../dist/cli.js');
