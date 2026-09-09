-- Tempa — Mail Call / Delayed Delivery, Migration 2 of N: stable
-- geography foundation for compute_deliver_at (country_code +
-- country_continent). Does NOT write compute_deliver_at itself, does
-- NOT touch any writer RPC, does NOT touch letters/correspondences,
-- Letterbox, search, or any RLS policy, and does NOT touch application
-- code.
-- PREPARED 2026-09-04. NOT EXECUTED — review, then run in the Supabase
-- SQL editor. Migration 1 (letters.deliver_at,
-- 2026-09-04-mail-call-deliver-at-foundation.sql) is live and verified.
--
-- ============================================================
-- INSPECTION PERFORMED BEFORE WRITING THIS MIGRATION
-- ============================================================
--
-- No CREATE TABLE public.profiles exists anywhere in docs/sql/ — the
-- table (and its country/region columns) predates this repo's tracked
-- migration history, confirmed by grep across every file this session.
-- This migration only ever ADDS a column to it; it does not assume or
-- reproduce that table's original definition.
--
-- app/profile/data.ts / app/profile/profile-form.tsx confirmed
-- directly: profiles.country is populated EXCLUSIVELY from
-- COUNTRY_OPTIONS, itself built at module load from
-- country-state-city's Country.getAllCountries().map(c => c.name) —
-- there is no free-text country input anywhere in the onboarding form.
-- Every row ever written through the normal signup path therefore
-- carries a country value drawn verbatim from that library's name list.
--
-- package.json / package-lock.json confirmed: country-state-city is
-- pinned "^3.2.1", resolved to exactly 3.2.1, and was added to this
-- project in a single commit with no later version bump in git history
-- — so there is no library-version drift between when any existing
-- profile row was written and the name list this migration backfills
-- against; both are the same 3.2.1 data.
--
-- The exact current Country.getAllCountries() output was extracted
-- directly from the installed dependency (node -e against
-- country-state-city, this session) — 250 countries/territories, each
-- with its ISO 3166-1 alpha-2 isoCode. The VALUES lists below are that
-- output verbatim (single-quote escaped where needed — only
-- "Cote D'Ivoire (Ivory Coast)" contains one), not retyped from memory.
--
-- IMPORTANT LIMITATION, stated plainly: this environment has no
-- service-role key or database CLI configured (only the anon/
-- publishable key is present in .env.local) — there is no way for me to
-- directly query the LIVE profiles table's actual stored country
-- values. I cannot hand you a literal "list of unmatched rows" myself;
-- the verification query below (numbered 4) is what actually answers
-- that, and you'll need to run it. What I CAN and did establish: since
-- every row was written through the same constrained picklist against
-- the same pinned library version this migration backfills against, the
-- structural expectation is zero mismatches for any row created through
-- the normal form. Any row created outside that path (there is no known
-- such path in this codebase, but I cannot prove a negative from static
-- inspection alone) is the only way a mismatch could exist.
--
-- ============================================================
-- CONTINENT ASSIGNMENTS — mechanically verified against a reference,
-- not hand-authored-and-trusted
-- ============================================================
--
-- country_continent's 250 rows were first drafted from general
-- geographic knowledge (7-continent model, North and South America kept
-- separate to match the band table's "same continent" grain), then
-- mechanically diffed, row by row, against
-- lukes/ISO-3166-Countries-with-Regional-Codes (a widely used, UN
-- M49-geoscheme-derived country/region dataset — fetched directly,
-- diffed programmatically against every one of the 250 codes below, not
-- eyeballed). Result: 243/250 matched exactly on the first pass. The 7
-- discrepancies, and the policy applied to each:
--
--   CY (Cyprus) — the one genuine correction: UN M49 classifies it Asia
--   (Western Asia), not Europe. Adopted the reference's answer.
--
--   RU, TR, KZ, GE, AM, AZ — all matched the reference exactly (Russia
--   -> Europe; Turkey/Kazakhstan/Georgia/Armenia/Azerbaijan -> Asia).
--   No change needed; recorded here since these are the transcontinental
--   cases most worth a second look, and now they've had one, against a
--   citable source rather than convention alone.
--
--   AQ, BV, TF, HM, GS (Antarctica itself, Bouvet Island, French
--   Southern Territories, Heard Island and McDonald Islands, South
--   Georgia) — TEMPA CLASSIFICATION POLICY OVERRIDES, not a direct UN
--   M49 classification. UN M49 does define an Antarctica region (code
--   010), but the specific reference dataset used for this diff doesn't
--   apply it to these rows — it left AQ's own region blank and grouped
--   BV/TF/GS under whichever administering country's region happens to
--   apply (e.g. Bouvet Island under "Americas") and HM under Oceania.
--   Rather than adopt that dataset-specific grouping, or separately
--   look up the formal M49 010 assignment for each, Tempa deliberately
--   classifies this fixed, explicitly-named set of uninhabited/near-
--   uninhabited polar territories as "Antarctica" for delay-band
--   purposes — a Tempa policy choice, stated as one, not a claim about
--   what any external standard says. Zero realistic onboarding traffic
--   either way.
--
--   TW (Taiwan) and XK (Kosovo) — TEMPA FALLBACK CLASSIFICATIONS, used
--   because the chosen reference dataset provides no usable standard
--   region for either (Taiwan's region is left blank there, tied to its
--   disputed status in UN-derived data; Kosovo's "XK" is a widely-used
--   but non-official ISO code that dataset omits entirely). Both are
--   geographically unambiguous regardless (TW -> Asia, XK -> Europe),
--   so the fallback is low-risk, but it is a Tempa-authored fallback,
--   not a value read from the reference.
--
-- Stated policy, for consistency rather than case-by-case judgment:
-- defer to the UN M49 reference wherever it has a usable answer for an
-- inhabited country (this resolved CY and confirmed RU/TR/KZ/GE/AM/AZ);
-- where the reference has no usable answer at all (TW, XK), fall back to
-- an unambiguous direct classification; and for the fixed, explicitly-
-- named set of uninhabited Antarctic-region territories (AQ, BV, TF, HM,
-- GS), apply Tempa's own override to "Antarctica" regardless of what
-- region the reference dataset's own grouping happens to assign them.
--
-- A wrong row here is a single-row UPDATE with no cascading effect on
-- anything else — this table is deliberately isolated for exactly that
-- reason.
--
-- ============================================================
-- WHY THIS SHAPE
-- ============================================================
--
-- profiles.country and profiles.region are untouched — not renamed, not
-- backfilled, not rewritten. country_code is a new, independent, purely
-- additive nullable column. Rows that don't resolve a country_code stay
-- null (never guessed at, never defaulted to a wrong continent) — a
-- future compute_deliver_at is expected to treat "no country_code" as
-- "assume the farthest band" (fail toward MORE delay, never less),
-- decided in the correction-pass report; that fallback is not
-- implemented here, since this migration does not touch
-- compute_deliver_at at all.
--
-- ============================================================
-- ROLLOUT BEHAVIOR — confirmed, not changed by this migration
-- ============================================================
--
-- Every profile created between this migration landing and the (not-yet-
-- written) profile-form.tsx change that starts sending country_code at
-- signup will simply get country_code = null, exactly like every
-- pre-existing row this migration doesn't resolve. That's safe: the
-- INSERT in profile-form.tsx today doesn't mention country_code at all,
-- the column is nullable with no default and no NOT NULL, and nothing
-- yet reads it — onboarding is completely unaffected either way. The
-- eventual compute_deliver_at is expected to treat a null country_code
-- as the farthest band (fail toward more delay, never less — see
-- above), so a signup that lands in this window degrades gracefully
-- rather than breaking. Once the profile-form.tsx change ships, re-
-- running this migration's own backfill UPDATE (step 3 below) is safe
-- and idempotent — it only ever touches rows still null — and is the
-- recommended way to sweep up any profiles created during this
-- transition window that a live app-side write didn't already cover.
--
-- ============================================================
-- CLIENT GRANTS — country_continent is not exposed via PostgREST
-- ============================================================
--
-- No application code reads this table yet, and it never needs to be
-- reachable from a client directly: the only planned reader is a future
-- compute_deliver_at, a SECURITY DEFINER function (matching every other
-- writer RPC in this codebase) that will read it under its OWNER's
-- privileges, not the caller's — so authenticated/anon never need a
-- grant on this table for Mail Call to work, now or later. RLS is
-- enabled with zero policies (not merely "no grant yet") as a second,
-- independent layer: even if a future migration mistakenly adds a
-- SELECT grant without also adding a policy, no role but the table
-- owner/service_role would see any rows. The explicit revokes below are
-- belt-and-suspenders, matching this codebase's existing convention of
-- stating privilege boundaries explicitly rather than relying on
-- Postgres's default (tables are not granted to PUBLIC by default,
-- unlike functions, but every other table in this project revokes
-- explicitly anyway).

