-- STAGE 3.5 / 4.1 — combination-level learning (market x contract x regime x entry condition)
CREATE TABLE public.sentinel_combo_stats (
  symbol TEXT NOT NULL,
  contract TEXT NOT NULL,
  regime TEXT NOT NULL,
  entry_condition TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  weighted_n NUMERIC NOT NULL DEFAULT 0,
  weighted_wins NUMERIC NOT NULL DEFAULT 0,
  expectancy NUMERIC NOT NULL DEFAULT 0,
  weighted_expectancy NUMERIC NOT NULL DEFAULT 0,
  net_pnl NUMERIC NOT NULL DEFAULT 0,
  max_drawdown NUMERIC NOT NULL DEFAULT 0,
  deterioration_pp NUMERIC NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_losing_streak INTEGER NOT NULL DEFAULT 0,
  decay_half_life_ms BIGINT NOT NULL DEFAULT 3600000,
  version INTEGER NOT NULL DEFAULT 1,
  last_outcome_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, contract, regime, entry_condition)
);
GRANT SELECT, INSERT, UPDATE ON public.sentinel_combo_stats TO authenticated;
GRANT ALL ON public.sentinel_combo_stats TO service_role;
ALTER TABLE public.sentinel_combo_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "combo stats readable" ON public.sentinel_combo_stats FOR SELECT TO authenticated USING (true);
CREATE POLICY "combo stats writable" ON public.sentinel_combo_stats FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "combo stats updatable" ON public.sentinel_combo_stats FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER sentinel_combo_stats_touch BEFORE UPDATE ON public.sentinel_combo_stats FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4.1 — resolved simulator trades, four-dimension tagged
CREATE TABLE public.sentinel_sim_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'client',
  symbol TEXT NOT NULL,
  contract TEXT NOT NULL,
  regime TEXT NOT NULL DEFAULT 'UNKNOWN',
  entry_condition TEXT NOT NULL DEFAULT 'IMMEDIATE',
  entry_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  entry_digit SMALLINT,
  resolution_digit SMALLINT,
  duration_ticks INTEGER NOT NULL DEFAULT 1,
  result TEXT NOT NULL,
  stake NUMERIC NOT NULL DEFAULT 1,
  pnl NUMERIC NOT NULL DEFAULT 0,
  direction_score NUMERIC,
  setup_score NUMERIC,
  danger NUMERIC,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  client_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.sentinel_sim_trades TO authenticated;
GRANT ALL ON public.sentinel_sim_trades TO service_role;
ALTER TABLE public.sentinel_sim_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sim trades readable" ON public.sentinel_sim_trades FOR SELECT TO authenticated USING (true);
CREATE POLICY "sim trades insertable" ON public.sentinel_sim_trades FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE INDEX sentinel_sim_trades_combo ON public.sentinel_sim_trades (symbol, contract, regime, entry_condition, entry_at DESC);

-- 4.1 — entry-condition test results per market x contract x regime
CREATE TABLE public.sentinel_entry_results (
  symbol TEXT NOT NULL,
  contract TEXT NOT NULL,
  regime TEXT NOT NULL,
  entry_condition TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  win_rate NUMERIC NOT NULL DEFAULT 0,
  expectancy NUMERIC NOT NULL DEFAULT 0,
  oos_expectancy NUMERIC NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'UNTESTED',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, contract, regime, entry_condition)
);
GRANT SELECT, INSERT, UPDATE ON public.sentinel_entry_results TO authenticated;
GRANT ALL ON public.sentinel_entry_results TO service_role;
ALTER TABLE public.sentinel_entry_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "entry results readable" ON public.sentinel_entry_results FOR SELECT TO authenticated USING (true);
CREATE POLICY "entry results insertable" ON public.sentinel_entry_results FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "entry results updatable" ON public.sentinel_entry_results FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER sentinel_entry_results_touch BEFORE UPDATE ON public.sentinel_entry_results FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4.1 — market / psychology / danger / calibration / engine learning state
CREATE TABLE public.sentinel_learning_state (
  symbol TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, kind)
);
GRANT SELECT, INSERT, UPDATE ON public.sentinel_learning_state TO authenticated;
GRANT ALL ON public.sentinel_learning_state TO service_role;
ALTER TABLE public.sentinel_learning_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "learning state readable" ON public.sentinel_learning_state FOR SELECT TO authenticated USING (true);
CREATE POLICY "learning state insertable" ON public.sentinel_learning_state FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "learning state updatable" ON public.sentinel_learning_state FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER sentinel_learning_state_touch BEFORE UPDATE ON public.sentinel_learning_state FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4.5 — versioned snapshots of learned state
CREATE TABLE public.sentinel_calibration_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  taken_on DATE NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  version INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (symbol, taken_on, version)
);
GRANT SELECT, INSERT ON public.sentinel_calibration_snapshots TO authenticated;
GRANT ALL ON public.sentinel_calibration_snapshots TO service_role;
ALTER TABLE public.sentinel_calibration_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "snapshots readable" ON public.sentinel_calibration_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "snapshots insertable" ON public.sentinel_calibration_snapshots FOR INSERT TO authenticated WITH CHECK (true);

-- 4.1 / 4.3 — journal moved off localStorage
CREATE TABLE public.sentinel_journal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  mode TEXT NOT NULL DEFAULT 'MANUAL',
  symbol TEXT NOT NULL,
  name TEXT,
  contract TEXT NOT NULL,
  contract_label TEXT,
  opportunity NUMERIC,
  confidence NUMERIC,
  edge_pct NUMERIC,
  danger NUMERIC,
  quality NUMERIC,
  entry_digit_index INTEGER,
  outcome TEXT NOT NULL DEFAULT 'PENDING',
  resolved_digit SMALLINT,
  note TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sentinel_journal TO authenticated;
GRANT ALL ON public.sentinel_journal TO service_role;
ALTER TABLE public.sentinel_journal ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own sentinel journal" ON public.sentinel_journal FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER sentinel_journal_touch BEFORE UPDATE ON public.sentinel_journal FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();