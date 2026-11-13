CREATE OR REPLACE FUNCTION public.r5_status(p_family_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE today_date date:=timezone('Asia/Shanghai',clock_timestamp())::date;
 user_id text; cfg record; plan record; usage record; subject_name text;
 total_count integer; correct_count integer; finished boolean; waived boolean;
 item_pass boolean; all_pass boolean:=true; any_waived boolean:=false;
 module_states jsonb:='[]'::jsonb;
 limit_seconds integer; used_seconds integer; remaining integer;
 permitted boolean; why text; is_active boolean:=false;
 override_active boolean:=false; study_ok boolean;
BEGIN
 user_id:=public.r5_assert_member(p_family_id,false);
 SELECT EXISTS (
   SELECT 1 FROM public.r5_game_override o
    WHERE o.family_id=p_family_id AND o.device_uid=user_id
      AND o.play_date=today_date AND o.scope='skip_learning_only'
      AND ((o.consumed_at IS NULL AND o.expires_at>clock_timestamp())
        OR (o.consumed_at IS NOT NULL AND o.bound_until IS NOT NULL
            AND o.bound_until>clock_timestamp()))
 ) INTO override_active;
 SELECT enabled,daily_seconds,bonus_seconds INTO cfg
 FROM public.r5_parent_settings WHERE family_id=p_family_id;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'R5_SETTINGS_MISSING';
 END IF;
 SELECT day_index,subjects,published INTO plan
 FROM public.r5_daily_plan WHERE family_id=p_family_id AND study_date=today_date;
 IF NOT FOUND OR NOT plan.published THEN
  all_pass:=false; why:='PLAN_UNPUBLISHED';
 ELSIF jsonb_array_length(plan.subjects)=0 THEN
  why:='NO_TASKS_TODAY';
 ELSE
  FOR subject_name IN SELECT jsonb_array_elements_text(plan.subjects) LOOP
   waived:=false;
   SELECT count(*)::integer,
          count(*) FILTER (WHERE r.record_data #>> '{answer,correct}' = 'true')::integer
   INTO total_count,correct_count
   FROM public.growth_learning_records r
   WHERE r.family_id=p_family_id AND r.record_type='answer'
     AND r.subject=subject_name AND r.learning_day=plan.day_index
     AND left(r.record_data #>> '{answer,date}',10)=today_date::text
     AND r.record_data #>> '{answer,correct}' IN ('true','false');
   SELECT EXISTS (
    SELECT 1 FROM public.growth_learning_records r
    WHERE r.family_id=p_family_id AND r.record_type='course-complete'
      AND r.subject=subject_name AND r.learning_day=plan.day_index
      AND CASE
       WHEN r.record_data->>'completed_at' ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T'
       THEN ((r.record_data->>'completed_at')::timestamptz AT TIME ZONE 'Asia/Shanghai')::date
       ELSE NULL::date END = today_date
   ) INTO finished;
   item_pass:=finished AND total_count>0 AND correct_count*100>=80*total_count;
   IF NOT item_pass AND finished AND total_count=0 THEN
     PERFORM 1 FROM public.r5_parent_waiver w
      WHERE w.family_id=p_family_id AND w.study_date=today_date AND w.subject=subject_name;
     IF FOUND THEN
       waived:=true; item_pass:=true; any_waived:=true;
     END IF;
   END IF;
   all_pass:=all_pass AND item_pass;
   module_states:=module_states||jsonb_build_array(jsonb_build_object(
     'subject',subject_name,'completed',finished,'correct',correct_count,
     'total',total_count,'accuracy_pct',CASE WHEN total_count>0
         THEN round(correct_count*100.0/total_count,1) ELSE NULL END,
     'waived',waived,
     'evidence',CASE
        WHEN total_count>0 AND item_pass THEN 'SCORED'
        WHEN waived THEN 'COMPLETED_UNSCORED_WAIVED'
        WHEN total_count>0 THEN 'SCORED_BELOW_THRESHOLD'
        WHEN finished THEN 'COMPLETED_UNSCORED'
        ELSE 'NOT_COMPLETED' END,
     'passed',item_pass));
  END LOOP;
  why:=CASE WHEN all_pass THEN
              CASE WHEN any_waived THEN 'STUDY_PASSED_WITH_WAIVER' ELSE 'STUDY_PASSED' END
            ELSE 'STUDY_INCOMPLETE_OR_SCORE_UNVERIFIED' END;
 END IF;
 SELECT used_ms,active INTO usage FROM public.r5_daily_usage
 WHERE family_id=p_family_id AND play_date=today_date;
 IF FOUND THEN
  used_seconds:=ceil(usage.used_ms/1000.0)::integer;is_active:=usage.active;
 ELSE used_seconds:=0; END IF;
 limit_seconds:=cfg.daily_seconds+cfg.bonus_seconds;
 remaining:=greatest(0,limit_seconds-used_seconds);
 study_ok:=(all_pass AND why<>'PLAN_UNPUBLISHED') OR override_active;
 permitted:=(NOT cfg.enabled OR study_ok) AND remaining>0;
 IF remaining=0 THEN why:='TIME_LIMIT_REACHED';
 ELSIF NOT cfg.enabled THEN why:='PARENT_CONTROL_DISABLED';
 ELSIF override_active AND NOT (all_pass AND why<>'PLAN_UNPUBLISHED') THEN
   why:='STUDY_PASSED_WITH_WAIVER';
 END IF;
 RETURN jsonb_build_object('api','r5_status','date',today_date,'allowed',permitted,
  'reason',why,'parent_control',cfg.enabled,'daily_seconds',cfg.daily_seconds,
  'bonus_seconds',cfg.bonus_seconds,'used_seconds',used_seconds,
  'remaining_seconds',remaining,'active',is_active,
  'parent_override',override_active,
  'modules',module_states,'schedule_published',
  COALESCE(plan.published,false),'study_day',plan.day_index);
END $function$;
CREATE OR REPLACE FUNCTION public.r5_game_action(p_family_id text, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE today_date date:=timezone('Asia/Shanghai',clock_timestamp())::date;
 now_ts timestamptz:=clock_timestamp(); u record; s jsonb; uid text;
 max_ms bigint; elapsed_ms bigint:=0;
BEGIN
 uid:=public.r5_assert_member(p_family_id,false);
 IF p_action NOT IN ('start','tick','stop','status') THEN
   RAISE EXCEPTION 'R5_INVALID_ACTION';
 END IF;
 IF p_action='status' THEN RETURN public.r5_status(p_family_id); END IF;
 INSERT INTO public.r5_daily_usage(family_id,play_date)
 VALUES(p_family_id,today_date) ON CONFLICT DO NOTHING;
 SELECT * INTO u FROM public.r5_daily_usage
 WHERE family_id=p_family_id AND play_date=today_date FOR UPDATE;
 s:=public.r5_status(p_family_id);
 max_ms:=((s->>'daily_seconds')::bigint+(s->>'bonus_seconds')::bigint)*1000;
 IF u.active AND u.last_beat IS NOT NULL THEN
  elapsed_ms:=least(20000,greatest(0,
    floor(extract(epoch FROM (now_ts-u.last_beat))*1000)::bigint));
 END IF;
 u.used_ms:=u.used_ms+least(elapsed_ms,greatest(0,max_ms-u.used_ms));
 IF p_action='stop' THEN u.active:=false;
 ELSIF u.used_ms>=max_ms THEN u.active:=false;
 ELSIF (s->>'allowed')::boolean AND p_action IN ('start','tick') THEN u.active:=true;
 ELSE u.active:=false; END IF;
 UPDATE public.r5_daily_usage
 SET used_ms=u.used_ms,active=u.active,last_beat=now_ts
 WHERE family_id=p_family_id AND play_date=today_date;
 IF p_action='start' AND u.active AND COALESCE((s->>'parent_override')::boolean,false) THEN
   PERFORM public.r5_override_bind(p_family_id,uid,(s->>'remaining_seconds')::integer);
 END IF;
 s:=public.r5_status(p_family_id);
 RETURN s||jsonb_build_object('action',p_action,
  'charged_ms',elapsed_ms,'active',u.active);
END $function$;
CREATE OR REPLACE FUNCTION public.r5_game_action_md(p_family_id text, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  today_date date := timezone('Asia/Shanghai', clock_timestamp())::date;
  now_ts     timestamptz := clock_timestamp();
  uid        text;
  key        text;
  u          record;
  s          jsonb;
  max_ms     bigint;
  elapsed_ms bigint := 0;
  playing    boolean := false;
  allowed    boolean := false;
  live_cnt   integer := 0;
  hard_stop  boolean := false;
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
  s := public.r5_status(p_family_id);
  max_ms  := ((s->>'daily_seconds')::bigint + (s->>'bonus_seconds')::bigint) * 1000;
  allowed := COALESCE((s->>'allowed')::boolean, false);
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
    DELETE FROM public.r5_usage_session
     WHERE play_date < today_date - 7;
  END IF;
  hard_stop := (u.used_ms >= max_ms);
  IF hard_stop OR NOT allowed THEN
    DELETE FROM public.r5_usage_session
     WHERE family_id = p_family_id AND play_date = today_date;
  ELSIF p_action = 'stop' THEN
    DELETE FROM public.r5_usage_session
     WHERE family_id = p_family_id AND play_date = today_date AND actor_key = key;
  ELSE
    INSERT INTO public.r5_usage_session(family_id, play_date, actor_key, last_beat)
    VALUES (p_family_id, today_date, key, now_ts)
    ON CONFLICT (family_id, play_date, actor_key)
    DO UPDATE SET last_beat = excluded.last_beat;
  END IF;
  IF p_action = 'start' AND NOT hard_stop AND allowed
     AND COALESCE((s->>'parent_override')::boolean, false) THEN
    PERFORM public.r5_override_bind(p_family_id, uid, (s->>'remaining_seconds')::integer);
  END IF;
  SELECT count(*)::integer INTO live_cnt
    FROM public.r5_usage_session
   WHERE family_id = p_family_id AND play_date = today_date;
  UPDATE public.r5_daily_usage
     SET used_ms = u.used_ms, active = (live_cnt > 0), last_beat = now_ts
   WHERE family_id = p_family_id AND play_date = today_date;
  s := public.r5_status(p_family_id);
  RETURN s || jsonb_build_object(
    'action', p_action,
    'charged_ms', elapsed_ms,
    'active', (live_cnt > 0),
    'active_devices', live_cnt,
    'engine', 'md-1');
END $function$;