begin;

-- ============================================================
-- 1. CONTINENT LOOKUP — created and seeded first, so the FK below has
--    something to reference immediately. Small (250 rows), effectively
--    static, isolated from everything else.
-- ============================================================

create table public.country_continent (
  country_code text primary key,
  continent text not null,

  constraint country_continent_value_check
    check (
      continent in (
        'Africa', 'Antarctica', 'Asia', 'Europe',
        'North America', 'Oceania', 'South America'
      )
    )
);

insert into public.country_continent (country_code, continent)
values
    ('AF', 'Asia'),
    ('AX', 'Europe'),
    ('AL', 'Europe'),
    ('DZ', 'Africa'),
    ('AS', 'Oceania'),
    ('AD', 'Europe'),
    ('AO', 'Africa'),
    ('AI', 'North America'),
    ('AQ', 'Antarctica'),
    ('AG', 'North America'),
    ('AR', 'South America'),
    ('AM', 'Asia'),
    ('AW', 'North America'),
    ('AU', 'Oceania'),
    ('AT', 'Europe'),
    ('AZ', 'Asia'),
    ('BS', 'North America'),
    ('BH', 'Asia'),
    ('BD', 'Asia'),
    ('BB', 'North America'),
    ('BY', 'Europe'),
    ('BE', 'Europe'),
    ('BZ', 'North America'),
    ('BJ', 'Africa'),
    ('BM', 'North America'),
    ('BT', 'Asia'),
    ('BO', 'South America'),
    ('BA', 'Europe'),
    ('BW', 'Africa'),
    ('BV', 'Antarctica'),
    ('BR', 'South America'),
    ('IO', 'Africa'),
    ('BN', 'Asia'),
    ('BG', 'Europe'),
    ('BF', 'Africa'),
    ('BI', 'Africa'),
    ('KH', 'Asia'),
    ('CM', 'Africa'),
    ('CA', 'North America'),
    ('CV', 'Africa'),
    ('KY', 'North America'),
    ('CF', 'Africa'),
    ('TD', 'Africa'),
    ('CL', 'South America'),
    ('CN', 'Asia'),
    ('CX', 'Oceania'),
    ('CC', 'Oceania'),
    ('CO', 'South America'),
    ('KM', 'Africa'),
    ('CG', 'Africa'),
    ('CD', 'Africa'),
    ('CK', 'Oceania'),
    ('CR', 'North America'),
    ('CI', 'Africa'),
    ('HR', 'Europe'),
    ('CU', 'North America'),
    ('CY', 'Asia'),
    ('CZ', 'Europe'),
    ('DK', 'Europe'),
    ('DJ', 'Africa'),
    ('DM', 'North America'),
    ('DO', 'North America'),
    ('TL', 'Asia'),
    ('EC', 'South America'),
    ('EG', 'Africa'),
    ('SV', 'North America'),
    ('GQ', 'Africa'),
    ('ER', 'Africa'),
    ('EE', 'Europe'),
    ('ET', 'Africa'),
    ('FK', 'South America'),
    ('FO', 'Europe'),
    ('FJ', 'Oceania'),
    ('FI', 'Europe'),
    ('FR', 'Europe'),
    ('GF', 'South America'),
    ('PF', 'Oceania'),
    ('TF', 'Antarctica'),
    ('GA', 'Africa'),
    ('GM', 'Africa'),
    ('GE', 'Asia'),
    ('DE', 'Europe'),
    ('GH', 'Africa'),
    ('GI', 'Europe'),
    ('GR', 'Europe'),
    ('GL', 'North America'),
    ('GD', 'North America'),
    ('GP', 'North America'),
    ('GU', 'Oceania'),
    ('GT', 'North America'),
    ('GG', 'Europe'),
    ('GN', 'Africa'),
    ('GW', 'Africa'),
    ('GY', 'South America'),
    ('HT', 'North America'),
    ('HM', 'Antarctica'),
    ('HN', 'North America'),
    ('HK', 'Asia'),
    ('HU', 'Europe'),
    ('IS', 'Europe'),
    ('IN', 'Asia'),
    ('ID', 'Asia'),
    ('IR', 'Asia'),
    ('IQ', 'Asia'),
    ('IE', 'Europe'),
    ('IL', 'Asia'),
    ('IT', 'Europe'),
    ('JM', 'North America'),
    ('JP', 'Asia'),
    ('JE', 'Europe'),
    ('JO', 'Asia'),
    ('KZ', 'Asia'),
    ('KE', 'Africa'),
    ('KI', 'Oceania'),
    ('KP', 'Asia'),
    ('KR', 'Asia'),
    ('KW', 'Asia'),
    ('KG', 'Asia'),
    ('LA', 'Asia'),
    ('LV', 'Europe'),
    ('LB', 'Asia'),
    ('LS', 'Africa'),
    ('LR', 'Africa'),
    ('LY', 'Africa'),
    ('LI', 'Europe'),
    ('LT', 'Europe'),
    ('LU', 'Europe'),
    ('MO', 'Asia'),
    ('MK', 'Europe'),
    ('MG', 'Africa'),
    ('MW', 'Africa'),
    ('MY', 'Asia'),
    ('MV', 'Asia'),
    ('ML', 'Africa'),
    ('MT', 'Europe'),
    ('IM', 'Europe'),
    ('MH', 'Oceania'),
    ('MQ', 'North America'),
    ('MR', 'Africa'),
    ('MU', 'Africa'),
    ('YT', 'Africa'),
    ('MX', 'North America'),
    ('FM', 'Oceania'),
    ('MD', 'Europe'),
    ('MC', 'Europe'),
    ('MN', 'Asia'),
    ('ME', 'Europe'),
    ('MS', 'North America'),
    ('MA', 'Africa'),
    ('MZ', 'Africa'),
    ('MM', 'Asia'),
    ('NA', 'Africa'),
    ('NR', 'Oceania'),
    ('NP', 'Asia'),
    ('BQ', 'North America'),
    ('NL', 'Europe'),
    ('NC', 'Oceania'),
    ('NZ', 'Oceania'),
    ('NI', 'North America'),
    ('NE', 'Africa'),
    ('NG', 'Africa'),
    ('NU', 'Oceania'),
    ('NF', 'Oceania'),
    ('MP', 'Oceania'),
    ('NO', 'Europe'),
    ('OM', 'Asia'),
    ('PK', 'Asia'),
    ('PW', 'Oceania'),
    ('PS', 'Asia'),
    ('PA', 'North America'),
    ('PG', 'Oceania'),
    ('PY', 'South America'),
    ('PE', 'South America'),
    ('PH', 'Asia'),
    ('PN', 'Oceania'),
    ('PL', 'Europe'),
    ('PT', 'Europe'),
    ('PR', 'North America'),
    ('QA', 'Asia'),
    ('RE', 'Africa'),
    ('RO', 'Europe'),
    ('RU', 'Europe'),
    ('RW', 'Africa'),
    ('SH', 'Africa'),
    ('KN', 'North America'),
    ('LC', 'North America'),
    ('PM', 'North America'),
    ('VC', 'North America'),
    ('BL', 'North America'),
    ('MF', 'North America'),
    ('WS', 'Oceania'),
    ('SM', 'Europe'),
    ('ST', 'Africa'),
    ('SA', 'Asia'),
    ('SN', 'Africa'),
    ('RS', 'Europe'),
    ('SC', 'Africa'),
    ('SL', 'Africa'),
    ('SG', 'Asia'),
    ('SK', 'Europe'),
    ('SI', 'Europe'),
    ('SB', 'Oceania'),
    ('SO', 'Africa'),
    ('ZA', 'Africa'),
    ('GS', 'Antarctica'),
    ('SS', 'Africa'),
    ('ES', 'Europe'),
    ('LK', 'Asia'),
    ('SD', 'Africa'),
    ('SR', 'South America'),
    ('SJ', 'Europe'),
    ('SZ', 'Africa'),
    ('SE', 'Europe'),
    ('CH', 'Europe'),
    ('SY', 'Asia'),
    ('TW', 'Asia'),
    ('TJ', 'Asia'),
    ('TZ', 'Africa'),
    ('TH', 'Asia'),
    ('TG', 'Africa'),
    ('TK', 'Oceania'),
    ('TO', 'Oceania'),
    ('TT', 'North America'),
    ('TN', 'Africa'),
    ('TR', 'Asia'),
    ('TM', 'Asia'),
    ('TC', 'North America'),
    ('TV', 'Oceania'),
    ('UG', 'Africa'),
    ('UA', 'Europe'),
    ('AE', 'Asia'),
    ('GB', 'Europe'),
    ('US', 'North America'),
    ('UM', 'Oceania'),
    ('UY', 'South America'),
    ('UZ', 'Asia'),
    ('VU', 'Oceania'),
    ('VA', 'Europe'),
    ('VE', 'South America'),
    ('VN', 'Asia'),
    ('VG', 'North America'),
    ('VI', 'North America'),
    ('WF', 'Oceania'),
    ('EH', 'Africa'),
    ('YE', 'Asia'),
    ('ZM', 'Africa'),
    ('ZW', 'Africa'),
    ('XK', 'Europe'),
    ('CW', 'North America'),
    ('SX', 'North America');


