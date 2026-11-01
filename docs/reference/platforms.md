# Supported platforms

## Runner images

The action is tested on these GitHub-hosted images:

| Runner label       | OS      | Arch  |
| ------------------ | ------- | ----- |
| `ubuntu-latest`    | Linux   | x64   |
| `ubuntu-24.04-arm` | Linux   | arm64 |
| `macos-latest`     | macOS   | arm64 |
| `macos-15-intel`   | macOS   | x64   |
| `windows-latest`   | Windows | x64   |
| `windows-11-arm`   | Windows | arm64 |

Other images and self-hosted runners with the same OS and architecture work too; see [Use self-hosted runners](../how-to/self-hosted-runners.md) for their prerequisites.

## Release assets

Upstream publishes a different kind of artifact per OS. The action only ever extracts the CLI binary:

| Platform      | Release asset                                  | Asset type                           | Extraction                             |
| ------------- | ---------------------------------------------- | ------------------------------------ | -------------------------------------- |
| Linux x64     | `filemoverexpress-linux-amd64`                 | Static ELF binary                    | Copied, mode `755`                     |
| Linux arm64   | `filemoverexpress-linux-arm64`                 | Static ELF binary                    | Copied, mode `755`                     |
| macOS arm64   | `filemoverexpress-macos-arm64.dmg`             | Signed, notarized DMG of the GUI app | Mounted read-only, binary copied out   |
| macOS x64     | `filemoverexpress-macos-x64.dmg`               | Same                                 | Same                                   |
| Windows x64   | `filemoverexpress-windows-amd64-installer.exe` | Authenticode-signed NSIS installer   | Binary extracted with 7-Zip, never run |
| Windows arm64 | `filemoverexpress-windows-arm64-installer.exe` | Same                                 | Same                                   |

## Verification per platform

| Platform | Digest  | Signature check                                                                                                   |
| -------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| Linux    | SHA-256 | None. Upstream doesn't sign Linux builds                                                                          |
| macOS    | SHA-256 | `codesign --verify --strict` on the extracted binary, Team ID `94KV3E626L`, `Developer ID Application` authority  |
| Windows  | SHA-256 | `Get-AuthenticodeSignature` on the installer must be `Valid` with signer organization `Amazon Web Services, Inc.` |

The extracted Windows `filemoverexpress.exe` isn't signed on its own; the signature covers the installer it comes from. [How it works](../explanation/how-it-works.md#_3-check-the-signature) explains why each check runs where it does.

## Architecture

The `architecture` input defaults to the runner's architecture. Override it only to install a binary for a different architecture than the runner, for example an x64 binary on an arm64 macOS runner under Rosetta 2:

```yaml
- uses: lowlysre/setup-filemoverexpress@v1
  with:
    architecture: x64
```
