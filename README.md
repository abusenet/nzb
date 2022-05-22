# nzb

Collection of tools handling NZB files

## Usage

Each commands can be run under Deno with `deno run -A mod.ts command args`, or
using the pre-built binaries for each platforms in Releases.

## Commands

- [x] `nzb mirror`: Mirrors articles in a NZB file with new information
- [ ] `nzb get`: Downloads data specified in a NZB file.
- [ ] `nzb extract`: Extracts files in a NZB file into new NZB files.
- [ ] `nzb merge`: Merges multiple NZB files into one.
- [ ] `nzb serve`: Serves a NZB file as an index webpage.
- [ ] `nzb stream`: Streams data specified in a NZB file.

## `nzb-mirror`

Mirrors the articles in the source NZB, either to the same group or new ones,
and outputs the resulting NZB to stdout or a specified output file.

```shell
nzb mirror \
  --hostname=localhost \
  --port=119 \
  --username= \
  --password= \
  --connections=3 \ # Number of connections
  --connect-retries=1 \ # Number of times to retry to connect.
  --reconnect-delay=15*1000 \ # Microseconds to wait before reconnecting.
  --request-retries=5 \ # Number of times to retry to post if failed.
  --post-retry-delay=0 \ # Microseconds to wait before retrying posting.
  --from="poster@example.com" \ # Name of poster
  --groups=alt.binaries.test \ # Groups to post new articles to, separated by commas.
  --date \ # Specific date for each article. Can take a "now" to refer script's start time.
  source.nzb \ # Source file to mirror from.
  --out=mirror.nzb # Path to a file to write new NZB to.
```

## `nzb-serve`

Serves the files specified in an input NZB file as a directory listing.

```shell
nzb serve \
  --hostname=0.0.0.0 \
  --port=8000 \
  source.nzb \ # Source NZB file to serve.
```