-- ============================================================
-- 1b. LOCK DOWN CLIENT ACCESS — RLS enabled with zero policies (deny-
--     by-default even if a grant is later mistakenly added), plus
--     explicit, idempotent revokes matching this codebase's existing
--     convention. Nothing here weakens any other table/policy/grant.
-- ============================================================

alter table public.country_continent
enable row level security;

revoke all
on public.country_continent
from public, anon, authenticated;


-- ============================================================
-- 2. ADD COLUMN — nullable, no default, no rewrite of country/region.
--    Metadata-only ADD COLUMN (nullable, no default) — fast path, no
--    table rewrite. References country_continent so a resolved
--    country_code is always guaranteed to have a continent.
-- ============================================================

alter table public.profiles
  add column country_code text
    references public.country_continent(country_code);


-- ============================================================
-- 3. BACKFILL — match every profile's stored country display-name
--    string against the exact current country-state-city name list
--    (verbatim extraction, see header). Only touches rows where
--    country_code is currently null (defensive — it always is, this
--    column was just created) and where an exact match exists; anything
--    that doesn't match is deliberately left null, never guessed.
-- ============================================================

update public.profiles p
set country_code = m.iso
from (
  values
    ('Afghanistan', 'AF'),
    ('Aland Islands', 'AX'),
    ('Albania', 'AL'),
    ('Algeria', 'DZ'),
    ('American Samoa', 'AS'),
    ('Andorra', 'AD'),
    ('Angola', 'AO'),
    ('Anguilla', 'AI'),
    ('Antarctica', 'AQ'),
    ('Antigua And Barbuda', 'AG'),
    ('Argentina', 'AR'),
    ('Armenia', 'AM'),
    ('Aruba', 'AW'),
    ('Australia', 'AU'),
    ('Austria', 'AT'),
    ('Azerbaijan', 'AZ'),
    ('The Bahamas', 'BS'),
    ('Bahrain', 'BH'),
    ('Bangladesh', 'BD'),
    ('Barbados', 'BB'),
    ('Belarus', 'BY'),
    ('Belgium', 'BE'),
    ('Belize', 'BZ'),
    ('Benin', 'BJ'),
    ('Bermuda', 'BM'),
    ('Bhutan', 'BT'),
    ('Bolivia', 'BO'),
    ('Bosnia and Herzegovina', 'BA'),
    ('Botswana', 'BW'),
    ('Bouvet Island', 'BV'),
    ('Brazil', 'BR'),
    ('British Indian Ocean Territory', 'IO'),
    ('Brunei', 'BN'),
    ('Bulgaria', 'BG'),
    ('Burkina Faso', 'BF'),
    ('Burundi', 'BI'),
    ('Cambodia', 'KH'),
    ('Cameroon', 'CM'),
    ('Canada', 'CA'),
    ('Cape Verde', 'CV'),
    ('Cayman Islands', 'KY'),
    ('Central African Republic', 'CF'),
    ('Chad', 'TD'),
    ('Chile', 'CL'),
    ('China', 'CN'),
    ('Christmas Island', 'CX'),
    ('Cocos (Keeling) Islands', 'CC'),
    ('Colombia', 'CO'),
    ('Comoros', 'KM'),
    ('Congo', 'CG'),
    ('Democratic Republic of the Congo', 'CD'),
    ('Cook Islands', 'CK'),
    ('Costa Rica', 'CR'),
    ('Cote D''Ivoire (Ivory Coast)', 'CI'),
    ('Croatia', 'HR'),
    ('Cuba', 'CU'),
    ('Cyprus', 'CY'),
    ('Czech Republic', 'CZ'),
    ('Denmark', 'DK'),
    ('Djibouti', 'DJ'),
    ('Dominica', 'DM'),
    ('Dominican Republic', 'DO'),
    ('East Timor', 'TL'),
    ('Ecuador', 'EC'),
    ('Egypt', 'EG'),
    ('El Salvador', 'SV'),
    ('Equatorial Guinea', 'GQ'),
    ('Eritrea', 'ER'),
    ('Estonia', 'EE'),
    ('Ethiopia', 'ET'),
    ('Falkland Islands', 'FK'),
    ('Faroe Islands', 'FO'),
    ('Fiji Islands', 'FJ'),
    ('Finland', 'FI'),
    ('France', 'FR'),
    ('French Guiana', 'GF'),
    ('French Polynesia', 'PF'),
    ('French Southern Territories', 'TF'),
    ('Gabon', 'GA'),
    ('The Gambia', 'GM'),
    ('Georgia', 'GE'),
    ('Germany', 'DE'),
    ('Ghana', 'GH'),
    ('Gibraltar', 'GI'),
    ('Greece', 'GR'),
    ('Greenland', 'GL'),
    ('Grenada', 'GD'),
    ('Guadeloupe', 'GP'),
    ('Guam', 'GU'),
    ('Guatemala', 'GT'),
    ('Guernsey and Alderney', 'GG'),
    ('Guinea', 'GN'),
    ('Guinea-Bissau', 'GW'),
    ('Guyana', 'GY'),
    ('Haiti', 'HT'),
    ('Heard Island and McDonald Islands', 'HM'),
    ('Honduras', 'HN'),
    ('Hong Kong S.A.R.', 'HK'),
    ('Hungary', 'HU'),
    ('Iceland', 'IS'),
    ('India', 'IN'),
    ('Indonesia', 'ID'),
    ('Iran', 'IR'),
    ('Iraq', 'IQ'),
    ('Ireland', 'IE'),
    ('Israel', 'IL'),
    ('Italy', 'IT'),
    ('Jamaica', 'JM'),
    ('Japan', 'JP'),
    ('Jersey', 'JE'),
    ('Jordan', 'JO'),
    ('Kazakhstan', 'KZ'),
    ('Kenya', 'KE'),
    ('Kiribati', 'KI'),
    ('North Korea', 'KP'),
    ('South Korea', 'KR'),
    ('Kuwait', 'KW'),
    ('Kyrgyzstan', 'KG'),
    ('Laos', 'LA'),
    ('Latvia', 'LV'),
    ('Lebanon', 'LB'),
    ('Lesotho', 'LS'),
    ('Liberia', 'LR'),
    ('Libya', 'LY'),
    ('Liechtenstein', 'LI'),
    ('Lithuania', 'LT'),
    ('Luxembourg', 'LU'),
    ('Macau S.A.R.', 'MO'),
    ('Macedonia', 'MK'),
    ('Madagascar', 'MG'),
    ('Malawi', 'MW'),
    ('Malaysia', 'MY'),
    ('Maldives', 'MV'),
    ('Mali', 'ML'),
    ('Malta', 'MT'),
    ('Man (Isle of)', 'IM'),
    ('Marshall Islands', 'MH'),
    ('Martinique', 'MQ'),
    ('Mauritania', 'MR'),
    ('Mauritius', 'MU'),
    ('Mayotte', 'YT'),
    ('Mexico', 'MX'),
    ('Micronesia', 'FM'),
    ('Moldova', 'MD'),
    ('Monaco', 'MC'),
    ('Mongolia', 'MN'),
    ('Montenegro', 'ME'),
    ('Montserrat', 'MS'),
    ('Morocco', 'MA'),
    ('Mozambique', 'MZ'),
    ('Myanmar', 'MM'),
    ('Namibia', 'NA'),
    ('Nauru', 'NR'),
    ('Nepal', 'NP'),
    ('Bonaire, Sint Eustatius and Saba', 'BQ'),
    ('Netherlands', 'NL'),
    ('New Caledonia', 'NC'),
    ('New Zealand', 'NZ'),
    ('Nicaragua', 'NI'),
    ('Niger', 'NE'),
    ('Nigeria', 'NG'),
    ('Niue', 'NU'),
    ('Norfolk Island', 'NF'),
    ('Northern Mariana Islands', 'MP'),
    ('Norway', 'NO'),
    ('Oman', 'OM'),
    ('Pakistan', 'PK'),
    ('Palau', 'PW'),
    ('Palestinian Territory Occupied', 'PS'),
    ('Panama', 'PA'),
    ('Papua new Guinea', 'PG'),
    ('Paraguay', 'PY'),
    ('Peru', 'PE'),
    ('Philippines', 'PH'),
    ('Pitcairn Island', 'PN'),
    ('Poland', 'PL'),
    ('Portugal', 'PT'),
    ('Puerto Rico', 'PR'),
    ('Qatar', 'QA'),
    ('Reunion', 'RE'),
    ('Romania', 'RO'),
    ('Russia', 'RU'),
    ('Rwanda', 'RW'),
    ('Saint Helena', 'SH'),
    ('Saint Kitts And Nevis', 'KN'),
    ('Saint Lucia', 'LC'),
    ('Saint Pierre and Miquelon', 'PM'),
    ('Saint Vincent And The Grenadines', 'VC'),
    ('Saint-Barthelemy', 'BL'),
    ('Saint-Martin (French part)', 'MF'),
    ('Samoa', 'WS'),
    ('San Marino', 'SM'),
    ('Sao Tome and Principe', 'ST'),
    ('Saudi Arabia', 'SA'),
    ('Senegal', 'SN'),
    ('Serbia', 'RS'),
    ('Seychelles', 'SC'),
    ('Sierra Leone', 'SL'),
    ('Singapore', 'SG'),
    ('Slovakia', 'SK'),
    ('Slovenia', 'SI'),
    ('Solomon Islands', 'SB'),
    ('Somalia', 'SO'),
    ('South Africa', 'ZA'),
    ('South Georgia', 'GS'),
    ('South Sudan', 'SS'),
    ('Spain', 'ES'),
    ('Sri Lanka', 'LK'),
    ('Sudan', 'SD'),
    ('Suriname', 'SR'),
    ('Svalbard And Jan Mayen Islands', 'SJ'),
    ('Swaziland', 'SZ'),
    ('Sweden', 'SE'),
    ('Switzerland', 'CH'),
    ('Syria', 'SY'),
    ('Taiwan', 'TW'),
    ('Tajikistan', 'TJ'),
    ('Tanzania', 'TZ'),
    ('Thailand', 'TH'),
    ('Togo', 'TG'),
    ('Tokelau', 'TK'),
    ('Tonga', 'TO'),
    ('Trinidad And Tobago', 'TT'),
    ('Tunisia', 'TN'),
    ('Turkey', 'TR'),
    ('Turkmenistan', 'TM'),
    ('Turks And Caicos Islands', 'TC'),
    ('Tuvalu', 'TV'),
    ('Uganda', 'UG'),
    ('Ukraine', 'UA'),
    ('United Arab Emirates', 'AE'),
    ('United Kingdom', 'GB'),
    ('United States', 'US'),
    ('United States Minor Outlying Islands', 'UM'),
    ('Uruguay', 'UY'),
    ('Uzbekistan', 'UZ'),
    ('Vanuatu', 'VU'),
    ('Vatican City State (Holy See)', 'VA'),
    ('Venezuela', 'VE'),
    ('Vietnam', 'VN'),
    ('Virgin Islands (British)', 'VG'),
    ('Virgin Islands (US)', 'VI'),
    ('Wallis And Futuna Islands', 'WF'),
    ('Western Sahara', 'EH'),
    ('Yemen', 'YE'),
    ('Zambia', 'ZM'),
    ('Zimbabwe', 'ZW'),
    ('Kosovo', 'XK'),
    ('Curaçao', 'CW'),
    ('Sint Maarten (Dutch part)', 'SX')
) as m(country_name, iso)
where p.country = m.country_name
  and p.country_code is null;


