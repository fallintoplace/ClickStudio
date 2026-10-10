import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { startVisiblePolling } from '../../.workspace-build/web/visible-polling.js';

function environment(t, initialVisibility = 'visible') {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const page = new EventTarget();
    page.visibilityState = initialVisibility;
    Object.defineProperty(globalThis, 'document', { configurable: true, value: page });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const stops = [];
    t.after(() => {
        for (const stop of stops) stop();
        if (previous) Object.defineProperty(globalThis, 'document', previous);
        else delete globalThis.document;
    });
    return {
        page,
        start(task, options) {
            const stop = startVisiblePolling(task, options);
            stops.push(stop);
            return stop;
        },
        visibility(value) {
            page.visibilityState = value;
            page.dispatchEvent(new Event('visibilitychange'));
        },
        async tick(milliseconds) {
            t.mock.timers.tick(milliseconds);
            await setImmediate();
        },
    };
}

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

test('Visible polling refreshes immediately and repeats after the interval', async t => {
    const env = environment(t);
    let calls = 0;
    env.start(
        async () => {
            calls++;
        },
        { intervalMs: 15000 },
    );
    assert.equal(calls, 1);
    await setImmediate();
    await env.tick(14999);
    assert.equal(calls, 1);
    await env.tick(1);
    assert.equal(calls, 2);
});

test('Delayed polling preserves the first refresh interval', async t => {
    const env = environment(t);
    let calls = 0;
    env.start(
        async () => {
            calls++;
        },
        { intervalMs: 1500, immediate: false },
    );
    assert.equal(calls, 0);
    await env.tick(1499);
    assert.equal(calls, 0);
    await env.tick(1);
    assert.equal(calls, 1);
});

test('A hidden page makes no periodic requests and refreshes on return', async t => {
    const env = environment(t, 'hidden');
    let calls = 0;
    env.start(
        async () => {
            calls++;
        },
        { intervalMs: 15000 },
    );
    await env.tick(3600000);
    assert.equal(calls, 0);
    env.visibility('visible');
    assert.equal(calls, 1);
    await setImmediate();
    await env.tick(15000);
    assert.equal(calls, 2);
});

test('Hiding the page clears the pending timer without creating a second loop', async t => {
    const env = environment(t);
    let calls = 0;
    env.start(
        async () => {
            calls++;
        },
        { intervalMs: 15000 },
    );
    await setImmediate();
    await env.tick(14000);
    env.visibility('hidden');
    await env.tick(60000);
    assert.equal(calls, 1);
    env.visibility('visible');
    await setImmediate();
    assert.equal(calls, 2);
    await env.tick(14999);
    assert.equal(calls, 2);
    await env.tick(1);
    assert.equal(calls, 3);
});

test('A slow periodic request cannot overlap the next refresh', async t => {
    const env = environment(t);
    const first = deferred();
    let calls = 0;
    env.start(
        async () => {
            if (++calls === 1) await first.promise;
        },
        { intervalMs: 1500 },
    );
    await env.tick(60000);
    assert.equal(calls, 1);
    first.resolve();
    await setImmediate();
    await env.tick(1499);
    assert.equal(calls, 1);
    await env.tick(1);
    assert.equal(calls, 2);
});

test('Returning before an aborted request settles waits and then refreshes immediately', async t => {
    const env = environment(t);
    const first = deferred();
    const signals = [];
    env.start(
        async signal => {
            signals.push(signal);
            if (signals.length === 1) await first.promise;
        },
        { intervalMs: 5000 },
    );
    env.visibility('hidden');
    assert.equal(signals[0].aborted, true);
    env.visibility('visible');
    await env.tick(60000);
    assert.equal(signals.length, 1);
    first.resolve();
    await setImmediate();
    assert.equal(signals.length, 2);
    assert.equal(signals[1].aborted, false);
    await env.tick(5000);
    assert.equal(signals.length, 3);
});

