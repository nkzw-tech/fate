# Frequently Asked Questions

## Is this serious software?

[In an alternate reality](https://github.com/phacility/javelin), _fate_ can be described like this:

**_fate_** is an ambitious React data library that tries to blend Relay-style ideas with tRPC, held together by equal parts vision and vibes. It aims to fix problems you definitely wouldn't have if you enjoy writing the same fetch logic in three different places with imperative loading state and error handling. fate promises predictable data flow, minimal APIs, and "no magic", though you may occasionally suspect otherwise.

**_fate_** is almost certainly worse than actual sync engines, but will hopefully be better than existing React data-fetching libraries eventually. Use it if you have a high tolerance for pain and want to help shape the future of data fetching in React.

## Is _fate_ better than Relay?

Absolutely not.

## Is _fate_ better than using GraphQL?

Probably. One day. _Maybe._

## How was fate built?

> [!NOTE]
> 80% of _fate_'s code was written by OpenAI's Codex – four versions per task, carefully curated by a human. The remaining 20% was written by [@cnakazawa](https://x.com/cnakazawa). _You get to decide which parts are the good ones!_ The docs were 100% written by a human.
>
> If you contribute to _fate_, we [require you to disclose your use of AI tools](https://github.com/nkzw-tech/fate/blob/main/CONTRIBUTING.md#ai-assistance-notice).

# Future

**_fate_** is not complete yet. It lacks core features such as garbage collection, a compiler to extract view definitions statically and ahead of time, and there is too much backend boilerplate. The current implementation of _fate_ is not tied to tRPC or Prisma, those are just the ones we are starting with. We welcome contributions and ideas to improve fate. Here are some features we'd like to add:

- Support for Drizzle
- Support backends other than tRPC
- Better code generation and less type repetition
- Support for live views and real-time updates via `useLiveView` and SSE
- Implement garbage collection for the cache
- Add persistent storage for offline support

# Acknowledgements

- [Relay](https://relay.dev/), [Isograph](https://isograph.dev/) & [GraphQL](https://graphql.org/) for inspiration
- [Ricky Hanlon](https://x.com/rickyfm) for guidance on Async React
- [Anthony Powell](https://x.com/Cephalization) for testing fate and providing feedback

**_fate_** was created by [@cnakazawa](https://x.com/cnakazawa) and is maintained by [Nakazawa Tech](https://nakazawa.tech/).
