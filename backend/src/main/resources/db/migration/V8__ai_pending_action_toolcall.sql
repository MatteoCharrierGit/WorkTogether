-- Collega un'azione in attesa alla specifica tool_call del modello (per inserire il risultato giusto al resume).
ALTER TABLE ai_pending_actions ADD COLUMN tool_call_id VARCHAR(80);
