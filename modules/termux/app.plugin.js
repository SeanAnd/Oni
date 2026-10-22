const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

const TERMUX_PACKAGE = 'com.termux';

/** Adds Termux package visibility and RUN_COMMAND permission for the local module. */
function withSkidTermuxAndroid(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    if (!manifest.queries) {
      manifest.queries = [{}];
    }
    const queries = manifest.queries[0];
    if (!queries.package) {
      queries.package = [];
    }
    const packages = Array.isArray(queries.package) ? queries.package : [queries.package];
    if (!packages.some((entry) => entry?.$?.['android:name'] === TERMUX_PACKAGE)) {
      packages.push({ $: { 'android:name': TERMUX_PACKAGE } });
    }
    queries.package = packages;

    const permissions = manifest['uses-permission'] ?? [];
    const permList = Array.isArray(permissions) ? permissions : [permissions];
    const runCommandPerm = 'com.termux.permission.RUN_COMMAND';
    if (!permList.some((entry) => entry?.$?.['android:name'] === runCommandPerm)) {
      permList.push({ $: { 'android:name': runCommandPerm } });
    }
    manifest['uses-permission'] = permList;
    const application = manifest.application[0];
    application.$['android:networkSecurityConfig'] = '@xml/skid_network_security_config';
    return config;
  });
}

module.exports = function skidTermuxConfigPlugin(config) {
  config = withSkidTermuxAndroid(config);
  return withDangerousMod(config, ['android', async (mod) => {
    const directory = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    fs.mkdirSync(directory, {recursive: true});
    fs.writeFileSync(path.join(directory, 'skid_network_security_config.xml'), `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">127.0.0.1</domain><domain includeSubdomains="false">localhost</domain>
  </domain-config>
</network-security-config>
`);
    return mod;
  }]);
};
