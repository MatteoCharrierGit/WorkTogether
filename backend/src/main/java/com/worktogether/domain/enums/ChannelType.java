package com.worktogether.domain.enums;

public enum ChannelType {
    DM,     // conversazione 1:1 implicita
    GROUP,  // conversazione di gruppo ad-hoc
    ROOM,   // stanza persistente gestita dall'admin
    SPRINT  // chat dedicata a una sprint (accessibile a tutti i membri del workspace)
}
