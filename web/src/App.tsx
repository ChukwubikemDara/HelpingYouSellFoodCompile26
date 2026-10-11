import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { DealEditor } from './pages/merchant/DealEditor'
import { MerchantLayout } from './pages/merchant/MerchantLayout'
import { NewDeal } from './pages/merchant/NewDeal'
import { Onboard } from './pages/merchant/Onboard'
import { SummaryPage } from './pages/merchant/SummaryPage'
import { Today } from './pages/merchant/Today'

function NotFound() {
  return <p className="py-10 text-center text-muted">Page not found.</p>
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          {/* customers use the mobile app; this site is the store portal */}
          <Route index element={<Navigate to="/merchant" replace />} />
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
