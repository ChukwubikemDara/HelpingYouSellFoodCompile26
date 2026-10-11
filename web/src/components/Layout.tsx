import { useEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'

export function Layout() {
  // BrowserRouter keeps the old scroll position; start each screen at the top
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="mx-auto min-h-screen max-w-md">
      <header className="flex items-baseline justify-between px-5 pt-5">
        <Link to="/merchant" className="font-display text-xl italic">
          Last Call<span className="text-marigold">.</span>
        </Link>
        <span className="text-[11px] font-bold tracking-[0.1em] text-muted uppercase">For stores</span>
      </header>
      <main className="space-y-5 px-5 pt-5 pb-28">
        <Outlet />
      </main>
    </div>
  )
}
