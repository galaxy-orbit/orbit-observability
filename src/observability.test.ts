import { describe, test, expect } from 'bun:test';
import { Tracer, type Span, type SpanExporter, type SpanStatus } from './tracing';
import { MetricsRegistry as ObsMetricsRegistry } from './metrics';

class MemoryExporter implements SpanExporter {
  spans: Span[] = [];
  async export(spans: Span[]) { this.spans.push(...spans); }
  async shutdown() {}
}

describe('Tracer', () => {
  test('spans carry service attributes and parent linkage', () => {
    const tracer = new Tracer({ serviceName: 'orbit-api', serviceVersion: '0.1.1', environment: 'test' });
    const parent = tracer.startSpan({ name: 'parent', kind: 'server' });
    const child = tracer.startSpan({ name: 'child', kind: 'internal', parentContext: parent.context });

    expect(parent.context.traceId).toMatch(/^[0-9a-f]+$/);
    expect(child.context.traceId).toBe(parent.context.traceId);
    expect(child.context.parentSpanId).toBe(parent.context.spanId);
    expect(parent.attributes['service.name']).toBe('orbit-api');
    expect(parent.attributes['service.version']).toBe('0.1.1');
    expect(parent.attributes['deployment.environment']).toBe('test');
  });

  test('span lifecycle: attributes, events, status, end', () => {
    const tracer = new Tracer({ serviceName: 'svc' });
    const span = tracer.startSpan({ name: 'op', attributes: { userId: 42 } });

    span.setAttribute('user.email', 'a@b.c');
    span.addEvent('cache.miss', { key: 'user:42' });
    span.setStatus({ code: 'ok' });
    span.end();

    expect(span.attributes['user.email']).toBe('a@b.c');
    expect(span.events).toHaveLength(1);
    expect(span.events[0].name).toBe('cache.miss');
    expect(span.status.code).toBe('ok');
    expect(span.endTime).toBeGreaterThanOrEqual(span.startTime);
  });

  test('exporter receives ended spans only', async () => {
    const captured: Span[] = [];
    const exporter: SpanExporter = {
      async export(spans: Span[]) { captured.push(...spans); },
      async shutdown() {},
    };
    const tracer = new Tracer({ serviceName: 'svc', exporter });

    const s1 = tracer.startSpan({ name: 'ended' });
    s1.end();
    const s2 = tracer.startSpan({ name: 'still-open' });

    await tracer.flush!();
    expect(captured.some(s => s.name === 'ended')).toBe(true);
    expect(captured.some(s => s.name === 'still-open')).toBe(false);
  });

  test('withSpan wraps execution and ends the span', () => {
    const tracer = new Tracer({ serviceName: 'svc' });
    const result = tracer.withSpan({ name: 'wrapped' }, (span) => {
      span.setAttribute('inside', true);
      return 7;
    });
    expect(result).toBe(7);
  });

  test('sampler decides whether spans are recorded', () => {
    const tracer = new Tracer({
      serviceName: 'svc',
      sampler: { shouldSample: () => false },
    });
    const span = tracer.startSpan({ name: 'sampled-out' });
    // unsampled spans become no-ops
    expect(span.setAttribute).toBeDefined();
    expect(() => { span.end(); }).not.toThrow();
  });
});

describe('Observability MetricsRegistry', () => {
  test('Counter collect returns values with labels and timestamp', () => {
    const registry = new ObsMetricsRegistry();
    const counter = registry.createCounter?.({ name: 'requests', help: 'Requests', labels: ['method'] })
      ?? new (require('./metrics').Counter)({ name: 'requests', help: 'Requests', labels: ['method'] });
    counter.inc({ method: 'GET' });
    counter.inc({ method: 'GET' }, 2);
    const collected = counter.collect();
    expect(collected).toHaveLength(1);
    expect(collected[0].value).toBe(3);
    expect(collected[0].labels.method).toBe('GET');
    expect(collected[0].timestamp).toBeGreaterThan(0);
  });

  test('Counter reset clears values', () => {
    const registry = new ObsMetricsRegistry();
    const counter = registry.createCounter?.({ name: 'events', help: 'Events', labels: [] })
      ?? new (require('./metrics').Counter)({ name: 'events', help: 'Events' });
    counter.inc(undefined, 5);
    counter.reset();
    expect(counter.collect()).toHaveLength(0);
  });

  test('Gauge supports set and direction', () => {
    const registry = new ObsMetricsRegistry();
    const gauge = registry.createGauge?.({ name: 'depth', help: 'Depth', labels: [] })
      ?? new (require('./metrics').Gauge)({ name: 'depth', help: 'Depth', labels: [] });
    gauge.set({  } as any, 10);
    gauge.inc(undefined, 5);
    gauge.dec(undefined, 2);
    const values = gauge.collect();
    expect(values[0].value).toBe(13);
  });
});
