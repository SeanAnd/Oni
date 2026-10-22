# CommonJS compatibility for the upstream security fix

This is the MIT-licensed upstream `decode-uri-component@0.5.0` implementation.
Only `export default` was changed to `module.exports` so Expo Router's
`query-string@7` CommonJS consumer receives a function. The upstream fix replaces
exponential recursion on malformed percent-encoded input (GHSA-vcc3-ghjq-m6fr).

Source: https://github.com/SamVerschueren/decode-uri-component/tree/v0.5.0
npm tarball: https://registry.npmjs.org/decode-uri-component/-/decode-uri-component-0.5.0.tgz
Upstream index.js SHA-256: `9401353df38f8010ad7035fe8d666bce6a4902bc1cff809afc4ab23fa2e0bdaa`

Remove the scoped package override when Expo Router upgrades its decoder dependency.
Tests exercise the actual query-string consumer, valid UTF-8, malformed sequences,
and a large hostile input. Preserve the upstream license.
