import fs from 'fs';
import path from 'path';

const MEMORY_DIR = 'memory';
const MAX_HISTORY = 40; // messages per user

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface UserMemory {
  jid: string;
  history: Message[];
}

function filePath(jid: string): string {
  const safe = jid.replace(/[^a-z0-9]/gi, '_');
  return path.join(MEMORY_DIR, `${safe}.json`);
}

function ensureDir() {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

export function loadMemory(jid: string): UserMemory {
  ensureDir();
  const file = filePath(jid);
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // corrupted file — start fresh
    }
  }
  return { jid, history: [] };
}

export function saveMemory(mem: UserMemory): void {
  ensureDir();
  // Keep only last MAX_HISTORY messages
  if (mem.history.length > MAX_HISTORY) {
    mem.history = mem.history.slice(-MAX_HISTORY);
  }
  fs.writeFileSync(filePath(mem.jid), JSON.stringify(mem, null, 2));
}

export function appendAndSave(jid: string, userMsg: string, assistantMsg: string): void {
  const mem = loadMemory(jid);
  mem.history.push({ role: 'user', content: userMsg });
  mem.history.push({ role: 'assistant', content: assistantMsg });
  saveMemory(mem);
}
