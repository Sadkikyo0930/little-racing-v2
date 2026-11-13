ALTER TABLE public.r5_game_override
  ADD COLUMN IF NOT EXISTS account_name text,
  ADD COLUMN IF NOT EXISTS session_until timestamptz;

CREATE OR REPLACE FUNCTION public.r5_override_internal_only()
RETURNS void LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'R5_INTERNAL_ONLY' USING ERRCODE = '42501';
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.r5_parent_override_issue(
  p_family_id text, p_device text, p_account text, p_ttl_seconds integer DEFAULT 120
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  today_date date := timezone('Asia/Shanghai', clock_timestamp())::date;
  now_ts timestamptz := clock_timestamp();
  claims jsonb; uid text; role_name text; member_role text;
  cfg record; usage record; dev record;
  limit_seconds integer; used_seconds integer; remaining integer;
  ttl integer; exp timestamptz;
BEGIN
  PERFORM public.r5_override_internal_only();
  claims := COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  uid := claims->>'sub';
  role_name := claims->>'role';
  IF role_name IS DISTINCT FROM 'authenticated' OR uid IS NULL OR length(uid) < 1 THEN
    RAISE EXCEPTION 'R5_AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;
  IF p_device IS NULL OR length(btrim(p_device)) < 1 THEN
    RAISE EXCEPTION 'R5_DEVICE_REQUIRED';
  END IF;
  SELECT m.member_role INTO member_role
    FROM public.growth_family_members m
   WHERE m.family_id = p_family_id AND m.user_id = uid
     AND m.member_role IN ('owner', 'parent', 'grandparent')
   LIMIT 1;
  IF member_role IS NULL THEN
    RAISE EXCEPTION 'R5_MEMBER_DENIED' USING ERRCODE = '42501';
  END IF;
  SELECT device_uid, family_id, revoked_at INTO dev
    FROM public.r5_device WHERE device_uid = p_device LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'R5_DEVICE_NOT_BOUND'; END IF;
  IF dev.family_id <> p_family_id THEN RAISE EXCEPTION 'R5_DEVICE_FAMILY_MISMATCH'; END IF;
  IF dev.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'R5_DEVICE_REVOKED'; END IF;
  SELECT enabled, daily_seconds, bonus_seconds INTO cfg
    FROM public.r5_parent_settings WHERE family_id = p_family_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'R5_SETTINGS_MISSING'; END IF;
  IF NOT cfg.enabled THEN RAISE EXCEPTION 'R5_PARENT_CONTROL_DISABLED'; END IF;
  SELECT used_ms INTO usage FROM public.r5_daily_usage
   WHERE family_id = p_family_id AND play_date = today_date;
  used_seconds := CASE WHEN FOUND THEN ceil(usage.used_ms / 1000.0)::integer ELSE 0 END;
  limit_seconds := cfg.daily_seconds + cfg.bonus_seconds;
  remaining := greatest(0, limit_seconds - used_seconds);
  IF remaining <= 0 THEN RAISE EXCEPTION 'R5_TIME_LIMIT_REACHED'; END IF;
  ttl := greatest(30, least(300, COALESCE(p_ttl_seconds, 120)));
  exp := now_ts + make_interval(secs => ttl);
  INSERT INTO public.r5_game_override
    (family_id, device_uid, parent_uid, account_name, scope, play_date,
     granted_at, expires_at, consumed_at, session_until)
  VALUES
    (p_family_id, p_device, uid, left(COALESCE(p_account, ''), 40), 'skip_learning_only', today_date,
     now_ts, exp, NULL, NULL)
  ON CONFLICT (family_id, device_uid, play_date) DO UPDATE
    SET parent_uid = excluded.parent_uid,
        account_name = excluded.account_name,
        scope = excluded.scope,
        granted_at = excluded.granted_at,
        expires_at = excluded.expires_at,
        consumed_at = NULL,
        session_until = NULL;
  DELETE FROM public.r5_game_override WHERE play_date < today_date - 7;
  INSERT INTO public.r5_parent_audit(family_id, action, play_date, actor, detail)
  VALUES (p_family_id, 'game_override_grant', today_date, uid,
          jsonb_build_object('device_uid', p_device, 'account', left(COALESCE(p_account, ''), 40),
                             'member_role', member_role, 'scope', 'skip_learning_only',
                             'expires_at', exp, 'remaining_seconds', remaining, 'ttl_seconds', ttl));
  RETURN jsonb_build_object(
    'api', 'r5_parent_session',
    'authorized', true,
    'family_id', p_family_id,
    'device', p_device,
    'scope', 'skip_learning_only',
    'member_role', member_role,
    'daily_seconds', cfg.daily_seconds,
    'bonus_seconds', cfg.bonus_seconds,
    'used_seconds', used_seconds,
    'remaining_seconds', remaining,
    'expires_at', to_char(exp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'ttl_seconds', ttl,
    'single_use', true);
END $function$;

CREATE OR REPLACE FUNCTION public.r5_override_consume(p_family_id text, p_device text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  today_date date := timezone('Asia/Shanghai', clock_timestamp())::date;
  hit integer;
BEGIN
  PERFORM public.r5_override_internal_only();
  UPDATE public.r5_game_override o
     SET consumed_at = clock_timestamp(),
         session_until = clock_timestamp() + interval '150 seconds'
   WHERE o.family_id = p_family_id
     AND o.device_uid = p_device
     AND o.play_date = today_date
     AND o.scope = 'skip_learning_only'
     AND o.consumed_at IS NULL
     AND o.expires_at > clock_timestamp()
     AND EXISTS (SELECT 1 FROM public.r5_device d
                  WHERE d.device_uid = p_device AND d.family_id = p_family_id
                    AND d.revoked_at IS NULL)
  RETURNING 1 INTO hit;
  RETURN hit IS NOT NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.r5_override_touch(p_family_id text, p_device text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  today_date date := timezone('Asia/Shanghai', clock_timestamp())::date;
  hit integer;
BEGIN
  PERFORM public.r5_override_internal_only();
  UPDATE public.r5_game_override o
     SET session_until = clock_timestamp() + interval '150 seconds'
   WHERE o.family_id = p_family_id
     AND o.device_uid = p_device
     AND o.play_date = today_date
     AND o.consumed_at IS NOT NULL
     AND o.session_until IS NOT NULL
     AND o.session_until > clock_timestamp()
     AND EXISTS (SELECT 1 FROM public.r5_device d
                  WHERE d.device_uid = p_device AND d.family_id = p_family_id
                    AND d.revoked_at IS NULL)
  RETURNING 1 INTO hit;
  RETURN hit IS NOT NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.r5_override_close(p_family_id text, p_device text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  today_date date := timezone('Asia/Shanghai', clock_timestamp())::date;
BEGIN
  PERFORM public.r5_override_internal_only();
  UPDATE public.r5_game_override
     SET session_until = NULL
   WHERE family_id = p_family_id AND device_uid = p_device AND play_date = today_date;
END $function$;

CREATE OR REPLACE FUNCTION public.r5_override_active(p_family_id text, p_device text, p_entry boolean)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  today_date date := timezone('Asia/Shanghai', clock_timestamp())::date;
  hit boolean;
BEGIN
  IF p_entry THEN
    SELECT EXISTS (
      SELECT 1 FROM public.r5_game_override o
       WHERE o.family_id = p_family_id AND o.device_uid = p_device
         AND o.play_date = today_date AND o.scope = 'skip_learning_only'
         AND o.consumed_at IS NULL AND o.expires_at > clock_timestamp()
    ) INTO hit;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.r5_game_override o
       WHERE o.family_id = p_family_id AND o.device_uid = p_device
         AND o.play_date = today_date AND o.scope = 'skip_learning_only'
         AND ((o.consumed_at IS NULL AND o.expires_at > clock_timestamp())
           OR (o.consumed_at IS NOT NULL AND o.session_until IS NOT NULL
               AND o.session_until > clock_timestamp()))
    ) INTO hit;
  END IF;
  RETURN COALESCE(hit, false);
END $function$;

CREATE OR REPLACE FUNCTION public.r5_gate_status(p_family_id text, p_entry boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  today_date date := timezone('Asia/Shanghai', clock_timestamp())::date;
  user_id text; cfg record; plan record; usage record; subject_name text;
  total_count integer; correct_count integer; finished boolean; waived boolean;
  item_pass boolean; all_pass boolean := true; any_waived boolean := false;
  module_states jsonb := '[]'::jsonb;
  limit_seconds integer; used_seconds integer; remaining integer;
  permitted boolean; why text; is_active boolean := false;
  override_active boolean := false; study_ok boolean;
BEGIN
  user_id := public.r5_assert_member(p_family_id, false);
  override_active := public.r5_override_active(p_family_id, user_id, p_entry);
  SELECT enabled, daily_seconds, bonus_seconds INTO cfg
    FROM public.r5_parent_settings WHERE family_id = p_family_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'R5_SETTINGS_MISSING'; END IF;
  SELECT day_index, subjects, published INTO plan
    FROM public.r5_daily_plan WHERE family_id = p_family_id AND study_date = today_date;
  IF NOT FOUND OR NOT plan.published THEN
    all_pass := false; why := 'PLAN_UNPUBLISHED';
  ELSIF jsonb_array_length(plan.subjects) = 0 THEN
    why := 'NO_TASKS_TODAY';
  ELSE
    FOR subject_name IN SELECT jsonb_array_elements_text(plan.subjects) LOOP
      waived := false;
      SELECT count(*)::integer,
             count(*) FILTER (WHERE r.record_data #>> '{answer,correct}' = 'true')::integer
      INTO total_count, correct_count
      FROM public.growth_learning_records r
      WHERE r.family_id = p_family_id AND r.record_type = 'answer'
        AND r.subject = subject_name AND r.learning_day = plan.day_index
        AND left(r.record_data #>> '{answer,date}', 10) = today_date::text
        AND r.record_data #>> '{answer,correct}' IN ('true', 'false');
      SELECT EXISTS (
        SELECT 1 FROM public.growth_learning_records r
        WHERE r.family_id = p_family_id AND r.record_type = 'course-complete'
          AND r.subject = subject_name AND r.learning_day = plan.day_index
          AND CASE
            WHEN r.record_data->>'completed_at' ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T'
            THEN ((r.record_data->>'completed_at')::timestamptz AT TIME ZONE 'Asia/Shanghai')::date
            ELSE NULL::date END = today_date
      ) INTO finished;
      item_pass := finished AND total_count > 0 AND correct_count * 100 >= 80 * total_count;
      IF NOT item_pass AND finished AND total_count = 0 THEN
        PERFORM 1 FROM public.r5_parent_waiver w
         WHERE w.family_id = p_family_id AND w.study_date = today_date AND w.subject = subject_name;
        IF FOUND THEN waived := true; item_pass := true; any_waived := true; END IF;
      END IF;
      all_pass := all_pass AND item_pass;
      module_states := module_states || jsonb_build_array(jsonb_build_object(
        'subject', subject_name, 'completed', finished,
        'correct', correct_count, 'total', total_count,
        'accuracy_pct', CASE WHEN total_count > 0
            THEN round(correct_count * 100.0 / total_count, 1) ELSE NULL END,
        'waived', waived,
        'evidence', CASE
          WHEN total_count > 0 AND item_pass THEN 'SCORED'
          WHEN waived THEN 'COMPLETED_UNSCORED_WAIVED'
          WHEN total_count > 0 THEN 'SCORED_BELOW_THRESHOLD'
          WHEN finished THEN 'COMPLETED_UNSCORED'
          ELSE 'NOT_COMPLETED' END,
        'passed', item_pass));
    END LOOP;
    why := CASE WHEN all_pass THEN
             CASE WHEN any_waived THEN 'STUDY_PASSED_WITH_WAIVER' ELSE 'STUDY_PASSED' END
           ELSE 'STUDY_INCOMPLETE_OR_SCORE_UNVERIFIED' END;
  END IF;
  SELECT used_ms, active INTO usage FROM public.r5_daily_usage
   WHERE family_id = p_family_id AND play_date = today_date;
  IF FOUND THEN
    used_seconds := ceil(usage.used_ms / 1000.0)::integer; is_active := usage.active;
  ELSE
    used_seconds := 0;
  END IF;
  limit_seconds := cfg.daily_seconds + cfg.bonus_seconds;
  remaining := greatest(0, limit_seconds - used_seconds);
  study_ok := (all_pass AND why <> 'PLAN_UNPUBLISHED') OR override_active;
  permitted := (NOT cfg.enabled OR study_ok) AND remaining > 0;
  IF remaining = 0 THEN why := 'TIME_LIMIT_REACHED';
  ELSIF NOT cfg.enabled THEN why := 'PARENT_CONTROL_DISABLED';
  ELSIF override_active AND NOT (all_pass AND why <> 'PLAN_UNPUBLISHED') THEN
    why := 'STUDY_PASSED_WITH_WAIVER';
  END IF;
  RETURN jsonb_build_object(
    'api', 'r5_status', 'date', today_date,
    'allowed', permitted, 'reason', why,
    'parent_control', cfg.enabled,
    'daily_seconds', cfg.daily_seconds, 'bonus_seconds', cfg.bonus_seconds,
    'used_seconds', used_seconds, 'remaining_seconds', remaining,
    'active', is_active,
    'parent_override', override_active,
    'override_single_use', true,
    'modules', module_states,
    'schedule_published', COALESCE(plan.published, false),
    'study_day', plan.day_index);
END $function$;

CREATE OR REPLACE FUNCTION public.r5_status(p_family_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RETURN public.r5_gate_status(p_family_id, false);
END $function$;

CREATE OR REPLACE FUNCTION public.r5_child_entry(p_family_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  PERFORM public.r5_assert_member(p_family_id, false);
  RETURN public.r5_gate_status(p_family_id, true) || jsonb_build_object(
    'server_time', to_char(clock_timestamp() AT TIME ZONE 'Asia/Shanghai',
                           'YYYY-MM-DD"T"HH24:MI:SS'),
    'heartbeat_seconds', 10,
    'resume_same_day', true);
END $function$;

CREATE OR REPLACE FUNCTION public.r5_game_action(p_family_id text, p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  today_date date := timezone('Asia/Shanghai', clock_timestamp())::date;
  now_ts timestamptz := clock_timestamp();
  u record; s jsonb; uid text;
  max_ms bigint; elapsed_ms bigint := 0;
  consumed boolean := false;
BEGIN
  uid := public.r5_assert_member(p_family_id, false);
  IF p_action NOT IN ('start','tick','stop','status') THEN
    RAISE EXCEPTION 'R5_INVALID_ACTION';
  END IF;
  IF p_action = 'status' THEN RETURN public.r5_status(p_family_id); END IF;
  INSERT INTO public.r5_daily_usage(family_id, play_date)
  VALUES (p_family_id, today_date) ON CONFLICT DO NOTHING;
  SELECT * INTO u FROM public.r5_daily_usage
   WHERE family_id = p_family_id AND play_date = today_date FOR UPDATE;
  s := public.r5_gate_status(p_family_id, false);
  max_ms := ((s->>'daily_seconds')::bigint + (s->>'bonus_seconds')::bigint) * 1000;
  IF u.active AND u.last_beat IS NOT NULL THEN
    elapsed_ms := least(20000, greatest(0,
      floor(extract(epoch FROM (now_ts - u.last_beat)) * 1000)::bigint));
  END IF;
  u.used_ms := u.used_ms + least(elapsed_ms, greatest(0, max_ms - u.used_ms));
  IF p_action = 'start' THEN
    consumed := public.r5_override_consume(p_family_id, uid);
  END IF;
  IF consumed AND u.used_ms < max_ms THEN
    s := jsonb_set(s, '{allowed}', 'true'::jsonb);
    s := jsonb_set(s, '{parent_override}', 'true'::jsonb);
  END IF;
  IF p_action = 'stop' THEN
    u.active := false;
    PERFORM public.r5_override_close(p_family_id, uid);
  ELSIF u.used_ms >= max_ms THEN
    u.active := false;
    PERFORM public.r5_override_close(p_family_id, uid);
  ELSIF COALESCE((s->>'allowed')::boolean, false) AND p_action IN ('start','tick') THEN
    u.active := true;
    IF p_action = 'tick' THEN PERFORM public.r5_override_touch(p_family_id, uid); END IF;
  ELSE
    u.active := false;
  END IF;
  UPDATE public.r5_daily_usage
     SET used_ms = u.used_ms, active = u.active, last_beat = now_ts
   WHERE family_id = p_family_id AND play_date = today_date;
  s := public.r5_gate_status(p_family_id, false);
  IF consumed AND u.active THEN
    s := jsonb_set(s, '{allowed}', 'true'::jsonb);
    s := jsonb_set(s, '{parent_override}', 'true'::jsonb);
  END IF;
  RETURN s || jsonb_build_object('action', p_action,
    'charged_ms', elapsed_ms, 'active', u.active,
    'override_consumed', consumed);
END $function$;

CREATE OR REPLACE FUNCTION public.r5_game_action_md(p_family_id text, p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  today_date date := timezone('Asia/Shanghai', clock_timestamp())::date;
  now_ts timestamptz := clock_timestamp();
  uid text; key text; u record; s jsonb;
  max_ms bigint; elapsed_ms bigint := 0;
  playing boolean := false; allowed boolean := false;
  live_cnt integer := 0; hard_stop boolean := false;
  consumed boolean := false;
BEGIN
  uid := public.r5_assert_member(p_family_id, false);
  IF p_action NOT IN ('start','tick','stop','status') THEN
    RAISE EXCEPTION 'R5_INVALID_ACTION';
  END IF;
  IF p_action = 'status' THEN RETURN public.r5_status(p_family_id); END IF;
  key := md5(uid);
  INSERT INTO public.r5_daily_usage(family_id, play_date)
  VALUES (p_family_id, today_date) ON CONFLICT DO NOTHING;
  SELECT * INTO u FROM public.r5_daily_usage
   WHERE family_id = p_family_id AND play_date = today_date FOR UPDATE;
  s := public.r5_gate_status(p_family_id, false);
  max_ms := ((s->>'daily_seconds')::bigint + (s->>'bonus_seconds')::bigint) * 1000;
  IF p_action = 'start' THEN
    consumed := public.r5_override_consume(p_family_id, uid);
  END IF;
  allowed := COALESCE((s->>'allowed')::boolean, false) OR (consumed AND u.used_ms < max_ms);
  IF consumed AND u.used_ms < max_ms THEN
    s := jsonb_set(s, '{allowed}', 'true'::jsonb);
    s := jsonb_set(s, '{parent_override}', 'true'::jsonb);
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.r5_usage_session
     WHERE family_id = p_family_id AND play_date = today_date
       AND last_beat > now_ts - interval '45 seconds'
  ) INTO playing;
  IF playing AND u.last_beat IS NOT NULL THEN
    elapsed_ms := least(20000, greatest(0,
      floor(extract(epoch FROM (now_ts - u.last_beat)) * 1000)::bigint));
  END IF;
  u.used_ms := u.used_ms + least(elapsed_ms, greatest(0, max_ms - u.used_ms));
  DELETE FROM public.r5_usage_session
   WHERE family_id = p_family_id AND play_date = today_date
     AND last_beat <= now_ts - interval '45 seconds';
  IF p_action = 'start' THEN
    DELETE FROM public.r5_usage_session WHERE play_date < today_date - 7;
  END IF;
  hard_stop := (u.used_ms >= max_ms);
  IF hard_stop OR NOT allowed THEN
    DELETE FROM public.r5_usage_session
     WHERE family_id = p_family_id AND play_date = today_date;
    PERFORM public.r5_override_close(p_family_id, uid);
  ELSIF p_action = 'stop' THEN
    DELETE FROM public.r5_usage_session
     WHERE family_id = p_family_id AND play_date = today_date AND actor_key = key;
    PERFORM public.r5_override_close(p_family_id, uid);
  ELSE
    INSERT INTO public.r5_usage_session(family_id, play_date, actor_key, last_beat)
    VALUES (p_family_id, today_date, key, now_ts)
    ON CONFLICT (family_id, play_date, actor_key)
    DO UPDATE SET last_beat = excluded.last_beat;
    IF p_action = 'tick' THEN PERFORM public.r5_override_touch(p_family_id, uid); END IF;
  END IF;
  SELECT count(*)::integer INTO live_cnt
    FROM public.r5_usage_session
   WHERE family_id = p_family_id AND play_date = today_date;
  UPDATE public.r5_daily_usage
     SET used_ms = u.used_ms, active = (live_cnt > 0), last_beat = now_ts
   WHERE family_id = p_family_id AND play_date = today_date;
  s := public.r5_gate_status(p_family_id, false);
  IF consumed AND live_cnt > 0 THEN
    s := jsonb_set(s, '{allowed}', 'true'::jsonb);
    s := jsonb_set(s, '{parent_override}', 'true'::jsonb);
  END IF;
  RETURN s || jsonb_build_object(
    'action', p_action,
    'charged_ms', elapsed_ms,
    'active', (live_cnt > 0),
    'active_devices', live_cnt,
    'override_consumed', consumed,
    'engine', 'md-1');
END $function$;

CREATE OR REPLACE FUNCTION public.r5_parent_game_override_audit(
  p_family_id text, p_action text, p_detail jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE today_date date := timezone('Asia/Shanghai', clock_timestamp())::date;
BEGIN
  PERFORM public.r5_override_internal_only();
  IF p_action NOT IN ('game_override_failed_auth', 'game_override_throttled', 'game_override_denied') THEN
    RAISE EXCEPTION 'R5_INVALID_ACTION';
  END IF;
  INSERT INTO public.r5_parent_audit(family_id, action, play_date, actor, detail)
  VALUES (p_family_id, p_action, today_date, NULL, COALESCE(p_detail, '{}'::jsonb));
  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.r5_override_bind(p_family_id text, p_device text, p_remaining_seconds integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'R5_DEPRECATED_USE_OVERRIDE_CONSUME' USING ERRCODE = '42501';
END $function$;

CREATE OR REPLACE FUNCTION public.r5_parent_game_override(
  p_family_id text, p_device text, p_ttl_seconds integer DEFAULT 300
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'R5_DEPRECATED_USE_PARENT_SESSION' USING ERRCODE = '42501';
END $function$;

REVOKE ALL ON FUNCTION public.r5_override_bind(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r5_parent_game_override(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r5_parent_override_issue(text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r5_override_consume(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r5_override_touch(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r5_override_close(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r5_override_active(text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r5_gate_status(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r5_parent_game_override_audit(text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r5_override_internal_only() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.r5_parent_override_issue(text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.r5_override_consume(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.r5_override_touch(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.r5_override_close(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.r5_override_active(text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.r5_gate_status(text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.r5_parent_game_override_audit(text, text, jsonb) TO service_role;

GRANT EXECUTE ON FUNCTION public.r5_status(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.r5_child_entry(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.r5_game_action(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.r5_game_action_md(text, text) TO authenticated, service_role;

REVOKE ALL ON public.r5_game_override FROM PUBLIC, anon, authenticated;
