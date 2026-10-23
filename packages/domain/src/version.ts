// Single source of the version: the root package.json (also used by install/build-and-push.sh for the image tag).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const APP_VERSION: string = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../../package.json'), 'utf8'),
).version;
