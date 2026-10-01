-- TEMPA — EDITORIAL BYLINE: pre-migration lookup (READ-ONLY)
-- Run this BEFORE 2026-09-30-editorial-byline.sql. It changes nothing.
--
-- Expected: exactly ONE row, pseudonym 'Lady Larkspur' (any spacing or
-- capitalisation), pseudonym_key 'ladylarkspur'. Zero rows or more than
-- one row: stop and do not run the migration.

select id, pseudonym, pseudonym_key
from public.profiles
where pseudonym_key = public.canonicalize_pseudonym('Lady Larkspur');
