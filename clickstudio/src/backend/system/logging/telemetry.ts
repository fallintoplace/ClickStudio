import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { RequestHandler } from 'express';
export async function startTelemetry(url?: string) {
    if (!url) return async () => {};
    const sdk = new NodeSDK({
        resource: resourceFromAttributes({ 'service.name': 'clickstudio' }),
        traceExporter: new OTLPTraceExporter({ url }),
    });
    sdk.start();
    return () => sdk.shutdown();
}
/**
 * Manual spans carry identifiers and timings, never SQL, result rows, prompts, cookies or raw URLs.
 */
export const telemetry: RequestHandler = (req, res, next) => {
    const span = trace.getTracer('clickstudio').startSpan('workspace.request');
    span.setAttribute('http.request.method', req.method);
    span.setAttribute('request.id', String(res.locals.requestId));
    const traceId = span.spanContext().traceId;
    if (!/^0+$/.test(traceId)) res.locals.traceId = traceId;
    res.once('finish', () => {
        span.setAttribute('http.response.status_code', res.statusCode);
        span.setAttribute('http.route', String(req.route?.path ?? 'unmatched'));
        if (res.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
    });
    context.with(trace.setSpan(context.active(), span), next);
};
export function recordRun(runId: string, queryId: string, connectionId: string) {
    const span = trace.getSpan(context.active());
    span?.setAttributes({
        'workspace.run_id': runId,
        'clickhouse.query_id': queryId,
        'workspace.connection_id': connectionId,
    });
}
