// meet.jit.si applies a moderator/lobby gate to anonymously-created rooms,
// so neither party is ever granted host status and both get stuck on
// "waiting for the host". This hash-fragment config override disables
// that lobby so the room starts as soon as either party joins.
export const JITSI_CONFIG_SUFFIX = "#config.enableLobby=false";
