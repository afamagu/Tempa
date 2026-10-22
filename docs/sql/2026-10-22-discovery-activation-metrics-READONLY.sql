-- Read-only funnel snapshot. No user content or private letters are returned.
-- Run after the release to understand where newcomers need help.
SELECT
  count(*) AS profiles,
  count(*) FILTER (WHERE p.auto_match_started_at IS NOT NULL) AS introductions_started,
  count(*) FILTER (WHERE p.auto_match_completed_at IS NOT NULL) AS introductions_completed,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM public.dispatches d WHERE d.author_id=p.id
      AND d.status='published' AND d.moderation_status='visible'
      AND d.published_as='member'
  )) AS profiles_with_open_letter,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM public.question_answers qa JOIN public.questions q ON q.id=qa.question_id
    WHERE qa.user_id=p.id AND q.slug='tempa-profile-introduction'
      AND qa.profile_intro_visible AND qa.moderation_status='visible'
  )) AS profiles_with_visible_introduction
FROM public.profiles p;
