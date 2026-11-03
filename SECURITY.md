# Security Policy

## Supported versions

Security fixes are applied to the latest release and the `main` branch. Older releases may not receive fixes.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/ailawu0409/dsh-session-archive/security/advisories/new) instead of a public issue. Include affected versions, reproduction steps using synthetic data, impact, and a suggested mitigation when available.

Do not include real session content, credentials, access tokens, private keys, or unredacted local paths. Maintainers will acknowledge reports as soon as reasonably possible and coordinate disclosure after a fix is available.

## Data safety

This plugin can permanently delete session logs after explicit confirmation. Automatic archiving is disabled by default, but users should still back up important data before enabling automation or testing deletion.

When testing or reporting deletion-related issues, use a disposable DSH profile and synthetic session data. Never test destructive behavior against real sessions.
