// Builds are unsigned unless signing credentials are in the environment:
//   macOS:   CSC_LINK + CSC_KEY_PASSWORD (Developer ID cert), plus APPLE_API_KEY,
//            APPLE_API_KEY_ID and APPLE_API_ISSUER for notarization.
//   Windows: AZURE_SIGN_ENDPOINT, AZURE_SIGN_ACCOUNT, AZURE_SIGN_PROFILE, AZURE_SIGN_PUBLISHER
//            (Azure Trusted Signing), plus AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET.
const env = process.env;
const macSigned = Boolean(env.CSC_LINK || env.CSC_NAME);
const winSigned = Boolean(env.AZURE_SIGN_ENDPOINT);

module.exports = {
  appId: 'io.github.vibecodyh.botbubble',
  productName: 'Bot Bubble',
  files: ['src/**/*', 'package.json', 'LICENSE'],
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    onlyLoadAppFromAsar: true,
  },
  linux: {
    target: 'AppImage',
    icon: 'build/icon.png',
    category: 'Utility',
    executableName: 'bot-bubble',
    synopsis: 'A floating dot for your AI bots',
    syncDesktopName: true,
  },
  appImage: { artifactName: 'Bot-Bubble-${version}-${arch}.AppImage' },
  mac: {
    target: ['dmg', 'zip'],
    artifactName: 'Bot-Bubble-${version}-${arch}-mac.${ext}',
    icon: 'build/icon.png',
    category: 'public.app-category.productivity',
    // "-" is an ad-hoc signature: not trusted by Gatekeeper, but enough to run on Apple silicon.
    ...(!macSigned && { identity: '-' }),
    hardenedRuntime: macSigned,
    notarize: macSigned,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    extendInfo: {
      NSMicrophoneUsageDescription: 'Bots you add can use the microphone for voice input.',
      NSCameraUsageDescription: 'Bots you add can use the camera if you allow it on their site.',
    },
  },
  dmg: { artifactName: 'Bot-Bubble-${version}-${arch}.dmg' },
  win: {
    target: ['nsis', 'portable'],
    icon: 'build/icon.png',
    ...(winSigned && {
      azureSignOptions: {
        endpoint: env.AZURE_SIGN_ENDPOINT,
        codeSigningAccountName: env.AZURE_SIGN_ACCOUNT,
        certificateProfileName: env.AZURE_SIGN_PROFILE,
        publisherName: env.AZURE_SIGN_PUBLISHER,
      },
    }),
  },
  nsis: { artifactName: 'Bot-Bubble-Setup-${version}.${ext}' },
  portable: { artifactName: 'Bot-Bubble-${version}-portable.${ext}' },
};
