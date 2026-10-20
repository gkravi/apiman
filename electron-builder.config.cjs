// Installer builds: `npm run dist` (all targets for this OS) or `npm run dist:dir` (unpacked, quick).
//
// Code signing / notarisation turn on automatically when credentials are present:
//   macOS   CSC_LINK + CSC_KEY_PASSWORD (Developer ID .p12) or a Developer ID identity in the keychain;
//           notarisation with APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER
//           (or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID)
//           the .pkg installer with CSC_INSTALLER_LINK + CSC_INSTALLER_KEY_PASSWORD (Developer ID Installer .p12)
//   Windows WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD (or CSC_LINK on a Windows build machine), or Azure
//           Trusted Signing with AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET + AZURE_TRUSTED_SIGNING_* below
// Without them the macOS app is ad-hoc signed (by the fuses step, resetAdHocDarwinSignature) and
// Windows builds are unsigned, which is fine for local use. Without that ad-hoc signature, macOS
// reports a downloaded app as "damaged" (the v0.5.0 release had this problem).

const notarize = Boolean((process.env.APPLE_API_KEY && process.env.APPLE_API_ISSUER) || (process.env.APPLE_ID && process.env.APPLE_TEAM_ID))

// Azure Trusted Signing (Microsoft's managed Authenticode service) when its account is configured.
const azure = process.env.AZURE_TRUSTED_SIGNING_ENDPOINT
  ? {
      azureSignOptions: {
        publisherName: process.env.AZURE_TRUSTED_SIGNING_PUBLISHER,
        endpoint: process.env.AZURE_TRUSTED_SIGNING_ENDPOINT,
        codeSigningAccountName: process.env.AZURE_TRUSTED_SIGNING_ACCOUNT,
        certificateProfileName: process.env.AZURE_TRUSTED_SIGNING_PROFILE
      }
    }
  : {}

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'dev.apiman.app',
  productName: 'ApiMan',
  copyright: `Copyright © ${new Date().getFullYear()} ravi`,
  directories: { output: 'dist', buildResources: 'build' },
  // Everything the app needs is bundled into out/ by electron-vite; runtime deps come from node_modules.
  files: ['out/main/**', 'out/preload/**', 'out/renderer/**', 'package.json', '!**/*.map'],
  // The script sandbox loads its WebAssembly interpreter from disk; keep it outside the asar archive.
  asarUnpack: ['node_modules/@jitl/quickjs-wasmfile-*/**'],
  mac: {
    category: 'public.app-category.developer-tools',
    // Architectures come from the command line (`--arm64 --x64` in CI); locally the host arch is built.
    // dmg/zip for people; pkg for MDM tools (Jamf, Intune, Kandji), which install packages silently.
    target: [{ target: 'dmg' }, { target: 'zip' }, { target: 'pkg' }],
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize
  },
  dmg: { artifactName: '${productName}-${version}-${arch}.${ext}' },
  pkg: { artifactName: '${productName}-${version}-${arch}.${ext}', installLocation: '/Applications', allowAnywhere: false, allowCurrentUserHome: false },
  win: { target: [{ target: 'nsis', arch: ['x64', 'arm64'] }], ...azure },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, artifactName: '${productName}-Setup-${version}-${arch}.${ext}' },
  linux: { target: ['AppImage', 'deb'], category: 'Development', maintainer: 'ravi <17067993+gkravi@users.noreply.github.com>', synopsis: 'API client for HTTP, GraphQL, WebSocket, SSE and gRPC' },
  // Electron fuses: switch off ways to run the packaged app as something else (ELECTRON_RUN_AS_NODE,
  // NODE_OPTIONS, --inspect) and refuse a tampered app.asar. file:// keeps its privileges because the
  // bundled page loads as an ES module from disk.
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableCookieEncryption: true,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    grantFileProtocolExtraPrivileges: true,
    resetAdHocDarwinSignature: true
  },
  publish: null
}
