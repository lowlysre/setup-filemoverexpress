# Security policy

## Reporting a vulnerability

Report vulnerabilities in this action through [GitHub private vulnerability reporting](https://github.com/lowlysre/setup-filemoverexpress/security/advisories/new). Don't open a public issue, discussion, or pull request for them.

Include the action version or commit SHA, the runner OS and architecture, the inputs involved, and steps to reproduce. A workflow log with secrets removed helps.

## Scope

This policy covers the setup-filemoverexpress action: how it resolves, downloads, verifies, caches, and configures File Mover Express, and the code in this repository.

Vulnerabilities in the `filemoverexpress` CLI itself, its release artifacts, or its signing go to the upstream project, per the [File Mover Express security policy](https://github.com/awslabs/filemoverexpress/blob/main/SECURITY.md): "Please do not report security vulnerabilities through public GitHub issues." If you can't tell which side a problem is on, report it here and it gets forwarded.

## Supported versions

Only the latest release on the current major tag (`v1`) gets fixes.

## What the action verifies

Every install fails closed. A failed check stops the step before the CLI lands on `PATH` or in the tool cache.

- **Digest**: the SHA-256 of each downloaded release asset has to match the `digest` GitHub publishes for that asset in the releases API. A missing digest fails the step.
- **Signature** (`verify-signature`, on by default):
  - Windows: the installer's Authenticode signature has to be valid, with signer organization `Amazon Web Services, Inc.`
  - macOS: the extracted binary has to pass `codesign --verify --strict`, signed by a Developer ID Application certificate with Team ID `94KV3E626L`
  - Linux: upstream doesn't sign Linux binaries, so the digest is the only check
- **Smoke test**: `filemoverexpress --version` has to report the resolved version.

Setting `verify-signature: false` skips the signature check and logs a warning. The digest check still runs. Use it only when upstream ships an unsigned build and you accept that risk.

## Credentials and tokens

- The action never reads, writes, or logs AWS credentials. The CLI resolves them at transfer time through the AWS SDK default chain, for example from the variables aws-actions/configure-aws-credentials exports.
- The `token` input is sent only to the GitHub releases API, never to the asset download host.
- The configuration file under `FME_CONFIG_DIR` holds bucket, region, endpoint, and profile names, no secrets. It lives in `RUNNER_TEMP`, which the runner wipes after each job.

## Hardening your workflow

- Pin this action to a full commit SHA, with the release tag in a comment.
- Use OIDC through aws-actions/configure-aws-credentials instead of long-lived access keys.
- Scope the IAM role to the bucket and prefix the workflow needs.
