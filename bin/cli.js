#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

const cliUrl = new URL('../dist/cli.js', import.meta.url);
process.argv[1] = fileURLToPath(cliUrl);
await import(cliUrl.href);
