#!/usr/bin/env node
import fs from 'node:fs';
const username = (process.argv[2] ?? '').toLowerCase().includes('username');
process.stdout.write(username ? 'oauth2\n' : fs.readFileSync(process.env.TG_GIT_TOKEN_FILE, 'utf8').trim() + '\n');
