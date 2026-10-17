# Collections and folders

A **collection** is a named tree of requests and folders. Collections are where shared settings live:
variables, authorization, scripts and documentation set on a collection or folder apply to
everything inside it.

## Creating and organising

- **+ New** in the Collections sidebar creates a collection.
- Hover any item and click **⋯** for its actions:
  - **Collections:** Run collection, Mock server…, Add request, Add folder, Edit variables/auth/scripts/docs,
    Export documentation (HTML), Rename, Export (Postman v2.1), Delete.
  - **Folders:** Run folder, Add request, Add folder, Edit scripts/auth/docs, Rename, Duplicate, Delete.
  - **Requests:** Rename, Duplicate, Delete.
- Click a request to open it. If the active tab is an empty, unsaved scratch tab, it's reused.
- **Filter collections** at the top of the sidebar narrows the list by name.

## What a collection or folder can hold

Open **⋯ → Edit variables, auth, scripts & docs** (collections) or **⋯ → Edit scripts, auth & docs** (folders):

| Setting | Collection | Folder | Applies to |
|---|---|---|---|
| Variables | ✓ | | Every request in the collection (see [variables](variables.md)) |
| Authorization | ✓ | ✓ | Requests whose auth is **Inherit auth from parent** |
| Pre-request / post-response scripts | ✓ | ✓ | Every request inside, run before the request's own scripts |
| Docs (Markdown) | ✓ | ✓ | Shown in exported [documentation](import-export.md#api-documentation) |

### Inheritance order

**Authorization** — a request set to *Inherit* uses its nearest folder's auth, then the next folder
up, then the collection's. The Authorization tab shows which one is in effect.

**Scripts** run outermost first:

```
collection pre-request → folder pre-request → request pre-request
        → request is sent →
collection tests → folder tests → request tests
```

## Tabs

- Unsaved edits show a dot on the tab. **⌘S** saves; closing a collection request with unsaved
  changes asks first.
- Requests opened from a collection remember where they came from, so the breadcrumb above the URL
  shows `Collection / Folder / Request`.
- Click the request name in the editor header to rename it.

## History

Every request you send is recorded in **History** (newest first, grouped by day, last 200 kept).
Click an entry to open a copy in a new tab. **Clear** empties it.
