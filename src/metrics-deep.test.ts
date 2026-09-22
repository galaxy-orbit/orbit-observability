import { describe, test, expect } from 'bun:test';
import {
  Counter, Gauge, Histogram, MetricsRegistry,
} from './metrics';

describe('Histogram', () => {
  test('buckets are cumulative and include +Inf', () => {
    const h = new Histogram({
      name: 'obs_req_duration',
      help: 'Request duration',
      buckets: [0.1, 0.5, 1],
    });

    h.observe({}, 0.3);
    h.observe({}, 2);

    const values = h.collect();
    const le = Object.fromEntries(values.map((v) => [v.labels.le, v.value]));
    expect(le['0.1']).toBe(0);
    expect(le['0.5']).toBe(1);
    expect(le['1']).toBe(1);
    expect(le['+Inf']).toBe(2);
  });

  test('sum and count series are tracked', () => {
    const h = new Histogram({ name: 'obs_h', help: 'h' });
    h.observe({}, 1);
    h.observe({}, 3);

    const values = h.collect();
    const sum = values.find((v) => v.labels._type === 'sum');
    const count = values.find((v) => v.labels._type === 'count');
    expect(sum?.value).toBe(4);
    expect(count?.value).toBe(2);
  });

  test('label series are isolated', () => {
    const h = new Histogram({
      name: 'obs_labeled', help: 'h', labels: ['route'],
    });
    h.observe({ route: '/a' }, 0.2);
    h.observe({ route: '/b' }, 5);

    const values = h.collect();
    const aValues = values.filter((v) => v.labels.route === '/a');
    const bValues = values.filter((v) => v.labels.route === '/b');
    expect(aValues.find((v) => v.labels._type === 'sum')?.value).toBe(0.2);
    expect(bValues.find((v) => v.labels._type === 'sum')?.value).toBe(5);
  });

  test('startTimer observes elapsed seconds', async () => {
    const h = new Histogram({ name: 'obs_timer', help: 'h', buckets: [0.001, 1, 10] });
    const stop = h.startTimer();
    await Bun.sleep(30);
    stop();

    const values = h.collect();
    const count = values.find((v) => v.labels._type === 'count')?.value;
    expect(count).toBe(1);
    const sum = values.find((v) => v.labels._type === 'sum')?.value;
    expect(sum).toBeGreaterThanOrEqual(0.02);
  });

  test('reset clears everything', () => {
    const h = new Histogram({ name: 'obs_reset', help: 'h' });
    h.observe({}, 1);
    h.reset();
    expect(h.collect()).toEqual([]);
  });
});

describe('MetricsRegistry — prometheus format', () => {
  test('toPrometheusFormat renders counter/gauge/histogram lines', () => {
    const registry = new MetricsRegistry();
    const hits = registry.createCounter({ name: 'obs_hits_total', help: 'Hits' });
    hits.inc({}, 5);

    const temp = registry.createGauge({ name: 'obs_temp', help: 'Temperature' });
    temp.set({}, 21.5);

    const dur = registry.createHistogram({
      name: 'obs_dur_seconds', help: 'Duration', buckets: [0.5, 1],
    });
    dur.observe({}, 0.3);

    const output = registry.toPrometheusFormat();
    expect(output).toContain('# HELP obs_hits_total Hits');
    expect(output).toContain('# TYPE obs_hits_total counter');
    expect(output).toContain('obs_hits_total 5');
    expect(output).toContain('# TYPE obs_temp gauge');
    expect(output).toContain('obs_temp 21.5');
    expect(output).toContain('# TYPE obs_dur_seconds histogram');
    expect(output).toContain('obs_dur_seconds_bucket');
    expect(output).toContain('obs_dur_seconds_sum');
    expect(output).toContain('obs_dur_seconds_count');
  });

  test('labels render in prometheus format', () => {
    const registry = new MetricsRegistry();
    const c = registry.createCounter({
      name: 'obs_by_route_total', help: 'h', labels: ['route'],
    });
    c.inc({ route: '/users' }, 3);

    const output = registry.toPrometheusFormat();
    expect(output).toContain('route="/users"');
    expect(output).toContain('3');
  });

  test('setDefaultLabels merge into every metric', () => {
    const registry = new MetricsRegistry();
    registry.setDefaultLabels({ app: 'orbit', env: 'test' });
    const c = registry.createCounter({ name: 'obs_defaulted_total', help: 'h' });
    c.inc({}, 1);

    const output = registry.toPrometheusFormat();
    expect(output).toContain('app="orbit"');
    expect(output).toContain('env="test"');
  });

  test('collect aggregates across all registered metrics', () => {
    const registry = new MetricsRegistry();
    registry.createCounter({ name: 'obs_c1_total', help: 'h' }).inc({}, 1);
    registry.createGauge({ name: 'obs_g1', help: 'h' }).set({}, 2);

    const collected = registry.collect();
    expect(collected.size).toBeGreaterThanOrEqual(2);
  });

  test('clear drops all metrics', () => {
    const registry = new MetricsRegistry();
    registry.createCounter({ name: 'obs_clear_total', help: 'h' });
    registry.clear();
    expect(registry.collect().size).toBe(0);
  });
});
