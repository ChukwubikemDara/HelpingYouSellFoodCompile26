import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { DealDetail } from './pages/DealDetail'
import { DealList } from './pages/DealList'
import { DealEditor } from './pages/merchant/DealEditor'
import { MerchantLayout } from './pages/merchant/MerchantLayout'
import { NewDeal } from './pages/merchant/NewDeal'
import { Onboard } from './pages/merchant/Onboard'
import { SummaryPage } from './pages/merchant/SummaryPage'
import { Today } from './pages/merchant/Today'
import { MyReservations } from './pages/MyReservations'
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
          <Route path="my" element={<MyReservations />} />
          <Route path="merchant/onboard" element={<Onboard />} />
          <Route path="merchant" element={<MerchantLayout />}>
            <Route index element={<Today />} />
            <Route path="new" element={<NewDeal />} />
            <Route path="deals/:id" element={<DealEditor />} />
            <Route path="summary" element={<SummaryPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
