# Inputs

All inputs are optional. With none set, the action installs the latest File Mover Express release, verifies it, puts it on `PATH`, and exports `FME_CONFIG_DIR`. It writes a transfer profile only when `bucket` is set.

## Install

| Input                           | Default                                       | Description                                                                                                                                                                                                                                                   |
| ------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filemoverexpress-version`      | `''` (latest)                                 | `latest`, an exact version such as `1.1.1` (a leading `v` is fine), or a semver range such as `1.x` or `>=1.0 <2`.                                                                                                                                            |
| `filemoverexpress-version-file` | `''`                                          | Path, relative to the workspace, of a file holding the version. Reads the first line after stripping `#` comments and blank lines, or the `filemoverexpress` entry of a `.tool-versions` file. Ignored with a warning when `filemoverexpress-version` is set. |
| `architecture`                  | Runner's arch                                 | `x64` (also `amd64`, `x86_64`) or `arm64` (also `aarch64`).                                                                                                                                                                                                   |
| `check-latest`                  | `false`                                       | When `false`, a cached version that satisfies the request is used without calling the GitHub API. When `true`, always resolves against the API. `latest` always uses the API.                                                                                 |
| `allow-prerelease`              | `false`                                       | Includes prereleases when resolving the version.                                                                                                                                                                                                              |
| `token`                         | `github.token` on github.com, empty elsewhere | Token for GitHub API release lookups, to avoid rate limits. Sent only to api.github.com, never to the download host.                                                                                                                                          |
| `verify-signature`              | `true`                                        | Verifies the Authenticode signature (Windows) or Apple code signature (macOS). The SHA-256 digest check always runs. Set `false` only if upstream ships an unsigned build.                                                                                    |

The literal default for `token`:

```yaml
token: ${{ github.server_url == 'https://github.com' && github.token || '' }}
```

## Configure

| Input                  | Default                           | Description                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config-dir`           | `${RUNNER_TEMP}/filemoverexpress` | Directory exported as `FME_CONFIG_DIR`. Holds `configuration.yaml`, the checksum cache, and logs.                                                                                                                                                                                                                             |
| `transfer-profile`     | `default`                         | Name of the transfer profile written when `bucket` is set. 1 to 64 letters, digits, `.`, `_`, or `-`, starting with a letter or digit.                                                                                                                                                                                        |
| `bucket`               | `''`                              | S3 bucket name, without `s3://`. When set, the action writes or replaces the transfer profile in `configuration.yaml`.                                                                                                                                                                                                        |
| `region`               | `''`                              | Bucket region. Falls back to `AWS_REGION`, then `AWS_DEFAULT_REGION`, then the effective profile's `region` in `$AWS_CONFIG_FILE`. Required, from one of those sources, when `bucket` is set.                                                                                                                                 |
| `aws-profile`          | `''`                              | AWS named profile. When set, it's written to the transfer profile as `profile` and used for region lookup. Empty means the AWS SDK default credential chain.                                                                                                                                                                  |
| `endpoint`             | `''`                              | Custom S3 endpoint, an http or https URL, for S3-compatible stores and moto. Can't be combined with `accelerate`.                                                                                                                                                                                                             |
| `storage-class`        | `standard`                        | `standard`, `reduced_redundancy`, `standard_ia`, `onezone_ia`, `intelligent_tiering`, `glacier`, `deep_archive`, or `glacier_ir`.                                                                                                                                                                                             |
| `checksum-algorithm`   | `none`                            | `none`, `md5-hex`, `xxhash`, `xxhash64`, or `xxh3`. Anything but `none` turns checksums on.                                                                                                                                                                                                                                   |
| `accelerate`           | `false`                           | Uses S3 Transfer Acceleration. The bucket must have it turned on.                                                                                                                                                                                                                                                             |
| `validate-credentials` | `false`                           | Runs `filemoverexpress validate-credentials` against the transfer profile named by `transfer-profile` and fails the step unless the CLI confirms it can list the bucket. Works with a profile written by `bucket` or one already in `config-dir`; fails if the profile doesn't exist. Needs credentials from an earlier step. |

## Validation rules

The action fails before downloading anything when:

- `bucket` isn't a valid bucket name, for example `s3://my-bucket` or `my-bucket/path`
- `transfer-profile` or `aws-profile` contains characters outside the allowed set
- `endpoint` isn't an http or https URL, or contains credentials
- `storage-class` or `checksum-algorithm` isn't one of the listed values

It fails after installing, before writing any config, when `bucket` is set and either no region can be resolved or `accelerate` and `endpoint` are both set.
