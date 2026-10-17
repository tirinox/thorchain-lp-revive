# ᛞ LP Revive — THORChain LP break-even checker

Enter any address → see every THORChain LP position, its value now, why it is down
(synths / haircut / frozen pool / plain IL), break-even RUNE prices and a value-vs-price chart.

- `backend/` — FastAPI read-only caching proxy to thornode + Midgard (allowlisted GET endpoints only).
- `frontend/` — Vue 3 + Vite, English UI by default (RU switch). All LP math lives in `src/model.js` (thornode formulas, mimir halts/pauses), tested on real snapshots.

## Run

```bash
make env       # .env from .env.example (public Liquify gateway by default)
make up        # docker compose → http://localhost:8088
```

Local dev: `make install && make dev`. All targets: `make`.

Node URLs live only in `.env` (git-ignored); the browser only ever talks to `/api/*`.
