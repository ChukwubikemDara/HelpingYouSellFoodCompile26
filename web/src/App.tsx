import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { DealDetail } from './pages/DealDetail'
import { DealList } from './pages/DealList'
import { ReservationPage } from './pages/ReservationPage'

function NotFound() {
  return <p className="py-10 text-center text-stone-500">Page not found.</p>
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DealList />} />
          <Route path="deals/:id" element={<DealDetail />} />
          <Route path="reservations/:id" element={<ReservationPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
