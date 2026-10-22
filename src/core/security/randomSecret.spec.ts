import { getRandomBytes } from 'expo-crypto';
import { generateRandomSecret } from './randomSecret';
it('requires native cryptographic randomness for the authentication token', () => {
  expect(generateRandomSecret()).toHaveLength(64);
  expect(getRandomBytes).toHaveBeenCalledWith(32);
  jest.mocked(getRandomBytes).mockImplementationOnce(() => { throw new Error('randomness unavailable'); });
  expect(() => generateRandomSecret()).toThrow('randomness unavailable');
});
