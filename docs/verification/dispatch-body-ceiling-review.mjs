import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Run with the installed PGlite module path as the first argument.
const { PGlite } = await import(process.argv[2] ?? '@electric-sql/pglite')
const db = new PGlite()
const sql = await readFile(new URL('../sql/2026-09-07-dispatches-and-board.sql', import.meta.url), 'utf8')
const visibleLength = sql.match(/create or replace function public\.dispatch_visible_length\(p_body text\)[\s\S]*?\$\$;/)[0]
await db.exec(visibleLength)
await db.exec(`
  create table public.dispatches (id integer primary key, body text not null,
    constraint dispatches_body_not_blank check (char_length(btrim(body)) > 0),
    constraint dispatches_body_visible_length check (public.dispatch_visible_length(body) <= 10000));
  insert into public.dispatches values (1, 'Existing article');
`)
const formattedArticle = '\u2063**' + 'x'.repeat(10001) + '**'
await assert.rejects(db.query('insert into public.dispatches values (2, $1)', [formattedArticle]),
  /dispatches_body_visible_length/)

const migration = await readFile(new URL('../sql/2026-10-01-dispatch-body-ceiling.sql', import.meta.url), 'utf8')
await db.exec(migration)
await db.query('insert into public.dispatches values (2, $1)', [formattedArticle])
await db.query('insert into public.dispatches values (3, $1)', ['x'.repeat(200000)])
await assert.rejects(db.query('insert into public.dispatches values (4, $1)', ['x'.repeat(200001)]),
  /dispatches_body_visible_length/)
await assert.rejects(db.query('insert into public.dispatches values (5, $1)', ['']),
  /dispatches_body_not_blank/)
assert.equal((await db.query('select body from public.dispatches where id = 1')).rows[0].body, 'Existing article')
await db.exec(migration) // Safe to rerun.
const verification = await readFile(new URL('../sql/2026-10-01-dispatch-body-ceiling-verify.sql', import.meta.url), 'utf8')
assert.equal((await db.query(verification)).rows[0].result, 'DISPATCH_BODY_CEILING_VERIFIED')
await db.close()
console.log('PASS: reproduced old rejection; long formatted article accepted; 200000 boundary, over-limit rejection, blank rejection, content preservation, rerun and verifier checked.')
