// Installer builds: `npm run dist` (all targets for this OS) or `npm run dist:dir` (unpacked, quick).
//
// Code signing / notarisation turn on automatically when credentials are present:
//   macOS   CSC_LINK + CSC_KEY_PASSWORD (Developer ID .p12) or a Developer ID identity in the keychain;
//           notarisation with APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER
//           (or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID)
//   Windows WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD (or CSC_LINK on a Windows build machine)
// Without them the build is unsigned, which is fine for local use.

const notarize = Boolean((process.env.APPLE_API_KEY && process.env.APPLE_API_ISSUER) || (process.env.APPLE_ID && process.env.APPLE_TEAM_ID))

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
    target: [{ target: 'dmg' }, { target: 'zip' }],
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize
  },
  dmg: { artifactName: '${productName}-${version}-${arch}.${ext}' },
  win: { target: [{ target: 'nsis', arch: ['x64', 'arm64'] }] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, artifactName: '${productName}-Setup-${version}-${arch}.${ext}' },
  linux: { target: ['AppImage', 'deb'], category: 'Development', maintainer: 'ravi <17067993+gkravi@users.noreply.github.com>' },
  publish: null
}
