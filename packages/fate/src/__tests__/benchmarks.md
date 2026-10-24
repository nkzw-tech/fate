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
shared or distinct authors, embedded statistics, field aliases, and username-based refetch
locators. The largest workload runs with both 20 shared authors and 2,000 distinct
authors, so improvements must hold when nested entities are unique as well as
repeated. IDs and collection order stay fixed when scalar and embedded values
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

The optimizations index response aliases, normalize connections in one pass,
reuse selection and storage-path metadata within each response, and reduce
temporary coverage allocations. The metadata is scoped to one write rather than
retained globally. These numbers describe this fixture and machine; rerun the
benchmark for an application's actual selections and payloads.

## Response ingestion and retained metadata

A subsequent run on an Apple M5 Max with Node 26.12.1 compares the v1.11.1
runtime with `3456e10`. Both use the same current fixture and dependencies. The
baseline configuration substitutes the tagged runtime source before transformation;
it does not substitute older fixtures. Times are per-operation medians in
milliseconds. Each collection contains 1,000 records.

| Case                                                | 20 authors, v1.11.1 | 20 authors, optimized | 2,000 authors, v1.11.1 | 2,000 authors, optimized |
| --------------------------------------------------- | ------------------: | --------------------: | ---------------------: | -----------------------: |
| GraphQL JSON decoding and selection normalization   |               10.71 |                  7.12 |                  10.02 |                     7.15 |
| Unchanged cache write, excluding transport decoding |               19.70 |                  6.73 |                  17.14 |                     6.62 |
| Native request into a fresh client                  |               30.32 |                 14.09 |                  33.35 |                    14.37 |
| Native unchanged refresh                            |               25.96 |                 12.14 |                  25.49 |                    12.27 |
| Native changed-data refresh                         |               30.33 |                 13.71 |                  34.75 |                    14.16 |
| GraphQL request into a fresh client                 |               36.59 |                 16.09 |                  37.31 |                    16.49 |
| GraphQL unchanged refresh                           |               30.76 |                 14.30 |                  31.42 |                    14.49 |
| GraphQL changed-data refresh                        |               33.64 |                 16.62 |                  34.51 |                    19.00 |

Fresh-client cases include construction; refresh cases reuse the client. These
package benchmarks differ from application benchmarks that exclude construction.
They remain manual and do not add work to the normal test run. Cases where both
versions complete in less than 1 ms are omitted here.

The changes share compiled coverage until a record needs its own mask, compact
single-entry reference indexes, reuse response-local field metadata and list
ownership, and avoid write-history allocations without competing requests. They
retain response isolation, optimistic rebasing, stale-response protection, and
store change notifications. Record-specific coverage is copied before mutation;
normalization metadata is released after each write.

## GraphQL input readers

GraphQL request cases run with both default and custom identity functions. The
default case reads wire fields during cache normalization, avoiding intermediate
entity snapshots. Custom identity functions receive canonical snapshots because
they may inspect nested values. Both paths use the same cache writer, including
coverage, pagination, write ordering, optimistic rebasing, and notifications.

The GraphQL input reader also materializes results for direct transport calls,
mutations, value queries, and live events. Alias mapping, identity decoding, and
connection conversion stay shared between those results and cache ingestion.
Scalar objects and arrays are copied before entering the cache; wire records are
never mutated. Reader metadata belongs to the response rather than the retained
store.

Use the native and custom-identity cases as controls when changing the direct
path. These benchmarks remain separate from the normal test run.
