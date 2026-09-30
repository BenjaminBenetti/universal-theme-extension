// Regenerates src/themes/theme.schema.json from the theme format. Usage: npm run schema
import fs from 'node:fs';
import { themeJsonSchema } from '../src/themes/format.ts';

const file = new URL('../src/themes/theme.schema.json', import.meta.url);
fs.writeFileSync(file, JSON.stringify(themeJsonSchema(), null, 2) + '\n');
console.log('wrote', file.pathname);
