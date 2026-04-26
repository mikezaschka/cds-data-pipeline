---
layout: home
title: Home
titleTemplate: false
sidebar: false
aside: false
outline: false
lastUpdated: false

hero:
  name: cds-data-pipeline
  tagline: A SAP CAP plugin to move data between services.
  actions:
    - theme: brand
      text: Introduction
      link: /guide/introduction
    - theme: alt
      text: Get started
      link: /guide/get-started
    - theme: alt
      text: Reference
      link: /reference/features

features:
  - icon: ℹ️
    title: What, why, scope
    details: How the plugin fits CAP, why it exists, and what it is not.
    link: /guide/introduction
    linkText: Read introduction
  - icon: 🚀
    title: Get started
    details: Northwind walkthrough — consumption view, your first pipeline, and the monitor.
    link: /guide/get-started
    linkText: Open guide
  - icon: 📐
    title: Concepts
    details: Terminology, inference rules, consumption views, and change history vs pipelines.
    link: /guide/concepts/
  - icon: 📥
    title: Sources
    details: OData V2 / V4, REST, CQN, and pluggable custom adapters.
    link: /guide/sources/
  - icon: 📤
    title: Targets
    details: Local DB, remote OData, and custom write paths.
    link: /guide/targets/
  - icon: 🧑‍🍳
    title: Recipes
    details: Replicate, materialize, multi-source fan-in, hooks, and scheduling.
    link: /guide/recipes/
  - icon: ✨
    title: Feature catalog
    details: Adapters, observability, delta modes, and resilience in one place.
    link: /reference/features
  - icon: 📡
    title: Management service
    details: Pipelines, runs, execute, flush, status, and the hook API — full reference.
    link: /reference/management-service
  - icon: ↪️
    title: Event hooks
    details: before / on / after for every phase from START through DONE.
    link: /guide/recipes/event-hooks
---

New here? Read **[Introduction](/guide/introduction)** (what, why, and scope) before the hands-on walkthrough.
