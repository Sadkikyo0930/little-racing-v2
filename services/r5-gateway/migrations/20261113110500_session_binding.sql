-- R5 session binding: one parent authorisation may create exactly one game session
-- Fixes: after the one-time ticket was consumed, repeating game/action start still
-- returned allowed=true because r5_override_active() treated the sliding
-- session_until window as an authorisation and start/status trusted it by device only.

ALTER TABLE public.r5_usage_session ADD COLUMN IF NOT EXISTS session_id text;
ALTER TABLE public.r5_usage_session ADD COLUMN IF NOT EXISTS origin text;
ALTER TABLE public.r5_usage_session ADD COLUMN IF NOT EXISTS device_uid text;
ALTER TABLE public.r5_game_override ADD COLUMN IF NOT EXISTS session_id text;
ALTER TABLE public.r5_game_override ADD COLUMN IF NOT EXISTS session_started_at timestamp with time zone;

CREATE UNIQUE INDEX IF NOT EXISTS r5_usage_session_sid_uk
  ON public.r5_usage_session (family_id, session_id)
  WHERE session_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.r5_session_live(p_family_id text, p_device text, p_session_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
  SELECT (p_session_id IS NOT NULL) AND EXISTS (
    SELECT 1 FROM public.r5_usage_session s
     WHERE s.family_id = p_family_id
       AND s.play_date = timezone('Asia/Shanghai', clock_timestamp())::date
       AND s.actor_key = md5(p_device)
       AND s.session_id = p_session_id
       AND s.last_beat > clock_timestamp() - interval '45 seconds');
$fn$;

CREATE OR REPLACE FUNCTION public.r5_session_open(p_family_id text, p_device text, p_origin text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
DECLARE
  today_date date := timezone('Asia/Shanghai', clock_timestamp())::date;
  sid text := replace(gen_random_uuid()::text, '-', '');
BEGIN
  INSERT INTO public.r5_usage_session(family_id, play_date, actor_key, last_beat, started_at, session_id, origin, device_uid)
  VALUES (p_family_id, today_date, md5(p_device), clock_timestamp(), clock_timestamp(), sid, p_origin, p_device)
  ON CONFLICT (family_id, play_date, actor_key) DO UPDATE
    SET session_id = sid,
        origin = p_origin,
        device_uid = p_device,
        last_beat = clock_timestamp(),
        started_at = clock_timestamp();
  RETURN sid;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.r5_session_beat(p_family_id text, p_device text, p_session_id text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
DECLARE
  n integer := 0;
BEGIN
  UPDATE public.r5_usage_session s
     SET last_beat = clock_timestamp()
   WHERE s.family_id = p_family_id
     AND s.play_date = timezone('Asia/Shanghai', clock_timestamp())::date
     AND s.actor_key = md5(p_device)
     AND s.session_id = p_session_id
     AND s.last_beat > clock_timestamp() - interval '45 seconds';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.r5_session_close(p_family_id text, p_device text, p_session_id text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
DECLARE
  n integer := 0;
BEGIN
  DELETE FROM public.r5_usage_session s
   WHERE s.family_id = p_family_id
     AND s.play_date = timezone('Asia/Shanghai', clock_timestamp())::date
     AND s.actor_key = md5(p_device)
     AND (p_session_id IS NULL OR s.session_id = p_session_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.r5_override_bind_session(p_family_id text, p_device text, p_session_id text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
  UPDATE public.r5_game_override o
     SET session_id = p_session_id,
         session_started_at = clock_timestamp()
   WHERE o.family_id = p_family_id
     AND o.device_uid = p_device
     AND o.play_date = timezone('Asia/Shanghai', clock_timestamp())::date
     AND o.consumed_at IS NOT NULL;
$fn$;

CREATE OR REPLACE FUNCTION public.r5_override_active(p_family_id text, p_device text, p_entry boolean)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
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
        JOIN public.r5_usage_session s
          ON s.family_id = o.family_id
         AND s.play_date = o.play_date
         AND s.actor_key = md5(o.device_uid)
       WHERE o.family_id = p_family_id AND o.device_uid = p_device
         AND o.play_date = today_date AND o.scope = 'skip_learning_only'
         AND o.consumed_at IS NOT NULL
         AND o.session_until IS NOT NULL AND o.session_until > clock_timestamp()
         AND o.session_id IS NOT NULL AND s.session_id = o.session_id
         AND s.last_beat > clock_timestamp() - interval '45 seconds'
    ) INTO hit;
  END IF;
  RETURN COALESCE(hit, false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.r5_gate_status_core(p_family_id text, p_entry boolean, p_ignore_override boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
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
  IF NOT p_ignore_override THEN
    override_active := public.r5_override_active(p_family_id, user_id, p_entry);
  END IF;
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
    'study_passed', (all_pass AND why <> 'PLAN_UNPUBLISHED'),
    'override_single_use', true,
    'session_bound', true,
    'modules', module_states,
    'schedule_published', COALESCE(plan.published, false),
    'study_day', plan.day_index);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.r5_gate_status(p_family_id text, p_entry boolean DEFAULT false)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
  SELECT public.r5_gate_status_core(p_family_id, p_entry, false);
$fn$;

CREATE OR REPLACE FUNCTION public.r5_game_action_v2(p_family_id text, p_action text, p_session_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
DECLARE
  today_date date := timezone('Asia/Shanghai', clock_timestamp())::date;
  now_ts timestamptz := clock_timestamp();
  uid text; u record; s jsonb; study_s jsonb;
  max_ms bigint; elapsed_ms bigint := 0;
  consumed boolean := false; resumed boolean := false;
  sid text; origin text; live boolean := false; session_ok boolean := false;
  why text;
BEGIN
  uid := public.r5_assert_member(p_family_id, false);
  IF p_action NOT IN ('start','tick','stop','status') THEN
    RAISE EXCEPTION 'R5_INVALID_ACTION' USING ERRCODE='22023';
  END IF;
  IF p_action = 'status' THEN RETURN public.r5_status(p_family_id); END IF;
  IF p_session_id IS NOT NULL AND p_session_id !~ '^[a-f0-9]{32}$' THEN
    RAISE EXCEPTION 'R5_INVALID_SESSION_ID' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.r5_daily_usage(family_id, play_date)
  VALUES (p_family_id, today_date) ON CONFLICT DO NOTHING;
  SELECT * INTO u FROM public.r5_daily_usage
   WHERE family_id = p_family_id AND play_date = today_date FOR UPDATE;
  study_s := public.r5_gate_status_core(p_family_id, false, true);
  max_ms := ((study_s->>'daily_seconds')::bigint + (study_s->>'bonus_seconds')::bigint) * 1000;
  IF u.active AND u.last_beat IS NOT NULL THEN
    elapsed_ms := least(20000, greatest(0,
      floor(extract(epoch FROM (now_ts - u.last_beat)) * 1000)::bigint));
  END IF;
  u.used_ms := u.used_ms + least(elapsed_ms, greatest(0, max_ms - u.used_ms));

  SELECT s2.session_id, s2.origin INTO sid, origin
    FROM public.r5_usage_session s2
   WHERE s2.family_id = p_family_id AND s2.play_date = today_date
     AND s2.actor_key = md5(uid);
  IF NOT FOUND THEN
    sid := NULL; origin := NULL; live := false;
  ELSE
    live := public.r5_session_live(p_family_id, uid, sid);
    IF origin = 'parent_override' THEN
      live := live AND public.r5_override_active(p_family_id, uid, false);
    END IF;
  END IF;

  IF p_action = 'start' THEN
    consumed := public.r5_override_consume(p_family_id, uid);
    IF consumed THEN
      sid := public.r5_session_open(p_family_id, uid, 'parent_override');
      PERFORM public.r5_override_bind_session(p_family_id, uid, sid);
      origin := 'parent_override'; live := true;
      session_ok := (u.used_ms < max_ms);
    ELSIF p_session_id IS NOT NULL AND sid = p_session_id AND live THEN
      PERFORM public.r5_session_beat(p_family_id, uid, p_session_id);
      resumed := true; session_ok := (u.used_ms < max_ms);
    ELSIF COALESCE((study_s->>'allowed')::boolean, false) THEN
      sid := public.r5_session_open(p_family_id, uid, 'study');
      origin := 'study'; live := true; session_ok := true;
    ELSE
      PERFORM public.r5_session_close(p_family_id, uid, NULL);
      PERFORM public.r5_override_close(p_family_id, uid);
      sid := NULL; origin := NULL; live := false; session_ok := false;
      why := 'SESSION_REQUIRED';
    END IF;
  ELSIF p_action = 'tick' THEN
    IF origin = 'parent_override' THEN
      IF p_session_id IS NOT NULL AND sid = p_session_id AND live THEN
        PERFORM public.r5_session_beat(p_family_id, uid, p_session_id);
        PERFORM public.r5_override_touch(p_family_id, uid);
        session_ok := (u.used_ms < max_ms);
      ELSE
        PERFORM public.r5_session_close(p_family_id, uid, NULL);
        PERFORM public.r5_override_close(p_family_id, uid);
        sid := NULL; origin := NULL; live := false;
        why := 'SESSION_REQUIRED';
      END IF;
    ELSIF COALESCE((study_s->>'allowed')::boolean, false) THEN
      IF sid IS NOT NULL AND p_session_id IS NOT NULL AND p_session_id = sid AND live THEN
        PERFORM public.r5_session_beat(p_family_id, uid, p_session_id);
        origin := COALESCE(origin, 'study');
      ELSE
        sid := public.r5_session_open(p_family_id, uid, 'study');
        origin := 'study';
      END IF;
      live := true; session_ok := true;
    ELSE
      PERFORM public.r5_session_close(p_family_id, uid, NULL);
      PERFORM public.r5_override_close(p_family_id, uid);
      sid := NULL; origin := NULL; live := false; session_ok := false;
      why := 'SESSION_REQUIRED';
    END IF;
  ELSE
    PERFORM public.r5_session_close(p_family_id, uid, NULL);
    PERFORM public.r5_override_close(p_family_id, uid);
    sid := NULL; origin := NULL; live := false; session_ok := false;
  END IF;

  IF u.used_ms >= max_ms THEN
    PERFORM public.r5_session_close(p_family_id, uid, NULL);
    PERFORM public.r5_override_close(p_family_id, uid);
    sid := NULL; origin := NULL; live := false; session_ok := false;
    why := 'TIME_LIMIT_REACHED';
  END IF;

  u.active := (session_ok AND live);
  UPDATE public.r5_daily_usage
     SET used_ms = u.used_ms, active = u.active, last_beat = now_ts
   WHERE family_id = p_family_id AND play_date = today_date;

  s := public.r5_gate_status_core(p_family_id, false, true);
  s := jsonb_set(s, '{allowed}', to_jsonb(COALESCE(u.active, false)));
  s := jsonb_set(s, '{active}', to_jsonb(COALESCE(u.active, false)));
  s := jsonb_set(s, '{parent_override}',
        to_jsonb(origin = 'parent_override' AND COALESCE(u.active, false)));
  IF COALESCE(u.active, false) THEN
    s := jsonb_set(s, '{reason}', to_jsonb(
      CASE WHEN origin = 'parent_override' THEN 'STUDY_PASSED_WITH_WAIVER'
           ELSE COALESCE(s->>'reason', 'STUDY_PASSED') END));
  ELSE
    s := jsonb_set(s, '{reason}', to_jsonb(COALESCE(why, s->>'reason', 'SESSION_REQUIRED')));
  END IF;
  RETURN s || jsonb_build_object(
    'api', 'r5_status',
    'action', p_action,
    'charged_ms', elapsed_ms,
    'active', COALESCE(u.active, false),
    'active_devices', CASE WHEN u.active THEN 1 ELSE 0 END,
    'session_id', sid,
    'session_origin', origin,
    'session_resumed', resumed,
    'session_bound', (sid IS NOT NULL),
    'override_consumed', consumed,
    'heartbeat_seconds', 10,
    'engine', 'bound-1');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.r5_game_action_md_v2(p_family_id text, p_action text, p_session_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
DECLARE
  today_date date := timezone('Asia/Shanghai', clock_timestamp())::date;
  now_ts timestamptz := clock_timestamp();
  uid text; key text; u record; s jsonb; study_s jsonb;
  max_ms bigint; elapsed_ms bigint := 0;
  consumed boolean := false; resumed boolean := false;
  sid text; origin text; live boolean := false; session_ok boolean := false;
  playing boolean := false; live_cnt integer := 0; why text;
BEGIN
  uid := public.r5_assert_member(p_family_id, false);
  IF p_action NOT IN ('start','tick','stop','status') THEN
    RAISE EXCEPTION 'R5_INVALID_ACTION' USING ERRCODE='22023';
  END IF;
  IF p_action = 'status' THEN RETURN public.r5_status(p_family_id); END IF;
  IF p_session_id IS NOT NULL AND p_session_id !~ '^[a-f0-9]{32}$' THEN
    RAISE EXCEPTION 'R5_INVALID_SESSION_ID' USING ERRCODE='22023';
  END IF;
  key := md5(uid);
  INSERT INTO public.r5_daily_usage(family_id, play_date)
  VALUES (p_family_id, today_date) ON CONFLICT DO NOTHING;
  SELECT * INTO u FROM public.r5_daily_usage
   WHERE family_id = p_family_id AND play_date = today_date FOR UPDATE;
  study_s := public.r5_gate_status_core(p_family_id, false, true);
  max_ms := ((study_s->>'daily_seconds')::bigint + (study_s->>'bonus_seconds')::bigint) * 1000;
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

  SELECT s2.session_id, s2.origin INTO sid, origin
    FROM public.r5_usage_session s2
   WHERE s2.family_id = p_family_id AND s2.play_date = today_date
     AND s2.actor_key = key;
  IF NOT FOUND THEN
    sid := NULL; origin := NULL; live := false;
  ELSE
    live := public.r5_session_live(p_family_id, uid, sid);
    IF origin = 'parent_override' THEN
      live := live AND public.r5_override_active(p_family_id, uid, false);
    END IF;
  END IF;

  IF p_action = 'start' THEN
    consumed := public.r5_override_consume(p_family_id, uid);
    IF consumed THEN
      sid := public.r5_session_open(p_family_id, uid, 'parent_override');
      PERFORM public.r5_override_bind_session(p_family_id, uid, sid);
      origin := 'parent_override'; live := true;
      session_ok := (u.used_ms < max_ms);
    ELSIF p_session_id IS NOT NULL AND sid = p_session_id AND live THEN
      PERFORM public.r5_session_beat(p_family_id, uid, p_session_id);
      resumed := true; session_ok := (u.used_ms < max_ms);
    ELSIF COALESCE((study_s->>'allowed')::boolean, false) THEN
      sid := public.r5_session_open(p_family_id, uid, 'study');
      origin := 'study'; live := true; session_ok := true;
    ELSE
      PERFORM public.r5_session_close(p_family_id, uid, NULL);
      PERFORM public.r5_override_close(p_family_id, uid);
      sid := NULL; origin := NULL; live := false; session_ok := false;
      why := 'SESSION_REQUIRED';
    END IF;
  ELSIF p_action = 'tick' THEN
    IF origin = 'parent_override' THEN
      IF p_session_id IS NOT NULL AND sid = p_session_id AND live THEN
        PERFORM public.r5_session_beat(p_family_id, uid, p_session_id);
        PERFORM public.r5_override_touch(p_family_id, uid);
        session_ok := (u.used_ms < max_ms);
      ELSE
        PERFORM public.r5_session_close(p_family_id, uid, NULL);
        PERFORM public.r5_override_close(p_family_id, uid);
        sid := NULL; origin := NULL; live := false;
        why := 'SESSION_REQUIRED';
      END IF;
    ELSIF COALESCE((study_s->>'allowed')::boolean, false) THEN
      IF sid IS NOT NULL AND p_session_id IS NOT NULL AND p_session_id = sid AND live THEN
        PERFORM public.r5_session_beat(p_family_id, uid, p_session_id);
        origin := COALESCE(origin, 'study');
      ELSE
        sid := public.r5_session_open(p_family_id, uid, 'study');
        origin := 'study';
      END IF;
      live := true; session_ok := true;
    ELSE
      PERFORM public.r5_session_close(p_family_id, uid, NULL);
      PERFORM public.r5_override_close(p_family_id, uid);
      sid := NULL; origin := NULL; live := false; session_ok := false;
      why := 'SESSION_REQUIRED';
    END IF;
  ELSE
    PERFORM public.r5_session_close(p_family_id, uid, NULL);
    PERFORM public.r5_override_close(p_family_id, uid);
    sid := NULL; origin := NULL; live := false; session_ok := false;
  END IF;

  IF u.used_ms >= max_ms THEN
    PERFORM public.r5_session_close(p_family_id, uid, NULL);
    PERFORM public.r5_override_close(p_family_id, uid);
    sid := NULL; origin := NULL; live := false; session_ok := false;
    why := 'TIME_LIMIT_REACHED';
  END IF;

  SELECT count(*)::integer INTO live_cnt
    FROM public.r5_usage_session
   WHERE family_id = p_family_id AND play_date = today_date;
  UPDATE public.r5_daily_usage
     SET used_ms = u.used_ms, active = (live_cnt > 0), last_beat = now_ts
   WHERE family_id = p_family_id AND play_date = today_date;

  s := public.r5_gate_status_core(p_family_id, false, true);
  s := jsonb_set(s, '{allowed}', to_jsonb(COALESCE(session_ok AND live, false)));
  s := jsonb_set(s, '{active}', to_jsonb(live_cnt > 0));
  s := jsonb_set(s, '{parent_override}',
        to_jsonb(origin = 'parent_override' AND COALESCE(session_ok AND live, false)));
  IF COALESCE(session_ok AND live, false) THEN
    s := jsonb_set(s, '{reason}', to_jsonb(
      CASE WHEN origin = 'parent_override' THEN 'STUDY_PASSED_WITH_WAIVER'
           ELSE COALESCE(s->>'reason', 'STUDY_PASSED') END));
  ELSE
    s := jsonb_set(s, '{reason}', to_jsonb(COALESCE(why, s->>'reason', 'SESSION_REQUIRED')));
  END IF;
  RETURN s || jsonb_build_object(
    'api', 'r5_status',
    'action', p_action,
    'charged_ms', elapsed_ms,
    'active', (live_cnt > 0),
    'active_devices', live_cnt,
    'session_id', sid,
    'session_origin', origin,
    'session_resumed', resumed,
    'session_bound', (sid IS NOT NULL),
    'override_consumed', consumed,
    'heartbeat_seconds', 10,
    'engine', 'bound-md-1');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.r5_game_action(p_family_id text, p_action text)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
  SELECT public.r5_game_action_v2(p_family_id, p_action, NULL::text);
$fn$;

CREATE OR REPLACE FUNCTION public.r5_game_action_md(p_family_id text, p_action text)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
  SELECT public.r5_game_action_md_v2(p_family_id, p_action, NULL::text);
$fn$;

REVOKE ALL ON FUNCTION public.r5_session_live(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r5_session_open(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r5_session_beat(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r5_session_close(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r5_override_bind_session(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r5_gate_status_core(text, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.r5_session_live(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.r5_session_open(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.r5_session_beat(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.r5_session_close(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.r5_override_bind_session(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.r5_gate_status_core(text, boolean, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.r5_game_action_v2(text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.r5_game_action_md_v2(text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.r5_game_action_v2(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.r5_game_action_md_v2(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.r5_game_action(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.r5_game_action_md(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.r5_game_action(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.r5_game_action_md(text, text) TO authenticated, service_role;
