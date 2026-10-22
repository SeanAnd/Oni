import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    throw new Error('expo-sqlite should be injected through appState test harness');
  },
}));

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///tmp/skid/',
  makeDirectoryAsync: jest.fn(async () => undefined),
  getInfoAsync: jest.fn(async () => ({ exists: false, size: 0 })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  moveAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  randomUUID: () => jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID(),
  getRandomBytes: jest.fn((length: number) => new Uint8Array(length).fill(7)),
  digest: jest.fn(async () => 'abc123'),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (callback: () => void | (() => void)) => jest.requireActual<typeof import('react')>('react').useEffect(callback, [callback]),
}));

jest.mock('~/modules/terminal/src', () => ({
  Terminal: {detect: jest.fn(async () => ({ok: false, presets: []})), status: jest.fn(() => ({state: 'idle', detail: 'Start a terminal session.', preset: 'termux'})), start: jest.fn(), close: jest.fn()},
  TerminalView: jest.requireActual('react-native').View,
}));
