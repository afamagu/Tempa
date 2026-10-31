-- Preserve production function; adjust only maximum batch size.
CREATE OR REPLACE FUNCTION public.discover_room_writers(p_country text DEFAULT NULL::text, p_language text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_gender text DEFAULT NULL::text, p_age_range text DEFAULT NULL::text, p_intent text DEFAULT NULL::text, p_interest text DEFAULT NULL::text, p_has_letter boolean DEFAULT true, p_seed text DEFAULT ''::text, p_after_user_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 6)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_viewer uuid := auth.uid();
  v_result jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 6), 1), 15);
BEGIN
  IF v_viewer IS NULL OR public.current_account_status() IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Active member required' USING errcode = '42501';
  END IF;
  IF length(coalesce(p_seed,'')) > 80 OR length(coalesce(p_search,'')) > 80 THEN
    RAISE EXCEPTION 'Invalid directory request' USING errcode = '22023';
  END IF;

  WITH eligible AS MATERIALIZED (
    SELECT
      p.id, p.pseudonym, p.country, p.gender, p.gender_custom, p.age_range, p.mark_id, p.languages,
      hashtextextended(p.id::text || ':' || coalesce(p_seed,''), 0) AS shuffle,
      latest.id AS latest_letter_id,
      latest.title AS latest_letter_title,
      left(latest.body, 750) AS latest_letter_body
    FROM public.public_profiles p
    JOIN public.profiles member ON member.id=p.id
      AND member.is_editorial IS DISTINCT FROM true
    LEFT JOIN LATERAL (
      SELECT d.id, d.title, d.body
      FROM public.dispatches d
      WHERE d.author_id = p.id
        AND d.status = 'published'
        AND d.moderation_status = 'visible'
        AND coalesce(d.published_as,'member') = 'member'
        AND tempa_private.author_content_publicly_visible(d.author_id)
      ORDER BY d.published_at DESC, d.id DESC
      LIMIT 1
    ) latest ON true
    WHERE p.id <> v_viewer
      AND NOT tempa_private.account_is_banned(p.id)
      AND NOT tempa_private.is_blocked_pair(v_viewer,p.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.account_deactivations ad
        WHERE ad.user_id = p.id AND ad.reactivated_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.account_closures ac WHERE ac.user_id = p.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.account_enforcement_state ae
        WHERE ae.user_id = p.id AND ae.status <> 'active'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.correspondences c
        JOIN public.correspondence_hidden_for_user h
          ON h.correspondence_id = c.id
        WHERE h.user_id = v_viewer
          AND (c.participant_low = p.id OR c.participant_high = p.id)
      )
      AND (NOT coalesce(p_has_letter,true) OR latest.id IS NOT NULL)
      AND (nullif(p_country,'') IS NULL OR p.country = p_country)
      AND (nullif(p_language,'') IS NULL OR p_language = any(p.languages))
      AND (
        nullif(btrim(p_search),'') IS NULL OR
        position(lower(btrim(p_search)) in lower(concat_ws(' ',p.pseudonym,p.country,array_to_string(p.languages,' ')))) > 0
      )
      AND (nullif(p_gender,'') IS NULL OR p.gender = p_gender OR
        (p.gender = 'Self-describe' AND p.gender_custom = p_gender))
      AND (nullif(p_age_range,'') IS NULL OR p.age_range = p_age_range)
      AND (nullif(p_intent,'') IS NULL OR p_intent = any(p.intent))
      AND (nullif(p_interest,'') IS NULL OR EXISTS (
        SELECT 1 FROM public.profile_interests pi
        WHERE pi.viewer_user_id = p.id AND pi.interest_key = p_interest
      ))
  ),
  remaining AS MATERIALIZED (
    SELECT e.*
    FROM eligible e
    WHERE p_after_user_id IS NULL OR (e.shuffle,e.id) > (
      hashtextextended(p_after_user_id::text || ':' || coalesce(p_seed,''),0),
      p_after_user_id
    )
  ),
  numbered AS (
    SELECT remaining.*, row_number() OVER (ORDER BY shuffle,id) AS rn
    FROM remaining
  )
  SELECT jsonb_build_object(
    'has_more', EXISTS (SELECT 1 FROM numbered WHERE rn > v_limit),
    'entries', coalesce(
      (SELECT jsonb_agg(jsonb_build_object(
        'user_id', n.id,
        'pseudonym', n.pseudonym,
        'country', n.country,
        'gender', n.gender,
        'gender_custom', n.gender_custom,
        'age_range', n.age_range,
        'mark_id', n.mark_id,
        'languages', n.languages,
        'latest_letter_id', n.latest_letter_id,
        'latest_letter_title', n.latest_letter_title,
        'latest_letter_body', n.latest_letter_body
      ) ORDER BY n.rn)
      FROM numbered n WHERE n.rn <= v_limit),
      '[]'::jsonb
    )
  ) INTO v_result;
  RETURN v_result;
END;
$function$
;
