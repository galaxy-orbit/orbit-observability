export interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceFlags: number;
}

export interface SpanOptions {
  name: string;
  kind?: SpanKind;
  attributes?: Record<string, string | number | boolean>;
  parentContext?: SpanContext;
}

export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer';

export interface Span {
  context: SpanContext;
  name: string;
  kind: SpanKind;
  startTime: number;
  endTime?: number;
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
  status: SpanStatus;
  
  setAttribute(key: string, value: string | number | boolean): void;
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): void;
  setStatus(status: SpanStatus): void;
  end(): void;
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface SpanStatus {
  code: 'unset' | 'ok' | 'error';
  message?: string;
}

export interface TracerOptions {
  serviceName: string;
  serviceVersion?: string;
  environment?: string;
  exporter?: SpanExporter;
  sampler?: Sampler;
}

export interface SpanExporter {
  export(spans: Span[]): Promise<void>;
  shutdown(): Promise<void>;
}

export interface Sampler {
  shouldSample(context: SpanContext, name: string): boolean;
}

function generateId(length: number): string {
  const bytes = new Uint8Array(length / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

class SpanImpl implements Span {
  context: SpanContext;
  name: string;
  kind: SpanKind;
  startTime: number;
  endTime?: number;
  attributes: Record<string, string | number | boolean> = {};
  events: SpanEvent[] = [];
  status: SpanStatus = { code: 'unset' };
  
  private tracer: Tracer;
  private ended = false;

  constructor(tracer: Tracer, options: SpanOptions) {
    this.tracer = tracer;
    this.name = options.name;
    this.kind = options.kind || 'internal';
    this.startTime = performance.now();
    
    if (options.attributes) {
      this.attributes = { ...options.attributes };
    }

    const parentContext = options.parentContext;
    
    this.context = {
      traceId: parentContext?.traceId || generateId(32),
      spanId: generateId(16),
      parentSpanId: parentContext?.spanId,
      traceFlags: 1,
    };
  }

  setAttribute(key: string, value: string | number | boolean): void {
    if (!this.ended) {
      this.attributes[key] = value;
    }
  }

  addEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
    if (!this.ended) {
      this.events.push({
        name,
        timestamp: performance.now(),
        attributes,
      });
    }
  }

  setStatus(status: SpanStatus): void {
    if (!this.ended) {
      this.status = status;
    }
  }

  end(): void {
    if (!this.ended) {
      this.ended = true;
      this.endTime = performance.now();
      this.tracer.recordSpan(this);
    }
  }
}

export class Tracer {
  private options: TracerOptions;
  private spans: Span[] = [];
  private activeSpan: Span | null = null;
  private exportInterval: Timer | null = null;

  constructor(options: TracerOptions) {
    this.options = options;
    
    if (options.exporter) {
      this.exportInterval = setInterval(() => {
        this.flush();
      }, 5000);
    }
  }

  startSpan(options: SpanOptions): Span {
    const parentContext = options.parentContext || this.activeSpan?.context;
    
    const shouldSample = this.options.sampler
      ? this.options.sampler.shouldSample(
          parentContext || { traceId: '', spanId: '', traceFlags: 0 },
          options.name
        )
      : true;

    if (!shouldSample) {
      return new NoopSpan();
    }

    const span = new SpanImpl(this, {
      ...options,
      parentContext,
    });

    span.setAttribute('service.name', this.options.serviceName);
    if (this.options.serviceVersion) {
      span.setAttribute('service.version', this.options.serviceVersion);
    }
    if (this.options.environment) {
      span.setAttribute('deployment.environment', this.options.environment);
    }

    return span;
  }

  withSpan<T>(options: SpanOptions, fn: (span: Span) => T): T {
    const span = this.startSpan(options);
    const previousSpan = this.activeSpan;
    this.activeSpan = span;

    try {
      const result = fn(span);
      
      if (result instanceof Promise) {
        return result
          .then((value) => {
            span.setStatus({ code: 'ok' });
            span.end();
            return value;
          })
          .catch((error) => {
            span.setStatus({ code: 'error', message: error.message });
            span.end();
            throw error;
          })
          .finally(() => {
            this.activeSpan = previousSpan;
          }) as T;
      }

      span.setStatus({ code: 'ok' });
      span.end();
      this.activeSpan = previousSpan;
      return result;
    } catch (error: any) {
      span.setStatus({ code: 'error', message: error.message });
      span.end();
      this.activeSpan = previousSpan;
      throw error;
    }
  }

  recordSpan(span: Span): void {
    this.spans.push(span);
  }

  getActiveSpan(): Span | null {
    return this.activeSpan;
  }

  async flush(): Promise<void> {
    if (this.spans.length === 0 || !this.options.exporter) return;

    const spansToExport = [...this.spans];
    this.spans = [];

    await this.options.exporter.export(spansToExport);
  }

  async shutdown(): Promise<void> {
    if (this.exportInterval) {
      clearInterval(this.exportInterval);
    }
    
    await this.flush();
    
    if (this.options.exporter) {
      await this.options.exporter.shutdown();
    }
  }
}

class NoopSpan implements Span {
  context: SpanContext = { traceId: '', spanId: '', traceFlags: 0 };
  name = '';
  kind: SpanKind = 'internal';
  startTime = 0;
  attributes: Record<string, string | number | boolean> = {};
  events: SpanEvent[] = [];
  status: SpanStatus = { code: 'unset' };
  
  setAttribute(): void {}
  addEvent(): void {}
  setStatus(): void {}
  end(): void {}
}

export class ConsoleExporter implements SpanExporter {
  async export(spans: Span[]): Promise<void> {
    for (const span of spans) {
      console.log(JSON.stringify({
        traceId: span.context.traceId,
        spanId: span.context.spanId,
        parentSpanId: span.context.parentSpanId,
        name: span.name,
        kind: span.kind,
        startTime: span.startTime,
        endTime: span.endTime,
        duration: span.endTime ? span.endTime - span.startTime : 0,
        attributes: span.attributes,
        events: span.events,
        status: span.status,
      }));
    }
  }

  async shutdown(): Promise<void> {}
}

export class BatchExporter implements SpanExporter {
  private endpoint: string;
  private headers: Record<string, string>;
  private batch: Span[] = [];
  private batchSize: number;

  constructor(options: {
    endpoint: string;
    headers?: Record<string, string>;
    batchSize?: number;
  }) {
    this.endpoint = options.endpoint;
    this.headers = options.headers || {};
    this.batchSize = options.batchSize || 100;
  }

  async export(spans: Span[]): Promise<void> {
    this.batch.push(...spans);

    if (this.batch.length >= this.batchSize) {
      await this.sendBatch();
    }
  }

  private async sendBatch(): Promise<void> {
    if (this.batch.length === 0) return;

    const spansToSend = this.batch.splice(0, this.batchSize);

    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify({ spans: spansToSend }),
      });
    } catch (error) {
      console.error('Failed to export spans:', error);
      this.batch.unshift(...spansToSend);
    }
  }

  async shutdown(): Promise<void> {
    await this.sendBatch();
  }
}

export class AlwaysSampler implements Sampler {
  shouldSample(): boolean {
    return true;
  }
}

export class RatioSampler implements Sampler {
  constructor(private ratio: number) {
    if (ratio < 0 || ratio > 1) {
      throw new Error('Sampling ratio must be between 0 and 1');
    }
  }

  shouldSample(): boolean {
    return Math.random() < this.ratio;
  }
}

let globalTracer: Tracer | null = null;

export function initTracer(options: TracerOptions): Tracer {
  globalTracer = new Tracer(options);
  return globalTracer;
}

export function getTracer(): Tracer {
  if (!globalTracer) {
    throw new Error('Tracer not initialized. Call initTracer() first.');
  }
  return globalTracer;
}

export function trace<T>(name: string, fn: (span: Span) => T): T {
  return getTracer().withSpan({ name }, fn);
}
