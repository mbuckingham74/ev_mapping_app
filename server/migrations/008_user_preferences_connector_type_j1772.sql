ALTER TABLE user_preferences
  DROP CONSTRAINT IF EXISTS user_preferences_connector_type_check;

ALTER TABLE user_preferences
  ADD CONSTRAINT user_preferences_connector_type_check
  CHECK (connector_type IS NULL OR connector_type IN ('CCS', 'CHADEMO', 'NACS', 'J1772'));
