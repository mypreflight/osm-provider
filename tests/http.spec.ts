import {
  guardResultSize,
  handler,
  HttpError,
  json,
  MAX_RESULT_BYTES,
  optionalBoolean,
  optionalString,
  optionalStringList,
  requireIcao,
  requireMethod,
} from '../src/function/http.ts';
import { ConfigError } from '../src/core/config.ts';
import { ApiError } from '../src/core/api/client.ts';
import { OverpassError } from '../src/core/osm/overpass.ts';

describe('requireIcao', () => {
  it('accepts a four-letter code', () => {
    expect(requireIcao({ icao: 'EDDF' })).toBe('EDDF');
  });

  it('upper-cases and trims', () => {
    expect(requireIcao({ icao: '  eddf ' })).toBe('EDDF');
  });

  it.each([
    ['missing', {}],
    ['empty', { icao: '' }],
    ['whitespace only', { icao: '   ' }],
    ['too short', { icao: 'ED' }],
    ['too long', { icao: 'EDDFX' }],
    ['containing digits', { icao: 'ED1F' }],
    ['not a string', { icao: 1234 }],
  ])('rejects an icao that is %s', (_label, args) => {
    expect(() => requireIcao(args)).toThrow(HttpError);
  });

  it('reports a 400 rather than a server error', () => {
    expect.assertions(1);
    try {
      requireIcao({});
    } catch (error) {
      expect((error as HttpError).statusCode).toBe(400);
    }
  });
});

describe('requireMethod', () => {
  it('accepts an allowed method', () => {
    expect(() => requireMethod({ __ow_method: 'post' }, ['post'])).not.toThrow();
  });

  it('is case-insensitive about the incoming method', () => {
    expect(() => requireMethod({ __ow_method: 'POST' }, ['post'])).not.toThrow();
  });

  it('defaults to GET when the platform sends no method', () => {
    expect(() => requireMethod({}, ['get'])).not.toThrow();
  });

  it('rejects anything else with a 405', () => {
    expect.assertions(1);
    try {
      requireMethod({ __ow_method: 'delete' }, ['get', 'post']);
    } catch (error) {
      expect((error as HttpError).statusCode).toBe(405);
    }
  });
});

describe('optionalString', () => {
  it('returns the value when present', () => {
    expect(optionalString({ name: 'Frankfurt' }, 'name')).toBe('Frankfurt');
  });

  it.each([
    ['absent', {}],
    ['null', { name: null }],
    ['empty', { name: '' }],
  ])('returns undefined when %s', (_label, args) => {
    expect(optionalString(args, 'name')).toBeUndefined();
  });

  it('rejects a non-string', () => {
    expect(() => optionalString({ name: 42 }, 'name')).toThrow(HttpError);
  });
});

describe('optionalBoolean', () => {
  it.each([
    ['true', true],
    ['1', true],
    ['yes', true],
    ['TRUE', true],
    ['false', false],
    ['0', false],
    ['no', false],
  ])('coerces the query-string value %s', (value, expected) => {
    expect(optionalBoolean({ apply: value }, 'apply', !expected)).toBe(expected);
  });

  it('passes a real boolean through', () => {
    expect(optionalBoolean({ apply: true }, 'apply', false)).toBe(true);
  });

  it('falls back when the value is absent', () => {
    expect(optionalBoolean({}, 'apply', false)).toBe(false);
  });

  it('rejects anything ambiguous rather than guessing', () => {
    expect(() => optionalBoolean({ apply: 'maybe' }, 'apply', false)).toThrow(HttpError);
  });
});

describe('optionalStringList', () => {
  it('splits a comma-separated string', () => {
    expect(optionalStringList({ include: 'runways,gates' }, 'include')).toEqual([
      'runways',
      'gates',
    ]);
  });

  it('trims and drops empty entries', () => {
    expect(optionalStringList({ include: ' runways , , gates ' }, 'include')).toEqual([
      'runways',
      'gates',
    ]);
  });

  it('accepts an array as posted JSON would supply', () => {
    expect(optionalStringList({ include: ['runways', 'gates'] }, 'include')).toEqual([
      'runways',
      'gates',
    ]);
  });

  it('returns undefined when absent', () => {
    expect(optionalStringList({}, 'include')).toBeUndefined();
  });
});

describe('guardResultSize', () => {
  it('allows a small body', () => {
    expect(() => guardResultSize({ ok: true }, 'hint')).not.toThrow();
  });

  it('rejects a body over the cap with a 413 and a usable hint', () => {
    expect.assertions(2);
    const huge = { blob: 'x'.repeat(MAX_RESULT_BYTES + 1) };
    try {
      guardResultSize(huge, 'Narrow it with include.');
    } catch (error) {
      expect((error as HttpError).statusCode).toBe(413);
      expect((error as HttpError).message).toContain('Narrow it with include.');
    }
  });
});

describe('json', () => {
  it('labels the response as JSON', () => {
    expect(json(200, { ok: true })).toEqual({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: { ok: true },
    });
  });
});

describe('handler error mapping', () => {
  it('passes a success response through untouched', async () => {
    const run = handler(async () => json(200, { ok: true }));
    await expect(run({})).resolves.toEqual(json(200, { ok: true }));
  });

  it('keeps an HttpError status and message', async () => {
    const run = handler(async () => {
      throw new HttpError(404, 'Nothing here', { icao: 'ZZZZ' });
    });

    await expect(run({})).resolves.toMatchObject({
      statusCode: 404,
      body: { error: 'Nothing here', details: { icao: 'ZZZZ' } },
    });
  });

  it('treats a missing env var as a 500, not the caller’s fault', async () => {
    const run = handler(async () => {
      throw new ConfigError('Missing required env var FLIGHTS_EMAIL.');
    });

    await expect(run({})).resolves.toMatchObject({ statusCode: 500 });
  });

  it('reports an Overpass outage as 503', async () => {
    const run = handler(async () => {
      throw new OverpassError('all mirrors down');
    });

    await expect(run({})).resolves.toMatchObject({ statusCode: 503 });
  });

  it('reports a rejected upstream credential as 500, since that is our misconfiguration', async () => {
    const run = handler(async () => {
      throw new ApiError(401, 'GET', '/api/v1/airport', 'Unauthorized');
    });

    await expect(run({})).resolves.toMatchObject({ statusCode: 500 });
  });

  it('reports other upstream failures as 502', async () => {
    const run = handler(async () => {
      throw new ApiError(500, 'GET', '/api/v1/airport', 'boom');
    });

    await expect(run({})).resolves.toMatchObject({ statusCode: 502 });
  });

  it('never lets an unexpected throw escape as a rejection', async () => {
    const run = handler(async () => {
      throw new Error('unexpected');
    });

    await expect(run({})).resolves.toMatchObject({
      statusCode: 500,
      body: { error: 'Unexpected error', details: 'unexpected' },
    });
  });

  it('survives being invoked with no arguments at all', async () => {
    const run = handler(async (args) => json(200, { got: Object.keys(args).length }));
    await expect(run()).resolves.toMatchObject({ statusCode: 200 });
  });
});
