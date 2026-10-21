# Client ingestion benchmarks

Run the ingestion cases separately from the normal test suite:

```sh
vp test bench ingestion --run
```

To save individual samples and latency distributions:

```sh
vp test bench ingestion --run --reporter=json --outputFile=/tmp/ingestion.json
```

The fixture contains two paginated project collections with 20, 100, or 1,000
records each. Projects include varied serialized document state, scalar arrays,
shared authors, embedded statistics, field aliases, and username-based refetch
locators. IDs and collection order stay fixed when scalar and embedded values
change. Responses are precomputed; no real server, database, or network is involved.

The cases separate:

- GraphQL JSON decoding and response normalization, without cache ingestion.
- Cache ingestion of an unchanged snapshot, without transport decoding.
- Complete requests into fresh clients, including client construction.
- Unchanged and changed-data refreshes through native and GraphQL transports.
- Cached reads of the parent view and all project views.

Both transport variants decode JSON rather than returning a shared in-memory
object. The direct-write case intentionally reuses a decoded snapshot to isolate
normalization. Cached project views are warmed before measurement. Benchmarks use
stable, parameter-bound views and validate real selections, arguments, aliases,
and refetch configuration.

Run comparisons with the same Node version and idle machine, without concurrent
builds or tests. Compare distributions and repeated runs, not single timings.
The 1,000-record collections stress scaling beyond a typical page; they are not a
recommendation to fetch thousands of records at once. No result here measures
browser rendering, network latency, or backend query performance.

## Normalization optimization measurements

An idle-machine run on an Apple M5 Max with Node 24.22.1 compared the fixture at
`629c3b2` with `f8e8733`. Times below are per-operation medians, in milliseconds,
for 1,000 projects and 1,000 templates:

| Case                                                | Before | After |
| --------------------------------------------------- | -----: | ----: |
| GraphQL JSON decoding and selection normalization   |  21.68 | 10.70 |
| Unchanged cache write, excluding transport decoding |  40.34 | 22.76 |
| Native request into a fresh client                  |  44.89 | 27.06 |
| Native unchanged refresh                            |  46.65 | 29.43 |
| Native changed-data refresh                         |  47.14 | 30.24 |
| GraphQL request into a fresh client                 |  64.12 | 34.96 |
| GraphQL unchanged refresh                           |  66.23 | 37.49 |
| GraphQL changed-data refresh                        |  66.36 | 37.97 |
| Cached reads of all project views                   |   1.08 |  1.06 |

The 20-record cases also improved: a fresh GraphQL request went from 1.31 ms to
0.78 ms and a fresh native request from 0.90 ms to 0.59 ms. Cached parent reads
remained about 0.0005 ms; these changes target ingestion, not cached read speed.

The optimizations index response aliases, normalize connections in one pass,
reuse selection and storage-path metadata within each response, and reduce
temporary coverage allocations. The metadata is scoped to one write rather than
retained globally. These numbers describe this fixture and machine; rerun the
benchmark for an application's actual selections and payloads.
