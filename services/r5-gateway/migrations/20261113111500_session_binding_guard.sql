-- Refine session binding: a start/tick without the matching session id must be
-- refused without destroying the live session held by the legitimate tab, and the
-- server must never echo a session id the caller did not prove knowledge of.

CREATE OR REPLACE FUNCTION public.r5_game_action_v2(p_family_id text, p_action text, p_session_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
DECLARE
  today_date date := timezone('Asia/Shanghai', clock_timestamp())::date;
  now_ts timestamptz := clock_timestamp();
  uid text; u record; s jsonb; study_s jsonb;
  max_ms bigint; elapsed_ms bigint := 0;
  consumed boolean := false; resumed boolean := false; known boolean := false;
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
      origin := 'parent_override'; live := true; known := true;
      session_ok := (u.used_ms < max_ms);
    ELSIF p_session_id IS NOT NULL AND sid = p_session_id AND live THEN
      PERFORM public.r5_session_beat(p_family_id, uid, p_session_id);
      resumed := true; known := true; session_ok := (u.used_ms < max_ms);
    ELSIF COALESCE((study_s->>'allowed')::boolean, false) THEN
      sid := public.r5_session_open(p_family_id, uid, 'study');
      origin := 'study'; live := true; known := true; session_ok := true;
    ELSE
      IF NOT live THEN
        PERFORM public.r5_session_close(p_family_id, uid, NULL);
        PERFORM public.r5_override_close(p_family_id, uid);
        sid := NULL; origin := NULL;
      END IF;
      session_ok := false; why := 'SESSION_REQUIRED';
    END IF;
  ELSIF p_action = 'tick' THEN
    IF origin = 'parent_override' THEN
      IF p_session_id IS NOT NULL AND sid = p_session_id AND live THEN
        PERFORM public.r5_session_beat(p_family_id, uid, p_session_id);
        PERFORM public.r5_override_touch(p_family_id, uid);
        known := true; session_ok := (u.used_ms < max_ms);
      ELSE
        IF NOT live THEN
          PERFORM public.r5_session_close(p_family_id, uid, NULL);
          PERFORM public.r5_override_close(p_family_id, uid);
          sid := NULL; origin := NULL;
        END IF;
        session_ok := false; why := 'SESSION_REQUIRED';
      END IF;
    ELSIF COALESCE((study_s->>'allowed')::boolean, false) THEN
      IF sid IS NOT NULL AND p_session_id IS NOT NULL AND p_session_id = sid AND live THEN
        PERFORM public.r5_session_beat(p_family_id, uid, p_session_id);
        origin := COALESCE(origin, 'study');
      ELSE
        sid := public.r5_session_open(p_family_id, uid, 'study');
        origin := 'study';
      END IF;
      live := true; known := true; session_ok := true;
    ELSE
      IF NOT live THEN
        PERFORM public.r5_session_close(p_family_id, uid, NULL);
        PERFORM public.r5_override_close(p_family_id, uid);
        sid := NULL; origin := NULL;
      END IF;
      session_ok := false; why := 'SESSION_REQUIRED';
    END IF;
  ELSE
    IF origin = 'parent_override' AND live
       AND (p_session_id IS NULL OR p_session_id <> sid) THEN
      session_ok := false; why := 'SESSION_REQUIRED';
    ELSE
      PERFORM public.r5_session_close(p_family_id, uid, NULL);
      PERFORM public.r5_override_close(p_family_id, uid);
      sid := NULL; origin := NULL; live := false; session_ok := false;
    END IF;
  END IF;

  IF u.used_ms >= max_ms THEN
    PERFORM public.r5_session_close(p_family_id, uid, NULL);
    PERFORM public.r5_override_close(p_family_id, uid);
    sid := NULL; origin := NULL; live := false; session_ok := false; known := false;
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
    'session_id', CASE WHEN known THEN sid ELSE NULL END,
    'session_origin', CASE WHEN known THEN origin ELSE NULL END,
    'session_resumed', resumed,
    'session_bound', known,
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
  consumed boolean := false; resumed boolean := false; known boolean := false;
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
      origin := 'parent_override'; live := true; known := true;
      session_ok := (u.used_ms < max_ms);
    ELSIF p_session_id IS NOT NULL AND sid = p_session_id AND live THEN
      PERFORM public.r5_session_beat(p_family_id, uid, p_session_id);
      resumed := true; known := true; session_ok := (u.used_ms < max_ms);
    ELSIF COALESCE((study_s->>'allowed')::boolean, false) THEN
      sid := public.r5_session_open(p_family_id, uid, 'study');
      origin := 'study'; live := true; known := true; session_ok := true;
    ELSE
      IF NOT live THEN
        PERFORM public.r5_session_close(p_family_id, uid, NULL);
        PERFORM public.r5_override_close(p_family_id, uid);
        sid := NULL; origin := NULL;
      END IF;
      session_ok := false; why := 'SESSION_REQUIRED';
    END IF;
  ELSIF p_action = 'tick' THEN
    IF origin = 'parent_override' THEN
      IF p_session_id IS NOT NULL AND sid = p_session_id AND live THEN
        PERFORM public.r5_session_beat(p_family_id, uid, p_session_id);
        PERFORM public.r5_override_touch(p_family_id, uid);
        known := true; session_ok := (u.used_ms < max_ms);
      ELSE
        IF NOT live THEN
          PERFORM public.r5_session_close(p_family_id, uid, NULL);
          PERFORM public.r5_override_close(p_family_id, uid);
          sid := NULL; origin := NULL;
        END IF;
        session_ok := false; why := 'SESSION_REQUIRED';
      END IF;
    ELSIF COALESCE((study_s->>'allowed')::boolean, false) THEN
      IF sid IS NOT NULL AND p_session_id IS NOT NULL AND p_session_id = sid AND live THEN
        PERFORM public.r5_session_beat(p_family_id, uid, p_session_id);
        origin := COALESCE(origin, 'study');
      ELSE
        sid := public.r5_session_open(p_family_id, uid, 'study');
        origin := 'study';
      END IF;
      live := true; known := true; session_ok := true;
    ELSE
      IF NOT live THEN
        PERFORM public.r5_session_close(p_family_id, uid, NULL);
        PERFORM public.r5_override_close(p_family_id, uid);
        sid := NULL; origin := NULL;
      END IF;
      session_ok := false; why := 'SESSION_REQUIRED';
    END IF;
  ELSE
    IF origin = 'parent_override' AND live
       AND (p_session_id IS NULL OR p_session_id <> sid) THEN
      session_ok := false; why := 'SESSION_REQUIRED';
    ELSE
      PERFORM public.r5_session_close(p_family_id, uid, NULL);
      PERFORM public.r5_override_close(p_family_id, uid);
      sid := NULL; origin := NULL; live := false; session_ok := false;
    END IF;
  END IF;

  IF u.used_ms >= max_ms THEN
    PERFORM public.r5_session_close(p_family_id, uid, NULL);
    PERFORM public.r5_override_close(p_family_id, uid);
    sid := NULL; origin := NULL; live := false; session_ok := false; known := false;
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
    'session_id', CASE WHEN known THEN sid ELSE NULL END,
    'session_origin', CASE WHEN known THEN origin ELSE NULL END,
    'session_resumed', resumed,
    'session_bound', known,
    'override_consumed', consumed,
    'heartbeat_seconds', 10,
    'engine', 'bound-md-1');
END;
$fn$;
