-- R5 家长免学习快捷授权（2026-11-13）
CREATE TABLE IF NOT EXISTS public.r5_game_override (
  override_id  bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  family_id    text        NOT NULL,
  device_uid   text        NOT NULL,
  parent_uid   text        NOT NULL,
  scope        text        NOT NULL DEFAULT 'skip_learning_only',
  play_date    date        NOT NULL,
  granted_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  bound_until  timestamptz,
  CONSTRAINT r5_game_override_scope_chk CHECK (scope = 'skip_learning_only'),
  CONSTRAINT r5_game_override_window_chk CHECK (expires_at > granted_at AND expires_at <= granted_at + interval '5 minutes'),
  CONSTRAINT r5_game_override_uk UNIQUE (family_id, device_uid, play_date)
);
CREATE INDEX IF NOT EXISTS r5_game_override_active_idx ON public.r5_game_override (family_id, device_uid, play_date, expires_at DESC);
ALTER TABLE public.r5_game_override ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.r5_override_bind(p_family_id text, p_device text, p_remaining_seconds integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $function$
DECLARE
  now_ts timestamptz := clock_timestamp();
  day_end timestamptz;
  l_bound timestamptz;
BEGIN
  IF COALESCE(p_remaining_seconds, 0) <= 0 THEN RETURN; END IF;
  day_end := ((timezone('Asia/Shanghai', now_ts)::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai');
  l_bound := least(day_end, now_ts + make_interval(secs => p_remaining_seconds + 300));
  IF l_bound > day_end THEN l_bound := day_end; END IF;
  UPDATE public.r5_game_override o
     SET consumed_at = COALESCE(o.consumed_at, now_ts), bound_until = l_bound
   WHERE o.family_id = p_family_id AND o.device_uid = p_device
     AND o.play_date = timezone('Asia/Shanghai', now_ts)::date AND o.scope = 'skip_learning_only'
     AND ((o.consumed_at IS NULL AND o.expires_at > now_ts)
          OR (o.consumed_at IS NOT NULL AND o.bound_until > now_ts));
END $function$;
CREATE OR REPLACE FUNCTION public.r5_parent_game_override(p_family_id text, p_device text, p_ttl_seconds integer DEFAULT 300) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $function$
DECLARE
  today_date date := timezone('Asia/Shanghai', clock_timestamp())::date;
  now_ts timestamptz := clock_timestamp();
  actor text; cfg record; usage record; dev record;
  limit_seconds integer; used_seconds integer; remaining integer; ttl integer; exp timestamptz;
BEGIN
  actor := public.r5_assert_member(p_family_id, true);
  IF p_device IS NULL OR length(btrim(p_device)) < 1 THEN RAISE EXCEPTION 'R5_DEVICE_REQUIRED'; END IF;
  SELECT device_uid, family_id, revoked_at INTO dev FROM public.r5_device WHERE device_uid = p_device LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'R5_DEVICE_NOT_BOUND'; END IF;
  IF dev.family_id <> p_family_id THEN RAISE EXCEPTION 'R5_DEVICE_FAMILY_MISMATCH'; END IF;
  IF dev.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'R5_DEVICE_REVOKED'; END IF;
  SELECT enabled, daily_seconds, bonus_seconds INTO cfg FROM public.r5_parent_settings WHERE family_id = p_family_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'R5_SETTINGS_MISSING'; END IF;
  IF NOT cfg.enabled THEN RAISE EXCEPTION 'R5_PARENT_CONTROL_DISABLED'; END IF;
  SELECT used_ms INTO usage FROM public.r5_daily_usage WHERE family_id = p_family_id AND play_date = today_date;
  used_seconds := CASE WHEN FOUND THEN ceil(usage.used_ms / 1000.0)::integer ELSE 0 END;
  limit_seconds := cfg.daily_seconds + cfg.bonus_seconds;
  remaining := greatest(0, limit_seconds - used_seconds);
  IF remaining <= 0 THEN RAISE EXCEPTION 'R5_TIME_LIMIT_REACHED'; END IF;
  ttl := greatest(60, least(300, COALESCE(p_ttl_seconds, 300)));
  exp := now_ts + make_interval(secs => ttl);
  INSERT INTO public.r5_game_override (family_id, device_uid, parent_uid, scope, play_date, granted_at, expires_at, consumed_at, bound_until)
  VALUES (p_family_id, p_device, actor, 'skip_learning_only', today_date, now_ts, exp, NULL, NULL)
  ON CONFLICT (family_id, device_uid, play_date) DO UPDATE
    SET parent_uid = excluded.parent_uid, scope = excluded.scope, granted_at = excluded.granted_at,
        expires_at = excluded.expires_at, consumed_at = NULL, bound_until = NULL;
  DELETE FROM public.r5_game_override WHERE play_date < today_date - 7;
  INSERT INTO public.r5_parent_audit(family_id, action, play_date, actor, detail)
  VALUES (p_family_id, 'game_override_grant', today_date, actor,
          jsonb_build_object('device_uid', p_device, 'scope', 'skip_learning_only', 'expires_at', exp, 'remaining_seconds', remaining, 'ttl_seconds', ttl));
  RETURN jsonb_build_object('api', 'r5_parent_game_override', 'authorized', true, 'family_id', p_family_id,
    'device', p_device, 'scope', 'skip_learning_only', 'daily_seconds', cfg.daily_seconds,
    'bonus_seconds', cfg.bonus_seconds, 'used_seconds', used_seconds, 'remaining_seconds', remaining,
    'expires_at', to_char(exp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'ttl_seconds', ttl);
END $function$;
CREATE OR REPLACE FUNCTION public.r5_parent_game_override_audit(p_family_id text, p_action text, p_detail jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $function$
DECLARE today_date date := timezone('Asia/Shanghai', clock_timestamp())::date;
BEGIN
  IF p_action NOT IN ('game_override_failed_auth', 'game_override_throttled', 'game_override_denied') THEN
    RAISE EXCEPTION 'R5_INVALID_ACTION';
  END IF;
  INSERT INTO public.r5_parent_audit(family_id, action, play_date, actor, detail)
  VALUES (p_family_id, p_action, today_date, NULL, COALESCE(p_detail, '{}'::jsonb));
  RETURN jsonb_build_object('ok', true);
END $function$;
REVOKE ALL ON public.r5_game_override FROM PUBLIC;
REVOKE ALL ON public.r5_game_override FROM anon;
GRANT EXECUTE ON FUNCTION public.r5_parent_game_override(text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.r5_parent_game_override_audit(text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.r5_override_bind(text, text, integer) TO authenticated, service_role;
