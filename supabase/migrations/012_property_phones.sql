-- 012_property_phones.sql
-- Phone numbers from purchase files. Each number is stored once. Each property links to its numbers in order,
-- so a property can have several numbers and a number can belong to several properties.
-- Do Not Call (DNC) numbers are also recorded as a 'dnc' suppression, which exports must respect.

-- Line type and DNC flags on the phone itself. A DNC flag is only ever turned on by an import, never off.
ALTER TABLE phone_numbers ADD COLUMN IF NOT EXISTS line_type TEXT;
ALTER TABLE phone_numbers ADD COLUMN IF NOT EXISTS dnc BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE phone_numbers ADD COLUMN IF NOT EXISTS dnc_federal BOOLEAN NOT NULL DEFAULT false;

-- One suppression of each type per phone, so repeated imports do not duplicate it.
CREATE UNIQUE INDEX IF NOT EXISTS ux_phone_suppressions_type ON phone_suppressions (phone_number_id, suppression_type);

CREATE TABLE IF NOT EXISTS property_phones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  phone_number_id UUID NOT NULL REFERENCES phone_numbers(id) ON DELETE CASCADE,
  position INT NOT NULL CHECK (position BETWEEN 1 AND 50),
  import_batch_id UUID REFERENCES import_batches(id),
  UNIQUE (property_id, phone_number_id)
);

CREATE INDEX IF NOT EXISTS idx_property_phones_phone ON property_phones (phone_number_id);

ALTER TABLE property_phones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can read property phones" ON property_phones
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Signed-in users can link phones to properties" ON property_phones
  FOR INSERT TO authenticated
  WITH CHECK (true);

GRANT SELECT, INSERT ON property_phones TO authenticated;

-- Tell the Supabase API to pick up the new column, table and index.
NOTIFY pgrst, 'reload schema';
