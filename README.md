# @galaxy-stack/orbit-observability

[![npm version](https://img.shields.io/npm/v/@galaxy-stack/orbit-observability.svg)](https://www.npmjs.com/package/@galaxy-stack/orbit-observability)
[![docs](https://img.shields.io/badge/docs-galaxy--orbit--framework.vercel.app-blue)](https://galaxy-orbit-framework.vercel.app)

Part of the [Orbit framework](https://github.com/galaxy-orbit/orbit) — a NestJS-style backend framework for [Bun](https://bun.sh).

## Installation

```bash
bun add @galaxy-stack/orbit-observability
```

# @galaxy-stack/orbit-observability

Metrics, tracing and structured logging primitives for Orbit services — Prometheus exposition format, OpenTelemetry-style spans.

## Installation

```bash
bun add @galaxy-stack/orbit-observability
```

## Usage

```typescript
import { MetricsRegistry } from './metrics';
import { Tracer } from './tracing';

const registry = new MetricsRegistry();
const hits = registry.createCounter({ name: 'app_hits_total', help: 'Hits' });
const duration = registry.createHistogram({
  name: 'app_duration_seconds',
  help: 'Request duration',
  buckets: [0.1, 0.5, 1, 2.5],
});

hits.inc({ route: '/users' });
duration.observe({ route: '/users' }, 0.12);

// Prometheus exposition
console.log(registry.toPrometheusFormat());
```

## API

- `MetricsRegistry` — counter / gauge / histogram with labels, default labels, Prometheus text format
- `Histogram.startTimer()` — high-resolution duration observation
- `Logger` — leveled structured logging with child contexts and correlation ids

## Notes

- Metric names must be unique per registry; registering the same name with a different type throws.
- Histogram buckets are cumulative; `+Inf` is added automatically.
