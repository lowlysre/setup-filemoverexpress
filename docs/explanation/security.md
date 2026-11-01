# Security model

A setup action runs a downloaded binary inside a job that often holds cloud credentials. This page lays out what the action trusts, what it checks, and what it leaves to you.

## What gets trusted

The action trusts three things:

- api.github.com, for the list of releases and each asset's SHA-256 digest
- Amazon's code-signing identities: the Authenticode certificate issued to `Amazon Web Services, Inc.` and the Apple Developer ID with Team ID `94KV3E626L`
- The runner tool cache, on a cache hit

Everything between the API and the extracted binary is checked. The download host, any proxy, and the CDN can't swap the file without the digest check failing. On Windows and macOS, someone who could alter both the asset and its digest, for example by compromising the upstream release, would still need Amazon's signing key to pass the signature check.

Linux has no signature to check, so Linux installs rest on the digest and on access to the upstream repository's releases.

## No installer execution

The macOS DMG and Windows NSIS installer are both built for a GUI install. Running them would mean admin rights, a UAC prompt on Windows, and code from the installer script running on the runner. The action reads them as archives instead: it mounts the DMG read-only, and opens the NSIS installer with 7-Zip. Only the verified CLI binary leaves the archive.

## The token

The `token` input exists for API rate limits. It goes in the `Authorization` header to api.github.com and nowhere else. Release downloads are public, so the action doesn't send the token to the download host or the storage host it redirects to.

On GitHub Enterprise Server the default is empty, because the instance's `github.token` isn't valid on github.com and the action has no reason to send it there.

## Credentials stay out of the action

The action never reads, writes, or logs AWS credentials. It reads only the region variables and `AWS_PROFILE`, plus the AWS config file for `region`. The [credentials page](./credentials.md) has the full order. That keeps the generated config free of secrets, so it's safe to print to a log or upload as a debugging artifact.

## Why the config lives in RUNNER_TEMP

File Mover Express keeps its config, checksum cache, and logs in `~/.filemoverexpress` by default. On a self-hosted runner, the home directory outlives the job, so a profile written by one workflow would be visible to every later job on that machine, and a malicious job could plant a profile for the next one to use.

The action points `FME_CONFIG_DIR` at `${RUNNER_TEMP}/filemoverexpress` instead:

- The runner empties `RUNNER_TEMP` after every job, so nothing carries over
- The directory is created with mode `700` and `configuration.yaml` with mode `600`
- The CLI writes nothing under the home directory while `FME_CONFIG_DIR` is set

Set `config-dir` to override this, for example to load a config committed to the repository.

## Known gaps

> [!WARNING]
> On a tool cache hit, the action doesn't re-check the digest or signature; it only runs the smoke test. On self-hosted runners, restrict write access to `RUNNER_TOOL_CACHE`, or use ephemeral runners.

- A binary installed with `verify-signature: false` on Windows or macOS isn't added to the tool cache, so it can't be reused by a later job that requires verification
- File Mover Express starts a listener on 127.0.0.1 during a transfer. Other processes on the same machine can reach it, which matters only on shared self-hosted runners
- The CLI warns when it runs as root or Administrator. [Use self-hosted runners](../how-to/self-hosted-runners.md#dont-run-as-root) covers what to do about it

## Hardening your workflow

- Pin this action and every other third-party action to a full commit SHA, as in [Pin the action itself](../how-to/versions.md#pin-the-action-itself)
- Use OIDC through configure-aws-credentials instead of long-lived access keys, and scope the role's trust policy to a repository and branch or environment
- Give the role only the S3 actions File Mover Express calls, on only the buckets it needs. The [tutorial](../tutorials/first-upload.md) has a least-privilege policy
- Set `permissions:` on every job. This action needs no `GITHUB_TOKEN` permissions of its own; the token only raises the API rate limit
- Pass step outputs to scripts through `env:` rather than expanding them inside `run:`
