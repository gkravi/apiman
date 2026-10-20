# Releasing

Releases are built by GitHub Actions (`.github/workflows/release.yml`) when a version tag is pushed.

## Cut a release

1. Make sure `master` is green in CI.
2. Bump `"version"` in `package.json` (the app, installers, the CLI's `--version` and the
   `User-Agent` header all read it from there).
3. Move the *Unreleased* notes in `CHANGELOG.md` under the new version and date.
4. Commit, tag and push:

   ```bash
   git commit -am "Release v0.6.0"
   git tag v0.6.0
   git push origin master v0.6.0
   ```

5. The **Release** workflow builds, in parallel:

   | Runner | Output |
   |---|---|
   | macOS | `ApiMan-<v>-arm64.dmg`, `ApiMan-<v>-x64.dmg`, matching `.zip` files |
   | Windows | `ApiMan-Setup-<v>-x64.exe`, `-arm64.exe`, and a combined `ApiMan-Setup-<v>.exe` |
   | Linux | `ApiMan-<v>.AppImage`, `apiman_<v>_amd64.deb` |

   and attaches them to a **draft** release (about 15 minutes; Windows is slowest).

6. On GitHub → **Releases**, open the draft, paste the changelog section into the notes, and
   **Publish**. Or: `gh release edit v0.6.0 --draft=false --latest`.

To rebuild without a new tag, run the workflow manually (**Actions → Release → Run workflow**).

## Building locally

```bash
npm run dist       # installers for this OS and architecture, in dist/
npm run dist:dir   # unpacked app only, fastest
```

macOS can only build macOS installers locally; use the workflow for Windows and Linux.

## Code signing and notarisation

Unsigned builds work but show warnings on first launch. To sign, add these **repository secrets**
(Settings → Secrets and variables → Actions). The workflow uses whichever are present.

### macOS

Requires an [Apple Developer Program](https://developer.apple.com/programs/) membership.

1. In Xcode or the developer portal, create a **Developer ID Application** certificate and export it
   from Keychain Access as a `.p12` with a password.
2. In App Store Connect → Users and Access → Integrations → **App Store Connect API**, create a key
   with *Developer* access; download the `.p8` and note the Key ID and Issuer ID.
3. Add secrets:

   | Secret | Value |
   |---|---|
   | `MAC_CSC_LINK` | `base64 -i cert.p12 \| pbcopy`, then paste |
   | `MAC_CSC_KEY_PASSWORD` | The `.p12` password |
   | `APPLE_API_KEY_BASE64` | `base64 -i AuthKey_XXXX.p8 \| pbcopy`, then paste |
   | `APPLE_API_KEY_ID` | Key ID |
   | `APPLE_API_ISSUER` | Issuer ID |
   | `MAC_CSC_INSTALLER_LINK` | Optional: base64 `.p12` of a **Developer ID Installer** certificate, to sign the `.pkg` |
   | `MAC_CSC_INSTALLER_KEY_PASSWORD` | Its password |

The app is signed with the hardened runtime (`build/entitlements.mac.plist` allows the JIT that V8
and the WebAssembly sandbox need, plus network client/server) and notarised automatically. When the
installer certificate is present, the workflow also notarises and staples the `.pkg`.

Without a certificate, the app still gets a valid **ad-hoc** signature: the Electron fuses step
(`resetAdHocDarwinSignature` in `electron-builder.config.cjs`) re-signs the bundle. That signature
matters: if a downloaded app's signature doesn't verify, macOS calls it "damaged" and offers no way
to open it. The v0.5.0 macOS release shipped that way.

Every release build runs a **Verify macOS signatures** step before uploading anything. It runs
`codesign --verify --deep --strict` on each app. For notarised builds it also runs
`spctl --assess` and `xcrun stapler validate`. A build that fails is never published. To check a
local build the same way:

```bash
codesign --verify --deep --strict --verbose=2 dist/mac-arm64/ApiMan.app
```

To sign locally instead, have the Developer ID certificate in your login keychain and set
`APPLE_API_KEY` (path to the `.p8`), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` before `npm run dist`.

### Windows

Buy a code-signing certificate from a certificate authority, export it as a `.pfx`, then add:

| Secret | Value |
|---|---|
| `WIN_CSC_LINK` | base64 of the `.pfx` |
| `WIN_CSC_KEY_PASSWORD` | Its password |

Since 2023, CAs issue new OV and EV certificates only on hardware tokens or cloud HSMs, so a
`.pfx` export is often not possible. The simpler route is **Azure Trusted Signing**, Microsoft's
managed signing service (identity-validated, a few dollars a month). Set it up in Azure, create an
app registration with the *Trusted Signing Certificate Profile Signer* role, then add:

| Kind | Name | Value |
|---|---|---|
| Secret | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | The app registration |
| Variable | `AZURE_TRUSTED_SIGNING_ENDPOINT` | e.g. `https://eus.codesigning.azure.net` |
| Variable | `AZURE_TRUSTED_SIGNING_ACCOUNT` | Trusted Signing account name |
| Variable | `AZURE_TRUSTED_SIGNING_PROFILE` | Certificate profile name |
| Variable | `AZURE_TRUSTED_SIGNING_PUBLISHER` | The publisher name on the certificate (must match exactly) |

See the [electron-builder Windows signing docs](https://www.electron.build/code-signing-win).
