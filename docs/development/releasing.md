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

The app is signed with the hardened runtime (`build/entitlements.mac.plist` allows the JIT that V8
and the WebAssembly sandbox need, plus network client/server) and notarised automatically.

To sign locally instead, have the Developer ID certificate in your login keychain and set
`APPLE_API_KEY` (path to the `.p8`), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` before `npm run dist`.

### Windows

Buy a code-signing certificate from a certificate authority, export it as a `.pfx`, then add:

| Secret | Value |
|---|---|
| `WIN_CSC_LINK` | base64 of the `.pfx` |
| `WIN_CSC_KEY_PASSWORD` | Its password |

Certificates stored on hardware tokens or cloud HSMs (common for newer EV/OV certificates) need a
signing service such as Azure Trusted Signing instead; see the
[electron-builder Windows signing docs](https://www.electron.build/code-signing-win).
