"""Read-only caching proxy to thornode and Midgard.

Upstream URLs come from the environment (THORNODE_URL, MIDGARD_URL) and never reach the browser.
Only the GET endpoints the frontend needs are allowed through.
"""
import asyncio
import os
import re
import time

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

UPSTREAMS = {
    'thornode': os.getenv('THORNODE_URL', 'https://gateway.liquify.com/chain/thorchain_api').rstrip('/'),
    'midgard': os.getenv('MIDGARD_URL', 'https://gateway.liquify.com/chain/thorchain_midgard').rstrip('/'),
}

ALLOWED = {
    'thornode': re.compile(
        r'^thorchain/(network|mimir|constants|lastblock|pools'
        r'|pool/[A-Za-z0-9.\-]+(/liquidity_provider/[A-Za-z0-9]+)?)$'
    ),
    'midgard': re.compile(r'^v2/(health|actions|member/[A-Za-z0-9]+|history/depths/[A-Za-z0-9.\-]+)$'),
}

TIMEOUT = 15.0
RETRY_DELAYS = (1, 3)
CACHE_MAX = 5000
_cache: dict[str, tuple[float, int, bytes]] = {}

app = FastAPI(title='LP break-even proxy', docs_url=None, redoc_url=None)
client = httpx.AsyncClient(timeout=TIMEOUT, headers={'User-Agent': 'lp-breakeven-checker'})


def is_allowed(upstream: str, path: str) -> bool:
    pattern = ALLOWED.get(upstream)
    return bool(pattern and pattern.match(path)) and '..' not in path


def ttl_for(upstream: str, path: str, query: str) -> int:
    # Past price candles never change; everything else is live state.
    if path.startswith('v2/history/depths/') and 'from=' in query:
        return 7 * 86400
    return 30


async def fetch(url: str) -> httpx.Response:
    for delay in (*RETRY_DELAYS, None):
        try:
            r = await client.get(url)
            if r.status_code < 500 and r.status_code != 429:
                return r
        except httpx.HTTPError:
            pass
        if delay is None:
            raise httpx.HTTPError('upstream unavailable')
        await asyncio.sleep(delay)


@app.get('/api/health')
async def health():
    return {'ok': True}


@app.get('/api/{upstream}/{path:path}')
async def proxy(upstream: str, path: str, request: Request):
    if not is_allowed(upstream, path):
        return JSONResponse({'error': 'not allowed'}, status_code=404)

    query = request.url.query
    url = f'{UPSTREAMS[upstream]}/{path}' + (f'?{query}' if query else '')
    now = time.monotonic()
    hit = _cache.get(url)
    if hit and hit[0] > now:
        return Response(hit[2], status_code=hit[1], media_type='application/json')

    try:
        r = await fetch(url)
    except httpx.HTTPError:
        # Never echo the upstream URL: it is private.
        return JSONResponse({'error': 'node unavailable'}, status_code=502)

    if r.status_code in (200, 404):
        if len(_cache) >= CACHE_MAX:  # ponytail: wipe-all eviction, use an LRU if hit rate matters
            _cache.clear()
        _cache[url] = (now + ttl_for(upstream, path, query), r.status_code, r.content)
    return Response(r.content, status_code=r.status_code, media_type='application/json')
