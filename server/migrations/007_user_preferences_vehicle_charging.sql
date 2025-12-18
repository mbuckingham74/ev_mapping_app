ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS max_charging_speed_kw INTEGER,
  ADD COLUMN IF NOT EXISTS connector_type TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_preferences_max_charging_speed_kw_check'
  ) THEN
    ALTER TABLE user_preferences
      ADD CONSTRAINT user_preferences_max_charging_speed_kw_check
      CHECK (max_charging_speed_kw IS NULL OR max_charging_speed_kw BETWEEN 0 AND 1000);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_preferences_connector_type_check'
  ) THEN
    ALTER TABLE user_preferences
      ADD CONSTRAINT user_preferences_connector_type_check
      CHECK (connector_type IS NULL OR connector_type IN ('CCS', 'CHADEMO', 'NACS'));
  END IF;
END $$;
