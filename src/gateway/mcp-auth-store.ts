type ConnectionBinding = {
  jwt?: string;
  sessions: Set<string>;
};

const connections = new Map<string, ConnectionBinding>();
const sessionToJwt = new Map<string, string>();

function getOrCreateConnection(connId: string): ConnectionBinding {
  let binding = connections.get(connId);
  if (!binding) {
    binding = { sessions: new Set<string>() };
    connections.set(connId, binding);
  }
  return binding;
}

export function setDelegatedJwtForConnection(connId: string, jwt: string | undefined): void {
  const normalized = jwt?.trim();
  if (!normalized) {
    return;
  }
  const binding = getOrCreateConnection(connId);
  binding.jwt = normalized;
  for (const sessionKey of binding.sessions) {
    sessionToJwt.set(sessionKey, normalized);
  }
}

export function bindConnectionToSession(connId: string, sessionKey: string): void {
  const normalizedSessionKey = sessionKey.trim();
  if (!normalizedSessionKey) {
    return;
  }
  const binding = getOrCreateConnection(connId);
  binding.sessions.add(normalizedSessionKey);
  if (binding.jwt) {
    sessionToJwt.set(normalizedSessionKey, binding.jwt);
  }
}

export function getDelegatedJwtForSession(sessionKey: string | undefined): string | undefined {
  const normalized = sessionKey?.trim();
  if (!normalized) {
    return undefined;
  }
  return sessionToJwt.get(normalized);
}

export function clearDelegatedJwtForConnection(connId: string): void {
  const binding = connections.get(connId);
  if (!binding) {
    return;
  }
  for (const sessionKey of binding.sessions) {
    sessionToJwt.delete(sessionKey);
  }
  connections.delete(connId);
}
