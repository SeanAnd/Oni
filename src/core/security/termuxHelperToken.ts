import * as SecureStore from 'expo-secure-store';

export const TERMUX_HELPER_TOKEN_KEY = 'skid.termux.helper_token';

export async function getTermuxHelperToken(): Promise<string | null> {
  try {
    const value = await SecureStore.getItemAsync(TERMUX_HELPER_TOKEN_KEY);
    return value?.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export async function setTermuxHelperToken(token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error('Termux helper token must be non-empty.');
  }
  await SecureStore.setItemAsync(TERMUX_HELPER_TOKEN_KEY, trimmed);
}
