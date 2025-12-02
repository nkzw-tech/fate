# Core Concepts

**_fate_** has a minimal API surface and is aimed at reducing data fetching complexity.

## Thinking in Views

In fate, each component declares the data it needs using views. Views are composed upward through the component tree until they reach a root, where the actual request is made. fate fetches all required data in a single request. React Suspense manages loading states, and any data-fetching errors naturally bubble up to React error boundaries. This eliminates the need for imperative loading logic or manual error handling.

Traditionally, React apps are built with components and hooks. fate introduces a third primitive: views – a declarative way for components to express their data requirements. An app built with fate looks more like this:

<p align="center">
  <picture class="fate-tree">
    <source media="(prefers-color-scheme: dark)" srcset="/public/fate-tree-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="/public/fate-tree.svg">
    <img alt="Tree" src="/public/fate-tree.svg" width="90%">
  </picture>
</p>

With fate, you no longer worry about _when_ to fetch data, how to coordinate loading states, or how to handle errors imperatively. You avoid overfetching, stop passing unnecessary data down the tree, and eliminate boilerplate types created solely for passing server data to child components.

> [!NOTE]
> Views in _fate_ are what fragments are in GraphQL.
