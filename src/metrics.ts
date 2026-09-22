export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

export interface MetricOptions {
  name: string;
  help: string;
  labels?: string[];
}

export interface MetricValue {
  value: number;
  labels: Record<string, string>;
  timestamp: number;
}

export interface Metric {
  readonly name: string;
  readonly help: string;
  readonly type: MetricType;
  readonly labels: string[];
  
  collect(): MetricValue[];
  reset(): void;
}

export class Counter implements Metric {
  readonly type: MetricType = 'counter';
  readonly name: string;
  readonly help: string;
  readonly labels: string[];
  
  private values: Map<string, number> = new Map();

  constructor(options: MetricOptions) {
    this.name = options.name;
    this.help = options.help;
    this.labels = options.labels || [];
  }

  inc(labels: Record<string, string> = {}, value = 1): void {
    const key = this.labelsToKey(labels);
    this.values.set(key, (this.values.get(key) || 0) + value);
  }

  collect(): MetricValue[] {
    const results: MetricValue[] = [];
    const timestamp = Date.now();
    
    for (const [key, value] of this.values) {
      results.push({
        value,
        labels: this.keyToLabels(key),
        timestamp,
      });
    }
    
    return results;
  }

  reset(): void {
    this.values.clear();
  }

  private labelsToKey(labels: Record<string, string>): string {
    return this.labels.map((l) => labels[l] || '').join('|');
  }

  private keyToLabels(key: string): Record<string, string> {
    const values = key.split('|');
    const result: Record<string, string> = {};
    this.labels.forEach((l, i) => {
      result[l] = values[i] || '';
    });
    return result;
  }
}

export class Gauge implements Metric {
  readonly type: MetricType = 'gauge';
  readonly name: string;
  readonly help: string;
  readonly labels: string[];
  
  private values: Map<string, number> = new Map();

  constructor(options: MetricOptions) {
    this.name = options.name;
    this.help = options.help;
    this.labels = options.labels || [];
  }

  set(labels: Record<string, string>, value: number): void {
    const key = this.labelsToKey(labels);
    this.values.set(key, value);
  }

  inc(labels: Record<string, string> = {}, value = 1): void {
    const key = this.labelsToKey(labels);
    this.values.set(key, (this.values.get(key) || 0) + value);
  }

  dec(labels: Record<string, string> = {}, value = 1): void {
    const key = this.labelsToKey(labels);
    this.values.set(key, (this.values.get(key) || 0) - value);
  }

  collect(): MetricValue[] {
    const results: MetricValue[] = [];
    const timestamp = Date.now();
    
    for (const [key, value] of this.values) {
      results.push({
        value,
        labels: this.keyToLabels(key),
        timestamp,
      });
    }
    
    return results;
  }

  reset(): void {
    this.values.clear();
  }

  private labelsToKey(labels: Record<string, string>): string {
    return this.labels.map((l) => labels[l] || '').join('|');
  }

  private keyToLabels(key: string): Record<string, string> {
    const values = key.split('|');
    const result: Record<string, string> = {};
    this.labels.forEach((l, i) => {
      result[l] = values[i] || '';
    });
    return result;
  }
}

export interface HistogramOptions extends MetricOptions {
  buckets?: number[];
}

export class Histogram implements Metric {
  readonly type: MetricType = 'histogram';
  readonly name: string;
  readonly help: string;
  readonly labels: string[];
  readonly buckets: number[];
  
  private counts: Map<string, Map<number, number>> = new Map();
  private sums: Map<string, number> = new Map();
  private totalCounts: Map<string, number> = new Map();

  constructor(options: HistogramOptions) {
    this.name = options.name;
    this.help = options.help;
    this.labels = options.labels || [];
    this.buckets = options.buckets || [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
  }

  observe(labels: Record<string, string>, value: number): void {
    const key = this.labelsToKey(labels);
    
    if (!this.counts.has(key)) {
      this.counts.set(key, new Map());
    }
    
    const bucketCounts = this.counts.get(key)!;
    
    for (const bucket of this.buckets) {
      if (value <= bucket) {
        bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1);
      }
    }
    bucketCounts.set(Infinity, (bucketCounts.get(Infinity) || 0) + 1);
    
    this.sums.set(key, (this.sums.get(key) || 0) + value);
    this.totalCounts.set(key, (this.totalCounts.get(key) || 0) + 1);
  }

  startTimer(labels: Record<string, string> = {}): () => void {
    const start = performance.now();
    return () => {
      const duration = (performance.now() - start) / 1000;
      this.observe(labels, duration);
    };
  }