-- ============================================================
-- 4. NON-BLOCKING REPORT — never aborts the migration (per requirement:
--    "unresolved historical rows may remain null for now, but the
--    migration must report them explicitly"). Emits a NOTICE visible in
--    the Supabase SQL editor's output for this run; the durable,
--    re-runnable version of the same check is verification query 4
--    below.
-- ============================================================

do $$
declare
  unresolved integer;
begin
  select count(*) into unresolved
  from public.profiles
  where country is not null
    and country_code is null;

  if unresolved > 0 then
    raise notice
      '% profiles row(s) have a country value that did not match the current country-state-city name list and remain country_code = null. See verification query 4 to list them.',
      unresolved;
  else
    raise notice 'All profiles rows with a non-null country resolved a country_code.';
  end if;
end;
$$;


commit;


-- ============================================================
-- VERIFY (optional — read-only, safe to run or skip, run AFTER the
-- transaction above has committed)
-- ============================================================

-- 1. country_code column exists, is nullable, references
--    country_continent.
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'profiles'
  and column_name = 'country_code';
-- Expect: is_nullable = 'YES', column_default = null.

-- 2. country_continent has all 250 rows, one row per country_code, and
--    a sane distribution across the 7 continents.
select count(*) as total_rows from public.country_continent;
-- Expect: 250.

select continent, count(*) as country_count
from public.country_continent
group by continent
order by continent;

-- 3. How many profiles resolved a country_code vs. did not.
select
  count(*) filter (where country_code is not null) as resolved,
  count(*) filter (where country_code is null and country is not null) as unresolved,
  count(*) filter (where country is null) as no_country_at_all
from public.profiles;

-- 4. THE list you asked for — every profile whose stored country string
--    did not match. Empty result = clean backfill, exactly as expected
--    given the onboarding form's constrained picklist. Please run this
--    and share the result — I have no way to query it myself in this
--    environment (see migration header).
select id, country, region
from public.profiles
where country is not null
  and country_code is null;

-- 5. Spot-check: a sample of resolved rows with their derived continent,
--    to visually confirm the join makes sense.
select p.id, p.country, p.country_code, cc.continent
from public.profiles p
join public.country_continent cc on cc.country_code = p.country_code
limit 20;

-- 6. Confirm country_continent is NOT reachable by anon/authenticated —
--    both EXISTS checks below should return false, and RLS should be on.
select relrowsecurity as rls_enabled
from pg_class
where relname = 'country_continent' and relnamespace = 'public'::regnamespace;
-- Expect: true.

select exists (
  select 1 from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'country_continent'
    and grantee = 'authenticated' and privilege_type = 'SELECT'
) as authenticated_can_select;
-- Expect: false.

select exists (
  select 1 from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'country_continent'
    and grantee = 'anon' and privilege_type = 'SELECT'
) as anon_can_select;
-- Expect: false.
