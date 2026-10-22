import { getRandomBytes } from 'expo-crypto';

/** Generates a 256-bit secret for device pairing or database credentials. Never log it. */
export function generateRandomSecret(): string {
  const bytes = getRandomBytes(32);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
