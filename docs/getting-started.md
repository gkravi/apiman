# Getting started

## Install

Download the installer for your computer from the
[latest release](https://github.com/gkravi/apiman/releases/latest):

| Computer | File |
|---|---|
| Mac with Apple Silicon (M1 or later) | `ApiMan-<version>-arm64.dmg` (or `.pkg` for MDM deployment) |
| Mac with an Intel processor | `ApiMan-<version>-x64.dmg` (or `.pkg`) |
| Windows PC (most PCs) | `ApiMan-Setup-<version>-x64.exe` |
| Windows on ARM | `ApiMan-Setup-<version>-arm64.exe` |
| Linux | `ApiMan-<version>.AppImage` or `apiman_<version>_amd64.deb` |

Not sure which Mac you have? Open  → **About This Mac**: "Chip: Apple M…" means Apple Silicon,
"Processor: Intel" means Intel.

### macOS

1. Open the `.dmg` and drag **ApiMan** into **Applications**.
2. Open ApiMan. Current releases are not yet signed with an Apple Developer ID, so the first time
   macOS says *"Apple could not verify ApiMan is free of malware"*. Click **Done**, then open
   **System Settings → Privacy & Security**, scroll to **Security** and click **Open Anyway** next
   to the ApiMan message. Confirm with your password. (On macOS 14 and earlier, **right-click
   ApiMan → Open → Open** also works.) You only need to do this once.

!!! warning "ApiMan 0.5.0 on macOS: ‘ApiMan is damaged and can’t be opened’"
    The macOS downloads of 0.5.0 have a broken signature, so macOS refuses to open them and offers
    no **Open Anyway** button. Install a later release, or, after checking the download against
    `SHA256SUMS-macOS.txt`, run this once in Terminal and then open the app normally:

    ```bash
    xattr -dr com.apple.quarantine /Applications/ApiMan.app
    ```

    This removes the "downloaded from the internet" flag from ApiMan only.

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
| **Top bar** | New tab, Import, the [command palette](command-palette.md) (**⌘K**), the theme switch, the cookie manager, Settings, and the active environment picker with its eye button for editing it |
| **Sidebar rail** | Switch between **Collections**, **Environments**, **History** and **Monitors** |
| **Tab bar** | Open requests. A dot means unsaved changes; middle-click closes a tab |
| **Request editor** | Protocol, method and URL, then tabs for Params, Authorization, Headers, Body, Scripts, Settings, Examples and Docs |
| **Response panel** | The result of the last send. Drag the divider above it to resize |
| **Console** (bottom) | Every request sent, plus `console.log` output and errors from scripts |

## Next steps

- Press **⌘K** to jump to any request, environment or command — see [Command palette and themes](command-palette.md).

- Use [variables and environments](variables.md) so the same request works against dev, staging and production.
- Add [tests](scripting.md) and run a whole collection with the [collection runner](collection-runner.md).
- Already use Postman? [Import](import-export.md) your collections and environments.
