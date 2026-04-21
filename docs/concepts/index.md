---
hide:
  - navigation
---

# Concepts

The small vocabulary `cds-data-pipeline` is built on. These pages cover the engine itself — the primitives behind `addPipeline(...)`, the inference rules, and the event namespace every pipeline exposes.

<div class="grid cards" markdown>

-   :material-book-alphabet: **Terminology**

    ---

    Pipeline, source, target, mode, delta strategy, tracker, event namespace. The primitives every pipeline registration composes.

    [:octicons-arrow-right-24: Terminology](terminology.md)

-   :material-sitemap: **Inference rules**

    ---

    How `addPipeline(...)` derives pipeline behavior from the config shape — read shape, write primitive, inferred defaults — and the registration-time validation matrix.

    [:octicons-arrow-right-24: Inference rules](inference.md)

-   :material-view-grid-plus: **Consumption views**

    ---

    The idiomatic CAP pattern for shaping a replicate target — a `projection on <remote.Entity>` that declares target schema, column restriction, and rename mapping in one place.

    [:octicons-arrow-right-24: Consumption views](consumption-views.md)

</div>