  collect(): MetricValue[] {
    const results: MetricValue[] = [];
    const timestamp = Date.now();
    
    for (const [key, bucketCounts] of this.counts) {
      const labels = this.keyToLabels(key);
      
      for (const bucket of [...this.buckets, Infinity]) {
        results.push({
          value: bucketCounts.get(bucket) || 0,
          labels: { ...labels, le: bucket === Infinity ? '+Inf' : String(bucket) },
          timestamp,
        });
      }
      
      results.push({
        value: this.sums.get(key) || 0,
        labels: { ...labels, _type: 'sum' },
        timestamp,
      });
      
      results.push({
        value: this.totalCounts.get(key) || 0,
        labels: { ...labels, _type: 'count' },
        timestamp,
      });
    }
    
    return results;
  }

  reset(): void {
    this.counts.clear();
    this.sums.clear();
    this.totalCounts.clear();
  }

  private labelsToKey(labels: Record<string, string>): string {
    return this.labels.map((l) => labels[l] || '').join('|');
  }

  private keyToLabels(key: string): Record<string, string> {
    const values = key.split('|');
    const result: Record<string, string> = {};
    this.labels.forEach((l, i) => {
      result[l] = values[i] || '';
    });
    return result;
  }
}

export class MetricsRegistry {
  private metrics: Map<string, Metric> = new Map();
  private defaultLabels: Record<string, string> = {};

  setDefaultLabels(labels: Record<string, string>): void {
    this.defaultLabels = labels;
  }

  register(metric: Metric): void {
    if (this.metrics.has(metric.name)) {
      throw new Error(`Metric ${metric.name} already registered`);
    }
    this.metrics.set(metric.name, metric);
  }

  get<T extends Metric>(name: string): T | undefined {
    return this.metrics.get(name) as T | undefined;
  }

  createCounter(options: MetricOptions): Counter {
    const counter = new Counter(options);
    this.register(counter);
    return counter;
  }

  createGauge(options: MetricOptions): Gauge {
    const gauge = new Gauge(options);
    this.register(gauge);
    return gauge;
  }

  createHistogram(options: HistogramOptions): Histogram {
    const histogram = new Histogram(options);
    this.register(histogram);
    return histogram;
  }

  collect(): Map<string, MetricValue[]> {
    const result = new Map<string, MetricValue[]>();
    
    for (const [name, metric] of this.metrics) {
      result.set(name, metric.collect());
    }
    
    return result;
  }

  toPrometheusFormat(): string {
    const lines: string[] = [];
    
    for (const [name, metric] of this.metrics) {
      lines.push(`# HELP ${name} ${metric.help}`);
      lines.push(`# TYPE ${name} ${metric.type}`);
      
      const values = metric.collect();
      
      for (const value of values) {
        const allLabels = { ...this.defaultLabels, ...value.labels };
        const labelsStr = Object.entries(allLabels)
          .filter(([k]) => !k.startsWith('_'))
          .map(([k, v]) => `${k}="${v}"`)
          .join(',');
        
        let metricName = name;
        if (metric.type === 'histogram') {
          if (value.labels._type === 'sum') {
            metricName = `${name}_sum`;
          } else if (value.labels._type === 'count') {
            metricName = `${name}_count`;
          } else {
            metricName = `${name}_bucket`;
          }
        }
        
        if (labelsStr) {
          lines.push(`${metricName}{${labelsStr}} ${value.value}`);
        } else {
          lines.push(`${metricName} ${value.value}`);
        }
      }
      
      lines.push('');
    }
    
    return lines.join('\n');
  }

  reset(): void {
    for (const metric of this.metrics.values()) {
      metric.reset();
    }
  }

  clear(): void {
    this.metrics.clear();
  }
}

export const globalRegistry = new MetricsRegistry();

export const httpRequestsTotal = globalRegistry.createCounter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labels: ['method', 'path', 'status'],
});

export const httpRequestDuration = globalRegistry.createHistogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labels: ['method', 'path'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
});

export const activeConnections = globalRegistry.createGauge({
  name: 'http_active_connections',
  help: 'Number of active HTTP connections',
});

export function metricsMiddleware() {
  return async (request: Request, next: () => Promise<Response>): Promise<Response> => {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;
    
    activeConnections.inc();
    const endTimer = httpRequestDuration.startTimer({ method, path });
    
    try {
      const response = await next();
      
      httpRequestsTotal.inc({ method, path, status: String(response.status) });
      endTimer();
      activeConnections.dec();
      
      return response;
    } catch (error) {
      httpRequestsTotal.inc({ method, path, status: '500' });
      endTimer();
      activeConnections.dec();
      throw error;
    }
  };
}

export function createMetricsEndpoint(registry: MetricsRegistry = globalRegistry) {
  return async (): Promise<Response> => {
    return new Response(registry.toPrometheusFormat(), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  };
}
