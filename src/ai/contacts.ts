import fs from 'fs';

const CONTACTS_FILE = 'memory/contacts.json';

export interface Contact {
  name: string;
  jid: string;
}

function load(): Record<string, string> {
  try {
    if (fs.existsSync(CONTACTS_FILE)) {
      return JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8'));
    }
  } catch {}
  return {};
}

function save(contacts: Record<string, string>) {
  fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2));
}

// Register or update a name → JID mapping
export function registerContact(name: string, jid: string) {
  const contacts = load();
  contacts[name.toLowerCase()] = jid;
  save(contacts);
}

// Resolve a name to a JID — returns null if unknown
export function resolveContact(name: string): string | null {
  const contacts = load();
  return contacts[name.toLowerCase()] ?? null;
}

// Get all known contacts
export function getAllContacts(): Contact[] {
  const contacts = load();
  return Object.entries(contacts).map(([name, jid]) => ({ name, jid }));
}
