type MessageRole = "user" | "assistant" | "system" | "tool";

export interface CachedTextPart {
  id: string;
  messageID: string;
  text: string;
}

export interface SessionSnapshot {
  roles: Record<string, MessageRole>;
  agents: Record<string, string>;
  textParts: CachedTextPart[];
}

interface SessionStore {
  roles: Map<string, MessageRole>;
  agents: Map<string, string>;
  textParts: Map<string, CachedTextPart>;
}

function createSessionStore(): SessionStore {
  return {
    roles: new Map<string, MessageRole>(),
    agents: new Map<string, string>(),
    textParts: new Map<string, CachedTextPart>(),
  };
}

export class SessionCache {
  private readonly sessions = new Map<string, SessionStore>();

  private ensureSession(sessionID: string): SessionStore {
    const existing = this.sessions.get(sessionID);

    if (existing) {
      return existing;
    }

    const created = createSessionStore();
    this.sessions.set(sessionID, created);
    return created;
  }

  setRole(sessionID: string, messageID: string, role: MessageRole): void {
    this.ensureSession(sessionID).roles.set(messageID, role);
  }

  getRole(sessionID: string, messageID: string): MessageRole | null {
    return this.sessions.get(sessionID)?.roles.get(messageID) ?? null;
  }

  setAgent(sessionID: string, messageID: string, agent: string): void {
    this.ensureSession(sessionID).agents.set(messageID, agent);
  }

  getAgent(sessionID: string, messageID: string): string | null {
    return this.sessions.get(sessionID)?.agents.get(messageID) ?? null;
  }

  setTextPart(sessionID: string, partID: string, messageID: string, text: string): void {
    this.ensureSession(sessionID).textParts.set(partID, {
      id: partID,
      messageID,
      text,
    });
  }

  getTextPart(sessionID: string, partID: string): CachedTextPart | null {
    return this.sessions.get(sessionID)?.textParts.get(partID) ?? null;
  }

  getMessageText(sessionID: string, messageID: string): string {
    const session = this.sessions.get(sessionID);

    if (!session) {
      return "";
    }

    return [...session.textParts.values()]
      .filter((part) => part.messageID === messageID)
      .map((part) => part.text)
      .join("");
  }

  snapshot(sessionID: string): SessionSnapshot {
    const session = this.sessions.get(sessionID) ?? createSessionStore();

    return {
      roles: Object.fromEntries(session.roles),
      agents: Object.fromEntries(session.agents),
      textParts: [...session.textParts.values()],
    };
  }

  cleanup(sessionID: string): void {
    this.sessions.delete(sessionID);
  }
}

export type { MessageRole };
