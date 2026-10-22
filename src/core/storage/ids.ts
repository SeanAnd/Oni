import { randomUUID } from 'expo-crypto';

export function newEntityId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function utcNowIso(): string {
  return new Date().toISOString();
}
