# web

Frontend for the surplus food deals app (consumer + merchant), built against API contract v0.1.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. Use a phone-sized window, the layout is mobile first.

## Mock backend

`npm run dev` serves fixtures from `src/mock.ts` instead of calling the API
(`VITE_API_MOCK=1` in `.env.development`). Data lives in localStorage, so it
survives reloads. To start fresh, run this in the browser console:

```js
localStorage.removeItem('mock_db_v2')
```

Mock merchants you can open from the Business tab: `m_1` (bakery), `m_2` (cafe),
`m_3` (restaurant, no plan, so publishing shows the "choose a plan" path).

## Real backend

Set `VITE_API_MOCK=0`. In dev, `/api` is proxied to `http://localhost:8000`
(change it in `vite.config.ts`). For a deployed build set `VITE_API_URL` to the
backend origin.

## Layout

- `src/types.ts` contract shapes
- `src/api.ts` one function per endpoint
- `src/pages` consumer screens, `src/pages/merchant` merchant screens
