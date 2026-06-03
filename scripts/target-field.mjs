// target-field.mjs — print one field of a target from targets.json (for shell scripts).
// Usage: node scripts/target-field.mjs <target> <field>
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [target, field] = process.argv.slice(2);
const targets = JSON.parse(readFileSync(join(root, 'targets.json'), 'utf8'));
const cfg = targets[target];
if (!cfg) { console.error(`unknown target '${target}'. known: ${Object.keys(targets).join(', ')}`); process.exit(1); }
if (!(field in cfg)) { console.error(`target '${target}' has no field '${field}'`); process.exit(1); }
process.stdout.write(String(cfg[field]));