test('An aborted request that settles while hidden does not schedule more work', async t => {
    const env = environment(t);
    const first = deferred();
    let calls = 0;
    env.start(
        async () => {
            if (++calls === 1) await first.promise;
        },
        { intervalMs: 5000 },
    );
    env.visibility('hidden');
    first.reject(new Error('Request aborted'));
    await setImmediate();
    await env.tick(60000);
    assert.equal(calls, 1);
    env.visibility('visible');
    assert.equal(calls, 2);
});

test('Repeated visible events do not abort or overlap a pending refresh', async t => {
    const env = environment(t);
    const pending = deferred();
    const signals = [];
    env.start(
        async signal => {
            signals.push(signal);
            await pending.promise;
        },
        { intervalMs: 5000 },
    );
    env.visibility('visible');
    env.visibility('visible');
    assert.equal(signals.length, 1);
    assert.equal(signals[0].aborted, false);
    pending.resolve();
    await setImmediate();
    await env.tick(5000);
    assert.equal(signals.length, 2);
});

test('Both synchronous failures and rejected requests leave periodic refreshes working', async t => {
    const env = environment(t);
    let calls = 0;
    env.start(
        () => {
            calls++;
            if (calls === 1) throw new Error('Synchronous failure');
            if (calls === 2) return Promise.reject(new Error('Request failed'));
            return Promise.resolve();
        },
        { intervalMs: 1500 },
    );
    await setImmediate();
    await env.tick(1500);
    assert.equal(calls, 2);
    await env.tick(1500);
    assert.equal(calls, 3);
});

test('One-shot metadata refreshes on visibility changes without periodic polling', async t => {
    const env = environment(t);
    let calls = 0;
    env.start(async () => {
        calls++;
    });
    await setImmediate();
    await env.tick(60000);
    assert.equal(calls, 1);
    env.visibility('hidden');
    env.visibility('visible');
    await setImmediate();
    assert.equal(calls, 2);
    await env.tick(60000);
    assert.equal(calls, 2);
});

test('Stopping clears pending timers and removes the visibility listener', async t => {
    const env = environment(t);
    let calls = 0;
    const stop = env.start(
        async () => {
            calls++;
        },
        { intervalMs: 15000 },
    );
    await setImmediate();
    assert.equal(getEventListeners(env.page, 'visibilitychange').length, 1);
    stop();
    stop();
    assert.equal(getEventListeners(env.page, 'visibilitychange').length, 0);
    env.visibility('hidden');
    env.visibility('visible');
    await env.tick(60000);
    assert.equal(calls, 1);
});

test('Stopping aborts in-flight work and prevents a late response from restarting polling', async t => {
    const env = environment(t);
    const pending = deferred();
    const signals = [];
    const stop = env.start(
        async signal => {
            signals.push(signal);
            await pending.promise;
        },
        { intervalMs: 1500 },
    );
    stop();
    assert.equal(signals[0].aborted, true);
    pending.resolve();
    await setImmediate();
    env.visibility('hidden');
    env.visibility('visible');
    await env.tick(60000);
    assert.equal(signals.length, 1);
});

test('Stopping before a delayed first refresh starts no request', async t => {
    const env = environment(t);
    let calls = 0;
    const stop = env.start(
        async () => {
            calls++;
        },
        { intervalMs: 1500, immediate: false },
    );
    stop();
    await env.tick(60000);
    assert.equal(calls, 0);
});

test('Independent polling scopes do not cancel each other', async t => {
    const env = environment(t);
    let first = 0,
        second = 0;
    const stopFirst = env.start(
        async () => {
            first++;
        },
        { intervalMs: 1500 },
    );
    env.start(
        async () => {
            second++;
        },
        { intervalMs: 5000 },
    );
    await setImmediate();
    stopFirst();
    await env.tick(5000);
    assert.equal(first, 1);
    assert.equal(second, 2);
    assert.equal(getEventListeners(env.page, 'visibilitychange').length, 1);
});
