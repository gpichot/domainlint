// Generates schema.json from the zod config schema. Run after `tsc`.
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { configFileSchema } from '../dist/config/types.js';

const schema = z.toJSONSchema(configFileSchema, { target: 'draft-2020-12' });

await writeFile('schema.json', `${JSON.stringify(schema, null, 2)}\n`);
console.log('schema.json generated');
