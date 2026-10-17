# Getting started

## Install

Download the installer for your computer from the
[latest release](https://github.com/gkravi/apiman/releases/latest):

| Computer | File |
|---|---|
| Mac with Apple Silicon (M1 or later) | `ApiMan-<version>-arm64.dmg` |
| Mac with an Intel processor | `ApiMan-<version>-x64.dmg` |
| Windows PC (most PCs) | `ApiMan-Setup-<version>-x64.exe` |
| Windows on ARM | `ApiMan-Setup-<version>-arm64.exe` |
| Linux | `ApiMan-<version>.AppImage` or `apiman_<version>_amd64.deb` |

Not sure which Mac you have? Open  → **About This Mac**: "Chip: Apple M…" means Apple Silicon,
"Processor: Intel" means Intel.

### macOS

1. Open the `.dmg` and drag **ApiMan** into **Applications**.
2. The first time, **right-click ApiMan → Open → Open**. (Unsigned builds can't be opened with a
   double-click the first time; signed builds can.)

If macOS says the app "is damaged and can't be opened", the download was quarantined. Run this once
in Terminal, then open it normally:

```bash
xattr -dr com.apple.quarantine /Applications/ApiMan.app
```

### Windows

Run `ApiMan-Setup-<version>-x64.exe` and follow the installer. If Windows SmartScreen shows
"Windows protected your PC", click **More info → Run anyway**. ApiMan appears in the Start menu.

### Linux

- **AppImage:** `chmod +x ApiMan-*.AppImage`, then run it.
- **Debian/Ubuntu:** `sudo apt install ./apiman_*_amd64.deb`, then launch **ApiMan** from your app menu.

## Send your first request

1. Click **New** (or press **⌘T** / **Ctrl+T**). A new request tab opens.
2. Type a URL, for example `https://httpbin.org/get?hello=world`. The query parameter appears in the
   **Params** table as you type.
3. Press **Enter** or click **Send**.

The response appears below: status, time and size on the right, the body pretty-printed in the
**Body** tab, plus **Headers**, **Cookies**, **Test Results** and **Timeline**.

> **Tip:** paste a whole cURL command into the URL bar and ApiMan turns it into a request —
> method, headers, body and auth included.

## Save it to a collection

Press **⌘S** / **Ctrl+S** (or **Save**). Name the request, pick a collection (or create one) and
optionally a folder. Saved requests appear in the sidebar; edits show a dot on the tab until you save.

## The window at a glance

![Main window](images/request.png)

| Area | What it does |
|---|---|
| **Top bar** | New tab, Import, the cookie manager, Settings (proxy and certificates), and the active environment picker with its eye button for editing it |
| **Sidebar rail** | Switch between **Collections**, **Environments**, **History** and **Monitors** |
| **Tab bar** | Open requests. A dot means unsaved changes; middle-click closes a tab |
| **Request editor** | Protocol, method and URL, then tabs for Params, Authorization, Headers, Body, Scripts, Settings, Examples and Docs |
| **Response panel** | The result of the last send. Drag the divider above it to resize |
| **Console** (bottom) | Every request sent, plus `console.log` output and errors from scripts |

## Next steps

- Use [variables and environments](variables.md) so the same request works against dev, staging and production.
- Add [tests](scripting.md) and run a whole collection with the [collection runner](collection-runner.md).
- Already use Postman? [Import](import-export.md) your collections and environments.
