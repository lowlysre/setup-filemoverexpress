# Environment variables

## Written by the action

| Variable             | When                                                                    | Value                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PATH`               | Always                                                                  | The CLI's tool cache directory is prepended.                                                                                                       |
| `FME_CONFIG_DIR`     | Always                                                                  | The `config-dir` input, default `${RUNNER_TEMP}/filemoverexpress`. File Mover Express reads its config from here and writes all of its state here. |
| `AWS_REGION`         | `bucket` is set, a region resolved, and both region variables are unset | The resolved region.                                                                                                                               |
| `AWS_DEFAULT_REGION` | Same as `AWS_REGION`                                                    | The resolved region.                                                                                                                               |

The action exports the region pair only when neither is set, so it never overwrites what configure-aws-credentials or your workflow exported. It never writes credential variables.

> [!NOTE]
> Upstream documentation names the config directory variable `filemoverexpress_CONFIG_DIR`. The CLI actually reads `FME_CONFIG_DIR`.

## Read by the action

| Variable                                           | Used for                                                                                        |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `AWS_REGION`                                       | Region for the transfer profile when `region` is empty.                                         |
| `AWS_DEFAULT_REGION`                               | Region when `region` and `AWS_REGION` are empty.                                                |
| `AWS_PROFILE`                                      | Choosing which profile's `region` to read from the AWS config file when `aws-profile` is empty. |
| `AWS_CONFIG_FILE`                                  | Location of the AWS config file. Default `~/.aws/config`.                                       |
| `AWS_ACCESS_KEY_ID`, `AWS_WEB_IDENTITY_TOKEN_FILE` | Only checked for presence, to add a hint to the error when `validate-credentials` fails.        |
| `RUNNER_TEMP`                                      | Default parent of `config-dir`.                                                                 |
| `RUNNER_TOOL_CACHE`                                | Tool cache root.                                                                                |
| `GITHUB_WORKSPACE`                                 | Base for a relative `filemoverexpress-version-file`.                                            |

## Read by File Mover Express at transfer time

The action doesn't touch these. The CLI's AWS SDK for Go v2 reads them every time a command runs:

| Variable                                                          | Set by                                         | Purpose                                                        |
| ----------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------- |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | configure-aws-credentials (default mode)       | Session credentials.                                           |
| `AWS_PROFILE`                                                     | configure-aws-credentials (`aws-profile` mode) | Named profile, when the transfer profile has no `profile` key. |
| `AWS_SHARED_CREDENTIALS_FILE`, `AWS_CONFIG_FILE`                  | You, optionally                                | Locations of the shared AWS files.                             |
| `AWS_ROLE_ARN`, `AWS_WEB_IDENTITY_TOKEN_FILE`                     | You, optionally                                | Web identity federation.                                       |
| `AWS_ENDPOINT_URL_S3`, `AWS_ENDPOINT_URL`                         | You, optionally                                | Endpoint override when the transfer profile has no `endpoint`. |
| `FME_CONFIG_DIR`                                                  | This action                                    | Config and state directory.                                    |

[Credentials and interop](../explanation/credentials.md) explains the order the SDK checks these in.
