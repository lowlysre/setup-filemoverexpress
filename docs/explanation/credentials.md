# Credentials and interop

Setup File Mover Express sits next to [aws-actions/configure-aws-credentials](https://github.com/aws-actions/configure-aws-credentials) without either action knowing about the other. They meet through the standard AWS environment variables and shared files, which every AWS SDK and the AWS CLI already agree on.

## Division of labor

| Concern                                       | configure-aws-credentials | Setup File Mover Express | File Mover Express CLI             |
| --------------------------------------------- | ------------------------- | ------------------------ | ---------------------------------- |
| Get credentials (OIDC, keys, role chaining)   | Yes                       | No                       | No                                 |
| Export credential variables or write `~/.aws` | Yes                       | No                       | No                                 |
| Export `AWS_REGION` and `AWS_DEFAULT_REGION`  | Yes, in env mode          | Only if both are unset   | No                                 |
| Install the CLI                               | No                        | Yes                      | No                                 |
| Write the transfer profile                    | No                        | Yes                      | Rewrites with defaults             |
| Load credentials at transfer time             | No                        | No                       | Yes, through the AWS SDK for Go v2 |

The action deliberately stays out of credentials. Every credential source configure-aws-credentials supports keeps working without the action needing to understand it, and the action has nothing to leak.

## How the CLI finds credentials

File Mover Express loads its AWS config with the transfer profile's `region` and, when present, its `profile`. The AWS SDK for Go v2 then resolves credentials in this order:

1. If the transfer profile names a `profile` (the action writes one only when you set `aws-profile`), that profile from the shared files. This beats credential variables
2. Otherwise, static credentials from `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN`. This is what configure-aws-credentials exports by default
3. Web identity from `AWS_ROLE_ARN` and `AWS_WEB_IDENTITY_TOKEN_FILE`
4. The profile named by `AWS_PROFILE`, or `default`, from `~/.aws/credentials` and `~/.aws/config` (or `AWS_SHARED_CREDENTIALS_FILE` and `AWS_CONFIG_FILE`). This is what configure-aws-credentials writes in `aws-profile` mode
5. Container credentials, then the EC2 instance metadata service. These matter on self-hosted runners in ECS or on EC2

Without an explicit `aws-profile`, this is the order the AWS CLI uses, so a workflow that works with `aws s3 cp` works with `filemoverexpress upload` under the same environment.

## How the action finds the region

The region is the one thing the action needs before any transfer, because it goes into the transfer profile. It checks, in order:

1. The `region` input
2. `AWS_REGION`
3. `AWS_DEFAULT_REGION`
4. `region` in the effective profile's section of `$AWS_CONFIG_FILE` (default `~/.aws/config`). The effective profile is `aws-profile`, then `AWS_PROFILE`, then `default`; the section is `[default]` or `[profile NAME]`

This matches how the AWS CLI picks a region, so the transfer profile ends up in the region configure-aws-credentials was given. If nothing resolves, the action fails instead of writing a profile without a region, because File Mover Express quietly falls back to `us-east-2`, and a wrong-region bucket shows up later as a confusing transfer error.

## Writing the region back

When the action resolves a region and neither `AWS_REGION` nor `AWS_DEFAULT_REGION` is set, it exports both, the same pair configure-aws-credentials exports. Later steps that call the AWS CLI then agree with the transfer profile. It never overwrites either variable, so a value from configure-aws-credentials or your workflow always wins.

One side effect: after the first call exports `AWS_REGION`, a second call without a `region` input picks up that value before it looks at `~/.aws/config`. When transfer profiles in one job use different regions, set `region` on each call.

## Ordering

Installing the CLI and writing the transfer profile need neither credentials nor network access to AWS. Order only matters for `validate-credentials: true` and for a missing `region` input, and running configure-aws-credentials first is the simplest rule. The [step order table](../how-to/aws-credentials.md#step-order) lists each case.

## Expiry

configure-aws-credentials exports static session credentials and its post step clears them at the end of the job. The SDK can't refresh static credentials, so a transfer that outlasts the session fails partway through. [Run transfers longer than an hour](../how-to/aws-credentials.md#run-transfers-longer-than-an-hour) covers `role-duration-seconds` and its limits.
