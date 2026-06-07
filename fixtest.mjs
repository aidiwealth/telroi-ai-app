import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { inArray, sql } from 'drizzle-orm';
import * as schema from './server/db/schema.ts';
import fs from 'fs';

const f = fs.readdirSync('server/db/migrations').find(x => x.endsWith('.sql'));
const st = fs.readFileSync(`server/db/migrations/${f}`,'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
const client = new PGlite();
for (const s of st) { try { await client.exec(s); } catch(e){ console.error('mig FAIL', e.message.slice(0,90)); process.exit(1);} }
const db = drizzle(client, { schema });

const A='7e6a9462-6bdc-41d0-9897-cea1d084d92c', B='8a53cd05-b3b0-4600-b6de-237c0e37ed2a';
await client.query(`INSERT INTO tenants (id,name,slug) VALUES ($1,'Acme','acme'),($2,'Beta','beta')`,[A,B]);

// The OLD broken way (raw ANY with JS array) -> should throw
let oldFailed=false;
try { await db.select({ id: schema.tenants.id }).from(schema.tenants).where(sql`${schema.tenants.id} = ANY(${[A,B]})`); }
catch(e){ oldFailed=true; console.log('OLD ANY() path correctly fails:', e.message.slice(0,55)); }

// The NEW fixed way (inArray) -> should succeed and return both
const names = await db.select({ id: schema.tenants.id, name: schema.tenants.name, slug: schema.tenants.slug, isInternal: schema.tenants.isInternal })
  .from(schema.tenants).where(inArray(schema.tenants.id, [A,B]));
console.log('NEW inArray path returns:', names.length, 'rows ->', names.map(n=>n.name).join(', '));

process.exit(oldFailed && names.length===2 ? 0 : 1);
