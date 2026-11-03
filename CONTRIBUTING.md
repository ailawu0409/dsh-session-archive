# Contributing

Thank you for contributing to dsh-session-archive.

## Before you start

- Search existing issues before opening a duplicate.
- Never include real session content, access tokens, private keys, or unredacted local paths in issues, pull requests, tests, or fixtures.
- Discuss large behavior or public interface changes in an issue first.

## Development setup

Use Node.js 22 or newer. Clone the repository and run the checks directly; there are no third-party runtime dependencies to install.

```sh
git clone https://github.com/ailawu0409/dsh-session-archive.git
cd dsh-session-archive
npm run check
npm test
```

Use `npm run test:host` or `npm run test:client` while iterating on one half of the plugin. Run the full suite before submitting a pull request.

## Making changes

- Keep the package name in `package.json`, `index.js`, `client.js`, `cordis.patch.yml`, and tests synchronized.
- Preserve Host-side validation for every operation that changes files or archive state.
- Do not weaken safeguards for live, pinned, in-use, or ambiguous sessions.
- Add regression tests for bug fixes and update both documentation languages for user-facing changes.
- Use temporary directories and fake services. Never point tests at a real DSH profile or real session logs.
- Keep changes focused and explain destructive behavior, compatibility, and migration effects in the pull request.

## Pull request checklist

1. `npm run check` passes.
2. `npm test` passes.
3. `npm pack --dry-run` contains only intended package files.
4. Documentation and changelog entries match the change.
5. No secrets, personal data, or real session logs are included.

By contributing, you agree that your contribution is licensed under the MIT License.
