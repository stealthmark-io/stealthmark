# Security Policy

## Reporting a vulnerability

Please do not open a public GitHub issue for a security problem.

Report it privately to security@stealthmark.io. Include:

- the component and version or commit (for example `@stealthmark/core` 0.1.0, or `apps/api`),
- a description of the issue and its impact,
- steps or a minimal proof of concept to reproduce it.

We will acknowledge the report, investigate, and coordinate a fix and disclosure with you. This is a small project, so there is no guaranteed response time and there are no fixed fix deadlines.

## Scope

- The open-source SDK packages `@stealthmark/core`, `@stealthmark/next`, `@stealthmark/express` and `@stealthmark/cli`, built from https://github.com/stealthmark-io/stealthmark-sdk and published to npm.
- The hosted StealthMark service: the website and console at stealthmark.io, the control-plane API and the agent gateway.

Out of scope: vulnerabilities in third-party dependencies (report them to their maintainers), social engineering and denial-of-service attacks.

## Supported versions

The SDK is published to npm. Only the latest published version and the latest commit on `main` are supported. There is no long-term support for older versions.

## Reminder for users of the SDK

- The SDK detects only agents that identify themselves and is not a security control. Do not rely on it to keep anyone out.
- Keep API keys in environment variables or a secret manager, never in the repository, and rotate a key if it may have leaked.
- Send usage events only over HTTPS.
