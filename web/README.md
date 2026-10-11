# web

Store portal for the surplus food deals app, built against API contract v0.1.
Customers use the Expo app in `../mobile`.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. Use a phone-sized window: it's meant to be used on a phone at the counter.

## Mock backend

`npm run dev` serves fixtures from `src/mock.ts` instead of calling the API
(`VITE_API_MOCK=1` in `.env.development`). Data lives in localStorage, so it
survives reloads. To start fresh, run this in the browser console:

```js
localStorage.removeItem('mock_db_v3')
```

Mock stores you can open with "Already set up?" on the first screen:

| ID | Store | Try |
|---|---|---|
| `m_1` | Example Bakery | redeem pickup codes `4821` and `7350` |
| `m_2` | Allen Street Coffee | redeem `1946`; `2208` is already used |
| `m_3` | Beaver Ave Noodles | has no plan, so approving a draft shows "choose a plan" |

The mock is separate from the mobile app's mock, so reservations made on a
phone don't show up here until both point at the real backend.

## Real backend

Set `VITE_API_MOCK=0`. In dev, `/api` is proxied to `http://localhost:8000`
(change it in `vite.config.ts`). For a deployed build set `VITE_API_URL` to the
backend origin.

## Layout

- `src/types.ts` contract shapes
- `src/api.ts` one function per endpoint
- `src/pages/merchant` the screens
- `src/index.css` palette and fonts, kept in step with `../mobile/src/theme.ts`
