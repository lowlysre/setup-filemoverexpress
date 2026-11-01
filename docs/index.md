---
layout: home

hero:
  name: Setup File Mover Express
  text: S3 transfers in GitHub Actions
  tagline: Set up AWS Labs' File Mover Express CLI with this independent action.
  image:
    src: /logo.svg
    alt: Setup File Mover Express logo
  actions:
    - theme: brand
      text: Your first upload
      link: /tutorials/first-upload
    - theme: alt
      text: Action inputs
      link: /reference/inputs
    - theme: alt
      text: CLI behavior in CI
      link: /reference/cli

features:
  - title: Setup action
    details: Installs and verifies the CLI, adds it to PATH, and can write an S3 transfer profile that uses credentials from aws-actions/configure-aws-credentials.
    link: /reference/inputs
    linkText: Action inputs and outputs
  - title: File Mover Express CLI
    details: Runs transfer commands in workflow steps, including upload, download, and inventory.
    link: /reference/cli
    linkText: CLI behavior in CI
  - title: Transfer errors
    details: The CLI can exit 0 when a file fails to transfer. Check its output if the workflow must fail on transfer errors.
    link: /how-to/fail-on-errors
    linkText: Fail the job on transfer errors
---

Setup AWS Labs' [File Mover Express](https://github.com/awslabs/filemoverexpress) in GitHub Actions with an independently maintained setup action. This project is not affiliated with or endorsed by AWS.

## What runs where

| Workflow step          | Example                                       | Responsibility                                                                              |
| ---------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Setup action           | `uses: lowlysre/setup-filemoverexpress@v1`    | Installs and verifies the CLI, adds it to `PATH`, and optionally writes a transfer profile. |
| File Mover Express CLI | `run: filemoverexpress upload default ./dist` | Transfers files using the selected profile and the AWS credentials available to the job.    |

The setup action does not perform uploads or downloads. Add separate `run` steps for CLI commands after setup.

## Quick start

This example assumes the repository has an AWS role configured for GitHub's OIDC provider and a build directory named `dist`. The [first-upload tutorial](/tutorials/first-upload) covers the trust policy and bucket permissions.

```yaml
name: Upload build output

on:
  push:
    branches: [main]

permissions:
  contents: read
  id-token: write

jobs:
  upload:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: us-east-1

      - name: Set up File Mover Express
        uses: lowlysre/setup-filemoverexpress@v1
        with:
          bucket: my-build-bucket
          validate-credentials: true

      - name: Upload build output
        shell: bash
        run: |
          filemoverexpress upload default ./dist 2>&1 | tee fme.log
          if grep -qE '^(ERROR|FATAL)' fme.log; then
            echo "::error::File Mover Express reported transfer errors"
            exit 1
          fi
```

The credentials action provides AWS credentials and `AWS_REGION`. The setup action writes the `default` transfer profile and checks that it can list the bucket. Pin third-party actions to full commit SHAs in production workflows.

## Common inputs

| Input                      | Purpose                                                                           |
| -------------------------- | --------------------------------------------------------------------------------- |
| `filemoverexpress-version` | Install a release, version, or semver range.                                      |
| `bucket`                   | Write a transfer profile for an S3 bucket.                                        |
| `region`                   | Set the bucket region, or use the AWS region from the environment or config file. |
| `transfer-profile`         | Name the profile to write and use with CLI commands.                              |
| `validate-credentials`     | Check the selected profile before the job continues.                              |

See the [complete input and output reference](/reference/inputs).

## Documentation

- [Your first upload](/tutorials/first-upload) walks through AWS OIDC setup, IAM permissions, and a complete workflow.
- [How-to guides](/how-to/aws-credentials) cover credentials, profiles, S3-compatible endpoints, transfer errors, throughput, versions, and runners.
- [Reference](/reference/inputs) lists action inputs, outputs, environment variables, supported platforms, and CLI behavior in CI.
- [Explanations](/explanation/how-it-works) cover verification, credentials, caching, and CLI exit behavior.
