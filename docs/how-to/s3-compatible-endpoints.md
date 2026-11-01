# Use S3-compatible endpoints and moto

The `endpoint` input points a transfer profile at any S3-compatible API: [moto](https://github.com/getmoto/moto) for tests, or a store like MinIO, Garage, or Ceph RGW.

## Test a workflow against moto

moto runs a local S3 API on the runner, so pull requests can exercise real uploads and downloads with no AWS account.

```yaml
name: Transfer tests

on: [pull_request]

permissions:
  contents: read

jobs:
  moto:
    runs-on: ubuntu-latest
    env:
      AWS_ACCESS_KEY_ID: testing
      AWS_SECRET_ACCESS_KEY: testing
      AWS_REGION: us-east-1
      S3_ENDPOINT: http://127.0.0.1:5000
    steps:
      - uses: actions/checkout@v7

      - name: Start moto
        shell: bash
        run: |
          pipx install "moto[server]"
          moto_server -H 127.0.0.1 -p 5000 > "$RUNNER_TEMP/moto.log" 2>&1 &
          for _ in $(seq 1 30); do
            curl -sf "$S3_ENDPOINT/moto-api/" > /dev/null && break
            sleep 1
          done
          aws s3api create-bucket --bucket fme-e2e --endpoint-url "$S3_ENDPOINT"

      - uses: lowlysre/setup-filemoverexpress@v1
        with:
          bucket: fme-e2e
          endpoint: ${{ env.S3_ENDPOINT }}
          validate-credentials: true

      - name: Upload
        shell: bash
        run: |
          mkdir -p payload/sub
          echo hello > payload/a.txt
          head -c 5242880 /dev/urandom > payload/sub/big.bin
          filemoverexpress upload default payload --prefix ci/run1 2>&1 | tee fme.log
          if grep -qE $'^(\033\\[[0-9;]*m)*(ERROR|FATAL)' fme.log; then exit 1; fi

      - name: Check the objects landed
        shell: bash
        run: |
          aws s3api list-objects-v2 --bucket fme-e2e --prefix ci/run1/ \
            --endpoint-url "$S3_ENDPOINT" --query 'Contents[].Key' --output text
```

How it fits together:

- The job-level `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are the dummy values moto accepts. File Mover Express reads them through the AWS SDK, the same as it reads credentials from configure-aws-credentials
- `AWS_REGION` gives the transfer profile its region
- The endpoint uses `127.0.0.1`, not `localhost`. See [Addressing style](#addressing-style)
- The objects land at `ci/run1/payload/a.txt` and `ci/run1/payload/sub/big.bin`, because relative upload paths keep their structure

> [!NOTE]
> This recipe uses tools preinstalled on GitHub-hosted Ubuntu runners: `pipx`, `curl`, and the AWS CLI. On other runners, install moto with `pip install "moto[server]"` into a virtual environment and create the bucket with boto3 instead. On macOS, pick a port other than 5000, which the AirPlay receiver can hold.

## Point at another S3-compatible store

```yaml
- uses: lowlysre/setup-filemoverexpress@v1
  with:
    bucket: build-artifacts
    region: garage
    endpoint: https://10.0.12.5
```

Set `region` to whatever the store is configured with; for Garage, that's its `s3_region` setting.

`accelerate` and `endpoint` are mutually exclusive, because Transfer Acceleration only exists on Amazon S3. The action fails if both are set.

## Addressing style

The AWS SDK picks the request style from the endpoint host:

| Endpoint host                                     | Request style  | Bucket goes in | Host and path for bucket `fme-e2e` |
| ------------------------------------------------- | -------------- | -------------- | ---------------------------------- |
| IP address, such as `127.0.0.1`                   | Path-style     | The path       | `127.0.0.1:5000` + `/fme-e2e/key`  |
| DNS name, such as `localhost` or `s3.example.com` | Virtual-hosted | The host name  | `fme-e2e.localhost:5000` + `/key`  |

A store that only supports path-style requests has to be addressed by IP. A store reached by DNS name needs wildcard DNS for `<bucket>.<host>`.

## Use an endpoint environment variable instead

The AWS SDK honors `AWS_ENDPOINT_URL_S3` and `AWS_ENDPOINT_URL` on its own. If you set either and leave `endpoint` empty, the transfer profile has no `endpoint` key and the SDK applies the variable. The `endpoint` input is easier to read in a workflow and only affects the one transfer profile, so prefer it.
