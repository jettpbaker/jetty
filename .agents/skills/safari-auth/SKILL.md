---
name: safari-auth
description: >-
  Open authorization, OAuth, device-login, and other confirmation pages in
  Safari on Jett's MacBook Pro. Use when Cursor, gh, or any other tool must
  confirm sign-in. Safari is not the Mac default browser; do not change that.
---

# Safari for authorization

Jett's MacBook Pro does not use Safari as the macOS default browser. Leave
System Settings › Desktop & Dock › Default web browser alone.

Cursor itself opens external http and https links, including authorization and
device-login pages, in Safari. That is the user setting
`workbench.externalBrowser` set to `safari` in
`~/Library/Application Support/Cursor/User/settings.json`:

```json
"workbench.externalBrowser": "safari"
```

If that key is missing while working on this Mac, add it. Do not put it in the
repo, and do not change the macOS default browser.

When an agent opens a confirmation URL itself, open Safari by name:

```bash
open -a Safari "https://example.com/login/device"
```

For one command that opens a browser, such as `gh auth login`, set
`BROWSER='open -a Safari'` for that command only. Do not export it for the
whole session, and do not run `defaultbrowser` or rewrite Launch Services.
