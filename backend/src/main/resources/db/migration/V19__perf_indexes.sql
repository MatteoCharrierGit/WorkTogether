-- Indici di performance su colonne FK / filtro usate dalle query dei repository e non coperte
-- dalle migration V1..V18 (le PK composite coprono solo la colonna iniziale).

-- "I miei task" (findByAssigneeId) e pulizia assegnatari alla rimozione di un membro / cascade utente.
CREATE INDEX IF NOT EXISTS idx_element_assignees_user ON element_assignees(user_id);

-- Cascade/lookup per tag (eliminazione di un tag → righe element_tags).
CREATE INDEX IF NOT EXISTS idx_element_tags_tag ON element_tags(tag_id);

-- FK messages.author_id (ON DELETE CASCADE da users) e filtri per autore.
CREATE INDEX IF NOT EXISTS idx_messages_author ON messages(author_id);

-- Chat dedicata a una sprint (ChannelRepository.findBySprintId, chiamata per ogni sprint in lista).
CREATE INDEX IF NOT EXISTS idx_channels_sprint ON channels(sprint_id) WHERE sprint_id IS NOT NULL;

-- Azioni AI in attesa di conferma per conversazione (findByConversationIdAndStatus..., deleteByConversationId).
CREATE INDEX IF NOT EXISTS idx_ai_pending_conv_status ON ai_pending_actions(conversation_id, status);

-- Lookup del token di sessione onboarding / OTP per hash (VerificationCodeRepository.findByCodeHash).
CREATE INDEX IF NOT EXISTS idx_verification_code_hash ON verification_codes(code_hash);
