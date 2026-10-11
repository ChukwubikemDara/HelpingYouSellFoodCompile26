import { NavLink, Outlet } from 'react-router-dom'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `px-2 py-1 text-sm ${isActive ? 'font-semibold text-emerald-700' : 'text-stone-600 hover:text-stone-900'}`

export function Layout() {
  return (
    <div className="mx-auto min-h-screen max-w-md">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-stone-50/95 px-4 py-3 backdrop-blur">
        <NavLink to="/" className="text-lg font-bold">
          Last Call
        </NavLink>
        <nav className="flex gap-1">
          <NavLink to="/" end className={linkClass}>
            Deals
          </NavLink>
          <NavLink to="/my" className={linkClass}>
            My pickups
          </NavLink>
          <NavLink to="/merchant" className={linkClass}>
            Business
          </NavLink>
        </nav>
      </header>
      <main className="space-y-4 p-4 pb-16">
        <Outlet />
      </main>
    </div>
  )
}
