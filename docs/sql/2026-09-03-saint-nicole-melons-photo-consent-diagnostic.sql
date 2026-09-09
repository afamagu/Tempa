-- Tempa — read-only diagnostic for the Saint Nicole / Melons
-- photo-consent inconsistency.
-- PREPARED 2026-09-03. NOT EXECUTED. Pure SELECT — no CREATE / ALTER /
-- DROP / INSERT / UPDATE / DELETE.

with participants as (
  select id, pseudonym from public.profiles where pseudonym in ('Saint Nicole', 'Melons')
),
correspondence as (
  select c.*
  from public.correspondences c
  join participants p1 on p1.id = c.participant_low
  join participants p2 on p2.id = c.participant_high
),
consent_row as (
  select
    c.id as correspondence_id,
    c.participant_low,
    low_p.pseudonym as participant_low_name,
    c.participant_high,
    high_p.pseudonym as participant_high_name,
    c.photo_consent_status as status,
    c.photo_consent_requested_by as requested_by,
    req_p.pseudonym as requested_by_name,
    c.photo_consent_resolved_by as resolved_by,
    res_p.pseudonym as resolved_by_name,
    c.photo_consent_requested_at as requested_at,
    c.photo_consent_resolved_at as resolved_at
  from correspondence c
  join public.profiles low_p on low_p.id = c.participant_low
  join public.profiles high_p on high_p.id = c.participant_high
  left join public.profiles req_p on req_p.id = c.photo_consent_requested_by
  left join public.profiles res_p on res_p.id = c.photo_consent_resolved_by
),
letters_in_order as (
  select
    l.id as letter_id,
    l.created_at,
    sender_p.pseudonym as sender,
    recipient_p.pseudonym as recipient,
    exists (
      select 1 from public.moments m where m.letter_id = l.id and m.type = 'photo'
    ) as has_photo_moment,
    (
      select count(*) from public.moments m where m.letter_id = l.id and m.type = 'photo'
    ) as photo_moment_count
  from public.letters l
  join correspondence c on c.id = l.correspondence_id
  join public.profiles sender_p on sender_p.id = l.sender_id
  join public.profiles recipient_p on recipient_p.id = l.recipient_id
  order by l.created_at asc
)
select 'consent_row' as section, to_jsonb(consent_row) as detail from consent_row
union all
select 'letters_in_order' as section, jsonb_agg(to_jsonb(letters_in_order) order by created_at asc) as detail
from letters_in_order;
