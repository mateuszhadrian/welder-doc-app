-- WelderDoc — schemat początkowy (architecture-base §15)
-- Region: EU (Frankfurt) — wymóg PRD §3.10 (GDPR)

-- ============================================================================
-- documents
-- ============================================================================
CREATE TABLE documents (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       UUID        REFERENCES auth.users NOT NULL,
  name           TEXT        NOT NULL DEFAULT 'Nowy projekt',
  data           JSONB       NOT NULL,
  schema_version INT         NOT NULL DEFAULT 1,
  share_token    TEXT        UNIQUE,         -- zarezerwowane (post-MVP)
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX documents_owner_id_idx ON documents (owner_id);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner only" ON documents USING (owner_id = auth.uid());

-- Trigger: utrzymanie updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER documents_set_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- user_profiles
-- ============================================================================
CREATE TABLE user_profiles (
  id              UUID    PRIMARY KEY REFERENCES auth.users,
  plan            TEXT    NOT NULL DEFAULT 'free',  -- 'free' | 'pro'
  paddle_customer TEXT,
  consent_version TEXT,
  consent_at      TIMESTAMPTZ,
  locale          TEXT    DEFAULT 'pl'
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "self only" ON user_profiles USING (id = auth.uid());

-- ============================================================================
-- Auto-utworzenie user_profiles przy rejestracji
-- ============================================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_profiles (id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();
