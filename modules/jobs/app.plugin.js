const { withAndroidManifest } = require('@expo/config-plugins');

const SKID_JOBS_CHANNEL = 'skid_jobs';

/** Foreground service, notifications, and JobsService declaration for durable execution. */
function withSkidJobsAndroid(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const permissions = manifest['uses-permission'] ?? [];
    const permList = Array.isArray(permissions) ? permissions : [permissions];
    const needed = [
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.WAKE_LOCK',
    ];
    for (const name of needed) {
      if (!permList.some((entry) => entry?.$?.['android:name'] === name)) {
        permList.push({ $: { 'android:name': name } });
      }
    }
    manifest['uses-permission'] = permList;

    const application = manifest.application?.[0] ?? manifest.application;
    if (application) {
      if (!application.service) {
        application.service = [];
      }
      const services = Array.isArray(application.service) ? application.service : [application.service];
      const serviceName = 'expo.modules.jobs.JobForegroundService';
      if (!services.some((entry) => entry?.$?.['android:name'] === serviceName)) {
        services.push({
          $: {
            'android:name': serviceName,
            'android:exported': 'false',
            'android:foregroundServiceType': 'dataSync',
          },
        });
      }
      application.service = services;
    }

    return config;
  });
}

module.exports = function skidJobsConfigPlugin(config) {
  config = withSkidJobsAndroid(config);
  return config;
};

module.exports.SKID_JOBS_CHANNEL = SKID_JOBS_CHANNEL;
