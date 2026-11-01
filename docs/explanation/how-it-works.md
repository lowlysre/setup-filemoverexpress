# How it works

Setup File Mover Express does two jobs: put a verified File Mover Express CLI on `PATH`, and write a transfer profile the CLI can use. This page follows one run from start to finish.

## 1. Resolve the version

The action reads `filemoverexpress-version`, or `filemoverexpress-version-file` when the first is empty. An empty value means `latest`.

Unless `check-latest` is `true` or the request is `latest`, it looks in the runner tool cache first. A cached version that satisfies an exact version or a range ends the install phase right there: no API call and no download. That's the [cache hit path](./caching.md).

Otherwise it lists releases from api.github.com for awslabs/filemoverexpress, drops drafts (and prereleases unless `allow-prerelease` is set), and picks the highest version that satisfies the request. Upstream tags have no `v` prefix, but the action accepts either form.

## 2. Download and check the digest

The action picks the release asset for the runner's OS and architecture, listed in [Supported platforms](../reference/platforms.md), and downloads it from its `browser_download_url`. The `token` input isn't sent with the download.

GitHub computes a SHA-256 digest for every release asset at upload time and returns it in the Releases API as `digest: sha256:<hex>`. The action hashes the downloaded file and fails if the hash differs or the API returned no digest. That ties the bytes on disk to what upstream published, even if the download went through a proxy or CDN.

## 3. Check the signature

The digest proves the file matches the release. The signature proves Amazon built it. With `verify-signature: true`, the default, the action checks:

- **Windows**: the NSIS installer's Authenticode signature, before anything is extracted. The CLI inside isn't signed on its own
- **macOS**: the extracted binary's code signature, which comes from the signed and notarized app bundle
- **Linux**: nothing. Upstream doesn't sign Linux builds, so the digest is the only check

[Supported platforms](../reference/platforms.md#verification-per-platform) lists the exact signer and Team ID checked on each platform. `verify-signature: false` skips this step with a warning. It's there for the case where an upstream release ships unsigned, which its release pipeline allows as a fallback.

## 4. Extract the CLI

Nothing is installed system-wide, and no installer runs. The [release asset table](../reference/platforms.md#release-assets) shows what each platform ships:

- Linux assets are the CLI itself, so the action copies the file and sets mode `755`
- macOS DMGs are mounted read-only with `hdiutil attach -readonly -nobrowse`, the CLI is copied out, and the image is detached
- Windows NSIS installers are archives that 7-Zip can read. `7z e` pulls `filemoverexpress.exe` out of the installer root without executing it, so there's no UAC prompt, no WebView2 dependency, and no GUI install

## 5. Cache and smoke test

The verified binary goes into the tool cache at `filemoverexpress/<version>/<arch>`. The action then runs `filemoverexpress --version` with a throwaway `FME_CONFIG_DIR` and compares the reported version with the resolved one. A mismatch fails the step. If the output can't be parsed, the action logs a warning and continues.

The smoke test runs on cache hits too, so a corrupted or swapped cache entry that reports the wrong version still fails.

## 6. Configure

The action adds the CLI's directory to `PATH`, creates the config directory with mode `700`, and exports it as `FME_CONFIG_DIR`.

When `bucket` is set, the action resolves the region, then adds or replaces one entry under `protocols.s3.transferProfiles` in `configuration.yaml` (mode `600`). Everything else in the file stays as it is. Keys are camelCase because that's what File Mover Express reads; it silently ignores snake_case keys. [Configure buckets and transfer profiles](../how-to/transfer-profiles.md#use-multiple-buckets) shows the resulting file.

`profile` and `endpoint` keys are added only when `aws-profile` and `endpoint` are set. File Mover Express fills in its remaining defaults the first time a command runs.

## 7. Validate and finish

With `validate-credentials: true`, the action runs `filemoverexpress validate-credentials <transfer-profile>` and looks for `Validated credentials for <transfer-profile>` in the output. The exit code alone isn't enough; see [Exit codes](./exit-codes.md).

Finally, it registers the problem matcher for `ERROR`, `FATAL`, and `WARNING` log lines and sets the [outputs](../reference/outputs.md). There's no post step. The config directory lives in `RUNNER_TEMP`, which the runner empties after every job.
